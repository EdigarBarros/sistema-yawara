/**
 * FINANCEIRO: lançamentos (receitas e despesas), comprovantes e consulta por evento.
 * ---------------------------------------------------------------------------
 * Armazenamento: `financeEntries/{id}` = financeEntryDoc(lançamento) +
 * `receiptHistory` (comprovantes substituídos). Lançamentos não têm público
 * por registro: a leitura direta exige `finance.view` (regras do Firestore).
 * Comprovantes ficam em `finance/{entryId}/{uploadId}-{nome}` (Storage, leitura
 * com `finance.view`); um comprovante substituído NUNCA é apagado — vai para
 * `receiptHistory` e fica registrado no histórico e na auditoria.
 *
 * Regras (as mesmas do serviço de demonstração e de src/lib/policies.ts):
 *  - Ver: `finance.view`. Exceção: `listForEvent`, que também atende a
 *    diretoria do departamento responsável pelo evento (ou a presidência) —
 *    `canSeeEvent` + `canSeeEventFinance` — sem observações, histórico e
 *    comprovantes para quem não tem `finance.view`.
 *  - Registrar: `finance.register`; registrar já como recebido/pago exige
 *    `finance.approve`.
 *  - Editar: `canEditEntry` (finance.edit, ou quem registrou enquanto o
 *    lançamento está pendente). A situação só muda por `setStatus`.
 *  - Confirmar/reabrir: `finance.approve`; cancelar: `finance.archive` e motivo.
 *    Um lançamento cancelado só pode ser reaberto como pendente.
 *  - Comprovante: `finance.register` ou `finance.edit` (não em lançamentos cancelados).
 *  - Valores em centavos inteiros (> 0); a categoria precisa ser do mesmo tipo
 *    do lançamento; evento e campanha vinculados precisam existir e estar
 *    visíveis para quem registra; o responsável precisa ser integrante ativo.
 *
 * Vendas de rifas NÃO geram lançamentos automaticamente (evita contar o mesmo
 * dinheiro duas vezes): o valor efetivamente recebido é registrado como
 * receita vinculada à campanha.
 *
 * A auditoria não registra descrições, observações, motivos ou nomes de
 * arquivos — apenas códigos, identificadores, valores (centavos) e situações.
 * O Financeiro não gera notificações (o serviço de demonstração também não).
 */
import { createHash } from "node:crypto";
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { financeEntryDoc, type FinanceEntryDoc } from "@/lib/firestore-model";
import { formatMoney } from "@/lib/format";
import { ENTRY_TYPE_LABELS, entryStatusMeta } from "@/lib/labels";
import { canEditEntry, canSeeCampaign, canSeeEvent, canSeeEventFinance } from "@/lib/policies";
import type { AtleticaEvent, Campaign, EntryStatus, EntryType, FileRef, FinanceEntry, HistoryAction, PaymentMethod } from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { nextCode } from "../core/counters";
import { mutation, query, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { finalizeUpload, markAttached } from "../core/files";
import { appendHistory, historyEntry } from "../core/history";
import { requireDoc, toDTO } from "../core/records";
import { indexRecord, searchEntryFor } from "../core/search-index";

/* ------------------------------- limites -------------------------------- */

/** Maior valor aceito num lançamento: R$ 10.000.000,00. */
export const MAX_AMOUNT = 1_000_000_000;
/** Lançamentos devolvidos por evento. */
export const EVENT_ENTRIES_LIMIT = 500;

/* ------------------------------- esquemas ------------------------------- */

const ENTRY_TYPES = ["income", "expense"] as const satisfies readonly EntryType[];
const ENTRY_STATUSES = ["pending", "settled", "cancelled"] as const satisfies readonly EntryStatus[];
const PAYMENT_METHODS = ["pix", "cash", "card", "transfer", "other"] as const satisfies readonly PaymentMethod[];

/** Objeto que recusa campos desconhecidos (com mensagem em português). */
function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? "Alguns campos enviados não são aceitos nesta operação. Atualize a página e tente novamente." : undefined),
  });
}

/** Identificadores usados em caminhos do Firestore: sem barras ou caracteres especiais. */
const docId = (message = "Identificador inválido.") => z.string({ error: message }).regex(/^[A-Za-z0-9_-]{1,128}$/, message);

const uploadId = z.string({ error: "Envio de arquivo inválido." }).regex(/^[a-f0-9]{32}$/, "Envio de arquivo inválido.");

function isRealDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const dateOnly = z
  .string({ error: "Informe a data." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.")
  .refine(isRealDate, "Data inválida.");

const amount = z
  .number({ error: "Informe um valor maior que zero." })
  .int("Informe o valor em centavos (número inteiro).")
  .positive("Informe um valor maior que zero.")
  .max(MAX_AMOUNT, "O valor informado é alto demais (máximo de R$ 10.000.000,00).");

/** Vínculo opcional: vazio ou `null` = sem vínculo. */
const optionalLink = z.union([docId(), z.literal("")]).nullish();

const entryFields = {
  type: z.enum(ENTRY_TYPES, { error: "Escolha se o lançamento é receita ou despesa." }),
  description: z
    .string({ error: "Informe uma descrição (mínimo de 3 caracteres)." })
    .trim()
    .min(3, "Informe uma descrição (mínimo de 3 caracteres).")
    .max(200, "A descrição pode ter no máximo 200 caracteres."),
  categoryId: docId("Escolha a categoria."),
  amount,
  date: dateOnly,
  responsibleId: docId("Escolha o responsável."),
  departmentId: docId("Escolha o departamento."),
  eventId: optionalLink,
  campaignId: optionalLink,
  paymentMethod: z.union([z.enum(PAYMENT_METHODS, { error: "Forma de pagamento inválida." }), z.literal("")]).nullish(),
  notes: z.string({ error: "Observações inválidas." }).trim().max(500, "As observações podem ter no máximo 500 caracteres.").nullish(),
};

/** Campos editáveis (os nomes entram na auditoria; os textos, não). */
const ENTRY_FIELDS = ["type", "description", "categoryId", "amount", "date", "responsibleId", "departmentId", "eventId", "campaignId", "paymentMethod", "notes"] as const;

const createSchema = strict({
  input: strict({
    ...entryFields,
    status: z.enum(["pending", "settled"], { error: "Situação inválida. Registre como pendente ou realizado." }),
  }),
  uploadId: uploadId.nullish(),
});

const updateSchema = strict({
  id: docId("Lançamento inválido."),
  // `status` é aceito apenas para recusar mudanças por aqui (a situação muda por setStatus).
  input: strict({ ...entryFields, status: z.enum(ENTRY_STATUSES, { error: "Situação inválida." }) }).partial(),
});

const statusSchema = strict({
  id: docId("Lançamento inválido."),
  status: z.enum(ENTRY_STATUSES, { error: "Situação inválida." }),
  reason: z.string({ error: "Informe o motivo do cancelamento." }).trim().max(300, "Use no máximo 300 caracteres no motivo.").nullish(),
});

const attachSchema = strict({ id: docId("Lançamento inválido."), uploadId });

const eventSchema = strict({ eventId: docId("Evento inválido.") });

/* ------------------------------- auxiliares ------------------------------ */

/** Lançamento como gravado (com os comprovantes substituídos). */
export type StoredEntry = FinanceEntry & { receiptHistory?: FileRef[] };

/**
 * Id do lançamento novo, derivado da requisição: repetir a mesma requisição
 * aponta para o mesmo registro (e para a mesma pasta do comprovante).
 */
export function newEntryId(uid: string, requestId: string) {
  return createHash("sha256").update(`${uid}:${requestId}`).digest("hex").slice(0, 20);
}

/** A requisição já foi concluída antes? (evita mover outro arquivo num reenvio). */
async function alreadyCompleted(uid: string, requestId: string) {
  return (await db.doc(`idempotency/${uid}__${requestId}`).get()).exists;
}

function normalizeEntry(e: StoredEntry): StoredEntry {
  return { ...e, history: e.history ?? [] };
}

function entryRef(id: string) {
  return db.doc(`financeEntries/${id}`);
}

async function loadEntry(tx: Transaction, id: string): Promise<{ ref: DocumentReference; entry: StoredEntry }> {
  const ref = entryRef(id);
  const snap = requireDoc(await tx.get(ref), "Lançamento");
  return { ref, entry: normalizeEntry(toDTO<StoredEntry>(snap)) };
}

/** Documento completo a gravar (campos esvaziados deixam de existir). */
function entryData(entry: StoredEntry): FinanceEntryDoc {
  const { receiptHistory, ...rest } = entry;
  const data: FinanceEntryDoc = financeEntryDoc(rest);
  if (receiptHistory?.length) data.receiptHistory = receiptHistory;
  return data;
}

function requireFinanceView(actor: Actor) {
  requirePermission(actor, "finance.view", "Seu perfil não tem acesso ao Financeiro.");
}

function requireCanAttach(actor: Actor) {
  if (!actor.can("finance.register") && !actor.can("finance.edit")) fail("forbidden", "Seu perfil não pode anexar comprovantes.");
}

/** Leitura opcional na transação (somente quando o campo precisa ser conferido). */
function readIf(tx: Transaction, path: string | null): Promise<DocumentSnapshot | null> {
  return path ? tx.get(db.doc(path)) : Promise.resolve(null);
}

function assertCategory(snap: DocumentSnapshot | null, type: EntryType) {
  if (!snap) return;
  if (!snap.exists) fail("invalid", "A categoria escolhida não existe.");
  if (snap.data()!.type !== type) fail("invalid", "A categoria escolhida não corresponde ao tipo de movimentação.");
}

/** Departamento precisa existir; um departamento desativado só é aceito se já era o do lançamento. */
function assertDepartment(snap: DocumentSnapshot | null, previousId?: string) {
  if (!snap) return;
  if (!snap.exists) fail("invalid", "O departamento escolhido não existe.");
  if (snap.data()!.active === false && snap.id !== previousId) fail("invalid", "O departamento escolhido está desativado. Escolha outro departamento.");
}

/** Responsável: integrante ativo (quem já era responsável pode permanecer mesmo desativado). */
function assertResponsible(snap: DocumentSnapshot | null, previousId?: string) {
  if (!snap) return;
  if (!snap.exists) fail("invalid", "O responsável escolhido não é integrante da Central.");
  if (snap.data()!.status !== "active" && snap.id !== previousId) fail("invalid", "O responsável escolhido está com a conta desativada. Escolha um integrante ativo.");
}

function eventFromSnap(snap: DocumentSnapshot): AtleticaEvent {
  const ev = toDTO<AtleticaEvent>(snap);
  return { ...ev, responsibleIds: ev.responsibleIds ?? [] };
}

/** Aplica uma política a um registro lido; registro malformado conta como "não visível". */
function visibleTo(snap: DocumentSnapshot, check: (snap: DocumentSnapshot) => boolean) {
  if (!snap.exists) return false;
  try {
    return check(snap);
  } catch {
    return false;
  }
}

/** Evento vinculado: precisa existir e estar visível para quem registra (mesma mensagem nos dois casos). */
function assertLinkedEvent(actor: Actor, snap: DocumentSnapshot | null) {
  if (!snap) return;
  if (!visibleTo(snap, (s) => canSeeEvent(actor.ctx, eventFromSnap(s)))) {
    fail("invalid", "O evento escolhido não foi encontrado ou não está disponível para o seu perfil.");
  }
}

/** Campanha vinculada: precisa existir e estar visível para quem registra. */
function assertLinkedCampaign(actor: Actor, snap: DocumentSnapshot | null) {
  if (!snap) return;
  if (!visibleTo(snap, (s) => canSeeCampaign(actor.ctx, toDTO<Campaign>(s)))) {
    fail("invalid", "A campanha escolhida não foi encontrada ou não está disponível para o seu perfil.");
  }
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, entryId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(
    tx,
    { uid: actor.uid, name: actor.name },
    { action: `finance.${action}`, module: "finance", resourceType: "financeEntry", resourceId: entryId, summary, details },
    ctx.requestId,
    ctx.now,
  );
}

/** Metadados do arquivo para a auditoria (sem nome e sem conteúdo). */
function fileDetails(file: FileRef | undefined | null, prefix = "") {
  return {
    [`${prefix}mimeType`]: file?.mimeType ?? null,
    [`${prefix}size`]: file?.size ?? null,
    [`${prefix}sha256`]: file?.sha256 ?? null,
  };
}

function statusLabel(type: EntryType, status: EntryStatus) {
  return entryStatusMeta(type, status).label;
}

/** Monta a resposta: o lançamento completo, se o autor ainda pode ver o Financeiro. */
async function presentEntry(id: string, actor: Actor | null): Promise<StoredEntry> {
  const snap = await entryRef(id).get();
  if (!snap.exists) fail("not_found", "Lançamento não encontrado.");
  if (!actor || !actor.can("finance.view")) fail("forbidden", "A operação foi concluída, mas o Financeiro não está mais disponível para o seu perfil.");
  return normalizeEntry(toDTO<StoredEntry>(snap));
}

/**
 * Visão de um lançamento na aba financeira do evento. Quem não tem
 * `finance.view` (diretoria do departamento do evento) vê valores, datas,
 * categorias e situação — sem observações, histórico e comprovantes.
 */
export function entryForEventView(entry: StoredEntry, full: boolean): StoredEntry {
  if (full) return entry;
  const { receiptHistory: _h, receipt: _r, notes: _n, ...rest } = entry;
  void _h;
  void _r;
  void _n;
  return { ...rest, history: [] };
}

interface EntryResult {
  id: string;
}

interface CreatePrepared {
  entryId: string;
  file: FileRef | null;
}

/* -------------------------------- ações --------------------------------- */

export const financeActions = {
  create: mutation({
    module: "finance",
    schema: createSchema,
    async prepare(actor, { input, uploadId: upload }, ctx): Promise<CreatePrepared> {
      const entryId = newEntryId(actor.uid, ctx.requestId);
      if (!upload) return { entryId, file: null };
      // Conferência antecipada (repetida na transação) para não mover arquivos à toa.
      requireFinanceView(actor);
      requirePermission(actor, "finance.register", "Seu perfil não pode registrar lançamentos.");
      if (input.status === "settled") {
        requirePermission(actor, "finance.approve", "Seu perfil não pode registrar já como recebido/pago. Registre como pendente para confirmação.");
      }
      if (await alreadyCompleted(actor.uid, ctx.requestId)) return { entryId, file: null };
      const file = await finalizeUpload(actor, upload, "financeReceipt", `finance/${entryId}`, ctx);
      return { entryId, file };
    },
    async run(tx, actor, { input, uploadId: upload }, ctx, prepared): Promise<EntryResult> {
      actor = actor!;
      requireFinanceView(actor);
      requirePermission(actor, "finance.register", "Seu perfil não pode registrar lançamentos.");
      if (input.status === "settled") {
        requirePermission(actor, "finance.approve", "Seu perfil não pode registrar já como recebido/pago. Registre como pendente para confirmação.");
      }
      const id = newEntryId(actor.uid, ctx.requestId);
      if (prepared.entryId !== id) fail("conflict", "Requisição inconsistente. Atualize a página e tente novamente.");
      if (upload && !prepared.file) fail("conflict", "O comprovante enviado não pôde ser anexado. Envie o arquivo novamente.");
      const eventId = input.eventId || undefined;
      const campaignId = input.campaignId || undefined;

      // Leituras
      await requireModuleEnabled(tx, "finance");
      const code = await nextCode(tx, ctx, "LAN");
      const ref = entryRef(id);
      const [existing, catSnap, depSnap, respSnap, evSnap, cmpSnap] = await Promise.all([
        tx.get(ref),
        readIf(tx, `financeCategories/${input.categoryId}`),
        readIf(tx, `departments/${input.departmentId}`),
        readIf(tx, `members/${input.responsibleId}`),
        readIf(tx, eventId ? `events/${eventId}` : null),
        readIf(tx, campaignId ? `campaigns/${campaignId}` : null),
      ]);

      // Regras
      if (existing.exists) fail("conflict", "Este lançamento já foi registrado. Atualize a página.");
      assertCategory(catSnap, input.type);
      assertDepartment(depSnap);
      assertResponsible(respSnap);
      assertLinkedEvent(actor, evSnap);
      assertLinkedCampaign(actor, cmpSnap);

      const file = prepared.file;
      const entry: StoredEntry = {
        id,
        code,
        type: input.type,
        description: input.description,
        categoryId: input.categoryId,
        amount: input.amount,
        date: input.date,
        responsibleId: input.responsibleId,
        departmentId: input.departmentId,
        eventId,
        campaignId,
        paymentMethod: input.paymentMethod || undefined,
        status: input.status,
        receipt: file ?? undefined,
        notes: input.notes || undefined,
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [
          historyEntry(actor.uid, "created", `${ENTRY_TYPE_LABELS[input.type]} de ${formatMoney(input.amount)} registrada`, ctx.now),
          ...(file ? [historyEntry(actor.uid, "attachment", "Comprovante anexado", ctx.now)] : []),
        ],
      };

      // Escritas
      tx.create(ref, entryData(entry));
      indexRecord(tx, searchEntryFor.finance(entry));
      if (upload && file) markAttached(tx, upload, `financeEntries/${id}`);
      audit(tx, actor, ctx, "create", id, `${ENTRY_TYPE_LABELS[entry.type]} registrada: ${code} (${formatMoney(entry.amount)}, ${statusLabel(entry.type, entry.status)})`, {
        code,
        type: entry.type,
        amount: entry.amount,
        status: entry.status,
        categoryId: entry.categoryId,
        departmentId: entry.departmentId,
        eventId: entry.eventId ?? null,
        campaignId: entry.campaignId ?? null,
        receipt: !!file,
        ...(file ? fileDetails(file) : {}),
      });
      return { id };
    },
    async present(result, actor) {
      return presentEntry(result.id, actor);
    },
  }),

  update: mutation({
    module: "finance",
    schema: updateSchema,
    async run(tx, actor, { id, input }, ctx): Promise<EntryResult> {
      actor = actor!;
      requireFinanceView(actor);
      // Leituras
      await requireModuleEnabled(tx, "finance");
      const { ref, entry: current } = await loadEntry(tx, id);
      if (!canEditEntry(actor.ctx, current)) fail("forbidden", "Seu perfil não pode editar este lançamento.");
      if (input.status !== undefined && input.status !== current.status) {
        fail("invalid", "Use a ação de confirmar/reabrir para mudar a situação.");
      }
      const type = input.type ?? current.type;
      const categoryId = input.categoryId ?? current.categoryId;
      const eventId = "eventId" in input ? input.eventId || undefined : current.eventId;
      const campaignId = "campaignId" in input ? input.campaignId || undefined : current.campaignId;
      const depChanged = input.departmentId !== undefined && input.departmentId !== current.departmentId;
      const respChanged = input.responsibleId !== undefined && input.responsibleId !== current.responsibleId;
      const [catSnap, depSnap, respSnap, evSnap, cmpSnap] = await Promise.all([
        // A categoria final precisa combinar com o tipo final.
        readIf(tx, input.categoryId !== undefined || input.type !== undefined ? `financeCategories/${categoryId}` : null),
        readIf(tx, depChanged ? `departments/${input.departmentId}` : null),
        readIf(tx, respChanged ? `members/${input.responsibleId}` : null),
        readIf(tx, eventId && eventId !== current.eventId ? `events/${eventId}` : null),
        readIf(tx, campaignId && campaignId !== current.campaignId ? `campaigns/${campaignId}` : null),
      ]);

      // Regras
      assertCategory(catSnap, type);
      assertDepartment(depSnap, current.departmentId);
      assertResponsible(respSnap, current.responsibleId);
      assertLinkedEvent(actor, evSnap);
      assertLinkedCampaign(actor, cmpSnap);

      const next: StoredEntry = { ...current, type, categoryId, eventId, campaignId };
      if (input.description !== undefined) next.description = input.description;
      if (input.amount !== undefined) next.amount = input.amount;
      if (input.date !== undefined) next.date = input.date;
      if (input.responsibleId !== undefined) next.responsibleId = input.responsibleId;
      if (input.departmentId !== undefined) next.departmentId = input.departmentId;
      if ("paymentMethod" in input) next.paymentMethod = input.paymentMethod || undefined;
      if ("notes" in input) next.notes = input.notes || undefined;
      const amountChanged = next.amount !== current.amount;
      next.updatedAt = ctx.now;
      next.history = appendHistory(
        current.history,
        historyEntry(actor.uid, "updated", amountChanged ? `Valor alterado de ${formatMoney(current.amount)} para ${formatMoney(next.amount)}` : "Lançamento editado", ctx.now),
      );

      // Escritas (documento completo: campos esvaziados deixam de existir)
      tx.set(ref, entryData(next));
      indexRecord(tx, searchEntryFor.finance(next));
      const changed = ENTRY_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null));
      audit(
        tx,
        actor,
        ctx,
        "update",
        id,
        amountChanged
          ? `Lançamento ${current.code} editado: valor de ${formatMoney(current.amount)} para ${formatMoney(next.amount)}`
          : `Lançamento ${current.code} editado${changed.length ? `: ${changed.join(", ")}` : " (sem alterações)"}`,
        {
          code: current.code,
          fields: changed.join(","),
          amountChanged,
          amountFrom: amountChanged ? current.amount : null,
          amountTo: amountChanged ? next.amount : null,
          type: next.type,
          status: next.status,
        },
      );
      return { id };
    },
    async present(result, actor) {
      return presentEntry(result.id, actor);
    },
  }),

  setStatus: mutation({
    module: "finance",
    schema: statusSchema,
    async run(tx, actor, { id, status, reason }, ctx): Promise<EntryResult> {
      actor = actor!;
      requireFinanceView(actor);
      if (status === "cancelled") requirePermission(actor, "finance.archive", "Seu perfil não pode cancelar lançamentos.");
      else requirePermission(actor, "finance.approve", "Seu perfil não pode confirmar ou reabrir lançamentos.");
      // Leituras
      await requireModuleEnabled(tx, "finance");
      const { ref, entry: current } = await loadEntry(tx, id);

      // Regras
      if (current.status === status) return { id };
      if (status === "cancelled" && (!reason || reason.length < 3)) fail("invalid", "Informe o motivo do cancelamento.");
      if (current.status === "cancelled" && status !== "pending") {
        fail("conflict", "Reabra o lançamento cancelado como pendente antes de confirmá-lo.");
      }

      const label = statusLabel(current.type, status);
      const action: HistoryAction = status === "cancelled" ? "cancelled" : status === "settled" ? "payment" : "status";
      const next: StoredEntry = {
        ...current,
        status,
        updatedAt: ctx.now,
        history: appendHistory(
          current.history,
          historyEntry(actor.uid, action, status === "cancelled" ? `Lançamento cancelado: ${reason}` : `Situação alterada para ${label}`, ctx.now),
        ),
      };

      // Escritas
      tx.update(ref, { status, updatedAt: ctx.now, history: next.history });
      indexRecord(tx, searchEntryFor.finance(next));
      audit(
        tx,
        actor,
        ctx,
        "setStatus",
        id,
        `Lançamento ${current.code}: ${statusLabel(current.type, current.status)} → ${label}${status === "cancelled" ? " (motivo no histórico do lançamento)" : ""}`,
        { code: current.code, from: current.status, to: status, type: current.type, amount: current.amount },
      );
      return { id };
    },
    async present(result, actor) {
      return presentEntry(result.id, actor);
    },
  }),

  attachReceipt: mutation({
    module: "finance",
    schema: attachSchema,
    async prepare(actor, { id, uploadId: upload }, ctx): Promise<FileRef | null> {
      // Conferência antecipada (repetida na transação) para não mover arquivos à toa.
      requireFinanceView(actor);
      requireCanAttach(actor);
      if (await alreadyCompleted(actor.uid, ctx.requestId)) return null;
      if (!(await entryRef(id).get()).exists) fail("not_found", "Lançamento não encontrado(a). Pode ter sido removido(a) ou não estar disponível para o seu perfil.");
      return finalizeUpload(actor, upload, "financeReceipt", `finance/${id}`, ctx);
    },
    async run(tx, actor, { id, uploadId: upload }, ctx, file): Promise<EntryResult> {
      actor = actor!;
      requireFinanceView(actor);
      requireCanAttach(actor);
      if (!file) fail("conflict", "O comprovante enviado não pôde ser anexado. Envie o arquivo novamente.");
      // Leituras
      await requireModuleEnabled(tx, "finance");
      const { ref, entry: current } = await loadEntry(tx, id);

      // Regras
      if (current.status === "cancelled") fail("conflict", "Não é possível anexar comprovante a um lançamento cancelado. Reabra-o como pendente antes.");
      if (current.receipt?.path && current.receipt.path === file.path) return { id };
      const replaced = current.receipt;
      // O comprovante anterior nunca é apagado: vai para o histórico de comprovantes.
      const receiptHistory = replaced ? [...(current.receiptHistory ?? []), replaced] : current.receiptHistory;
      const history = appendHistory(
        current.history,
        historyEntry(actor.uid, "attachment", replaced ? `Comprovante substituído (anterior: ${replaced.name})` : "Comprovante anexado", ctx.now),
      );

      // Escritas
      tx.update(ref, { receipt: file, ...(receiptHistory?.length ? { receiptHistory } : {}), updatedAt: ctx.now, history });
      indexRecord(tx, searchEntryFor.finance({ ...current, receipt: file, updatedAt: ctx.now, history }));
      markAttached(tx, upload, `financeEntries/${id}`);
      audit(
        tx,
        actor,
        ctx,
        "attachReceipt",
        id,
        replaced ? `Comprovante substituído no lançamento ${current.code} (o anterior foi mantido no histórico de comprovantes)` : `Comprovante anexado ao lançamento ${current.code}`,
        {
          code: current.code,
          replaced: !!replaced,
          previousReceipts: receiptHistory?.length ?? 0,
          ...fileDetails(file),
          ...(replaced ? fileDetails(replaced, "previous_") : {}),
        },
      );
      return { id };
    },
    async present(result, actor) {
      return presentEntry(result.id, actor);
    },
  }),

  /**
   * Lançamentos vinculados a um evento. Atende o Financeiro e também a
   * diretoria do departamento responsável (ou a presidência), que não leem a
   * coleção diretamente.
   */
  listForEvent: query({
    module: "finance",
    schema: eventSchema,
    async run(actor, { eventId }): Promise<StoredEntry[]> {
      actor = actor!;
      await db.runTransaction((tx) => requireModuleEnabled(tx, "finance"), { readOnly: true });
      const evSnap = await db.doc(`events/${eventId}`).get();
      if (!evSnap.exists) fail("not_found", "Evento não encontrado. Pode ter sido removido ou não estar disponível para o seu perfil.");
      if (!visibleTo(evSnap, (s) => canSeeEvent(actor.ctx, eventFromSnap(s)) && canSeeEventFinance(actor.ctx, eventFromSnap(s)))) {
        fail("forbidden", "Seu perfil não tem acesso aos dados financeiros deste evento.");
      }
      const snap = await db.collection("financeEntries").where("eventId", "==", eventId).orderBy("date", "desc").limit(EVENT_ENTRIES_LIMIT).get();
      const full = actor.can("finance.view");
      return snap.docs.map((d) => entryForEventView(normalizeEntry(toDTO<StoredEntry>(d)), full));
    },
  }),
};

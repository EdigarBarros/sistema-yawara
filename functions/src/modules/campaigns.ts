/**
 * CAMPANHAS (RIFAS): campanhas, vendas, travas de números e comprovantes.
 * ---------------------------------------------------------------------------
 * Armazenamento (formato único em src/lib/firestore-model.ts):
 *  - campaigns/{id}                  campanha + `readers` + `stats`
 *  - campaigns/{id}/sales/{saleId}   parte pública da venda (números, situação, pagamento)
 *  - campaigns/{id}/buyers/{saleId}  nome, contato, observações e comprovante + `readers`
 *  - campaigns/{id}/numbers/{00042}  trava do número (venda ATIVA dona do número)
 *
 * Garantias (todas verificadas aqui, no servidor):
 *  - Um número pertence a no máximo uma venda ativa: `registerSale` lê, DENTRO
 *    da transação, as travas de todos os números pedidos e recusa a venda
 *    inteira (conflito) se alguma existir. Nunca há venda parcial. Venda,
 *    comprador, travas e totais são gravados na mesma transação.
 *  - Toda mudança de situação mantém a trava sincronizada; liberar uma venda
 *    cancelada apaga somente as travas que pertencem a ela.
 *  - `stats` (contagem de números por situação) é recalculado a cada operação
 *    a partir do estado lido na transação — nunca vem do navegador.
 *  - Dados pessoais do comprador ficam só em `buyers/{saleId}`, com público
 *    próprio; a resposta de cada operação omite o comprador para quem não
 *    pode vê-lo. A auditoria registra ids e números, nunca nomes ou contatos.
 *  - Campanha encerrada não aceita novas vendas; reservas e pagamentos
 *    pendentes continuam podendo ser convertidos, confirmados, desfeitos ou
 *    cancelados.
 */
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { z } from "zod";
import { campaignDoc, campaignStats, numberDocId, saleBuyerDoc, saleFromDocs, salePublicDoc, type CampaignStats, type SaleBuyerDoc, type SalePublicDoc } from "@/lib/firestore-model";
import { buyerReaders, campaignReaders } from "@/lib/record-readers";
import { canCloseCampaign, canEditSale, canManageCampaign, canSeeBuyer, canSeeCampaign, canSeeEvent, canSellIn } from "@/lib/policies";
import { formatNumberRanges, isSaleActive } from "@/lib/raffle";
import { formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, SALE_STATUS } from "@/lib/labels";
import type { AtleticaEvent, Audience, AudienceScope, Campaign, CampaignAccess, FileRef, PaymentMethod, Sale } from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { nextCode } from "../core/counters";
import { mutation, query, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { finalizeUpload, markAttached } from "../core/files";
import { appendHistory, historyEntry } from "../core/history";
import { notify } from "../core/notify";
import { indexRecord, searchEntryFor } from "../core/search-index";

/** Uma operação aceita no máximo 100 números (leituras e gravações de uma transação). */
export const MAX_NUMBERS_PER_SALE = 100;
/** Acima disso, o público dos compradores é atualizado em lotes logo após a transação. */
const BUYER_READERS_TX_LIMIT = 400;

/* ------------------------------- esquemas ------------------------------- */

const UNKNOWN_FIELDS = { error: "Alguns dados enviados não são aceitos por esta operação. Atualize a página e tente novamente." };
const INVALID_ID = "Identificador inválido.";
const docId = z.string(INVALID_ID).trim().min(1, INVALID_ID).max(128, INVALID_ID).regex(/^[A-Za-z0-9_-]+$/, INVALID_ID);
const dateOnly = z.string("Data inválida.").regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida. Use o formato aaaa-mm-dd.");
/** Data opcional que pode ser apagada na edição (null ou ""). */
const clearableDate = z.union([dateOnly, z.literal("")]).nullable().optional();

const SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const;
const audienceSchema = z.strictObject(
  {
    scope: z.enum(SCOPES, "Escolha quem faz parte do público."),
    departmentId: docId.optional(),
    roleIds: z.array(docId).max(50, "Escolha no máximo 50 cargos.").default([]),
    userIds: z.array(docId).max(300, "Escolha no máximo 300 pessoas.").default([]),
  },
  UNKNOWN_FIELDS,
);
const accessSchema = z.strictObject({ view: audienceSchema, sell: audienceSchema, buyerData: audienceSchema }, UNKNOWN_FIELDS);

const QUANTITY = "A quantidade de números deve ser um número inteiro entre 2 e 10.000.";
const PRICE = "Informe um valor unitário maior que zero.";
const campaignName = z.string("Informe o nome da campanha.").trim().min(3, "Informe o nome da campanha (mínimo de 3 caracteres).").max(90, "O nome pode ter no máximo 90 caracteres.");
const campaignPrize = z.string("Informe o prêmio ou item oferecido.").trim().min(3, "Informe o prêmio ou item oferecido.").max(200, "O prêmio pode ter no máximo 200 caracteres.");
const campaignDescription = z.string().trim().max(600, "A descrição pode ter no máximo 600 caracteres.");
const campaignNotes = z.string().trim().max(600, "As observações podem ter no máximo 600 caracteres.");

const createInput = z.strictObject(
  {
    name: campaignName,
    description: campaignDescription.default(""),
    prize: campaignPrize,
    quantity: z.number(QUANTITY).int(QUANTITY).min(2, QUANTITY).max(10000, QUANTITY),
    unitPrice: z.number(PRICE).int(PRICE).positive(PRICE).max(10_000_000, "O valor unitário pode ser no máximo R$ 100.000,00."),
    drawDate: clearableDate,
    startDate: clearableDate,
    endDate: clearableDate,
    notes: campaignNotes.nullable().optional(),
    access: accessSchema,
    eventId: z.union([docId, z.literal("")]).nullable().optional(),
  },
  UNKNOWN_FIELDS,
);

const updateInput = z.strictObject(
  {
    id: docId,
    input: z.strictObject(
      {
        name: campaignName.optional(),
        description: campaignDescription.optional(),
        prize: campaignPrize.optional(),
        drawDate: clearableDate,
        startDate: clearableDate,
        endDate: clearableDate,
        notes: campaignNotes.nullable().optional(),
        access: accessSchema.optional(),
        eventId: z.union([docId, z.literal("")]).nullable().optional(),
      },
      UNKNOWN_FIELDS,
    ),
  },
  UNKNOWN_FIELDS,
);

const PAYMENT_METHODS = ["pix", "cash", "card", "transfer", "other"] as const;
const paymentMethod = z.enum(PAYMENT_METHODS, "Escolha uma forma de pagamento válida.");
const buyerName = z.string("Informe o nome do comprador.").trim().min(2, "Informe o nome do comprador.").max(120, "O nome do comprador pode ter no máximo 120 caracteres.");
const buyerContact = z
  .string("Informe um contato do comprador (telefone ou e-mail).")
  .trim()
  .min(5, "Informe um contato do comprador (telefone ou e-mail).")
  .max(120, "O contato pode ter no máximo 120 caracteres.")
  .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || v.replace(/\D/g, "").length >= 8, "Informe um telefone com DDD ou um e-mail válido.");
const saleNotes = z.string().trim().max(300, "As observações podem ter no máximo 300 caracteres.");

const registerSaleInput = z.strictObject(
  {
    campaignId: docId,
    numbers: z
      .array(z.number("Números inválidos. Use apenas números inteiros."), "Selecione pelo menos um número.")
      .min(1, "Selecione pelo menos um número.")
      .max(10_000, `Uma venda pode ter no máximo ${MAX_NUMBERS_PER_SALE} números. Divida a seleção em vendas menores.`),
    buyerName,
    buyerContact,
    sellerId: docId,
    status: z.enum(["reserved", "pending", "paid"], "Escolha a situação da venda."),
    paymentMethod: paymentMethod.optional(),
    notes: saleNotes.optional(),
  },
  UNKNOWN_FIELDS,
);

const saleRefShape = { campaignId: docId, saleId: docId };

const updateSaleInput = z.strictObject(
  {
    ...saleRefShape,
    input: z.strictObject(
      {
        buyerName: buyerName.optional(),
        buyerContact: buyerContact.optional(),
        sellerId: docId.optional(),
        notes: saleNotes.optional(),
        paymentMethod: paymentMethod.optional(),
      },
      UNKNOWN_FIELDS,
    ),
  },
  UNKNOWN_FIELDS,
);

const setSaleStatusInput = z.strictObject({ ...saleRefShape, status: z.enum(["reserved", "pending"], "Situação inválida.") }, UNKNOWN_FIELDS);

const confirmPaymentInput = z.strictObject(
  {
    ...saleRefShape,
    paymentMethod: z.enum(PAYMENT_METHODS, "Informe a forma de pagamento."),
    uploadId: z.string().regex(/^[a-f0-9]{32}$/, "Envio de arquivo inválido.").optional(),
  },
  UNKNOWN_FIELDS,
);

const reasonInput = (message: string) =>
  z.strictObject({ ...saleRefShape, reason: z.string(message).trim().min(3, message).max(300, "Use no máximo 300 caracteres no motivo.") }, UNKNOWN_FIELDS);

const saleRefInput = z.strictObject(saleRefShape, UNKNOWN_FIELDS);
const campaignRefInput = z.strictObject({ id: docId }, UNKNOWN_FIELDS);

/* ------------------------------- auxiliares ------------------------------ */

type Stats = CampaignStats;
const STAT_KEYS = ["reserved", "pending", "paid", "cancelled"] as const;

/** Comprador como gravado (pode ter o histórico de comprovantes substituídos). */
type BuyerDocData = SaleBuyerDoc & { receiptHistory?: FileRef[] };

export interface SaleRef {
  campaignId: string;
  saleId: string;
}

const ref = {
  campaign: (id: string) => db.doc(`campaigns/${id}`),
  sales: (campaignId: string) => db.collection(`campaigns/${campaignId}/sales`),
  sale: (campaignId: string, saleId: string) => db.doc(`campaigns/${campaignId}/sales/${saleId}`),
  buyers: (campaignId: string) => db.collection(`campaigns/${campaignId}/buyers`),
  buyer: (campaignId: string, saleId: string) => db.doc(`campaigns/${campaignId}/buyers/${saleId}`),
  lock: (campaignId: string, n: number) => db.doc(`campaigns/${campaignId}/numbers/${numberDocId(n)}`),
};

function zeroStats(): Stats {
  return { reserved: 0, pending: 0, paid: 0, cancelled: 0 };
}

function normalizeStats(raw: unknown): Stats {
  const s = (raw ?? {}) as Partial<Record<keyof Stats, unknown>>;
  const out = zeroStats();
  for (const k of STAT_KEYS) out[k] = typeof s[k] === "number" && Number.isFinite(s[k]) ? (s[k] as number) : 0;
  return out;
}

/** Quantos números a venda ocupa em cada situação (vendas liberadas não ocupam nada). */
function contribution(sale: Sale | null): Stats {
  const s = zeroStats();
  if (sale && isSaleActive(sale)) s[sale.status] += sale.numbers.length;
  return s;
}

/** Totais depois da operação: tira a contribuição anterior da venda e soma a nova. */
function applyDelta(stats: Stats, before: Sale | null, after: Sale): Stats {
  const a = contribution(before);
  const b = contribution(after);
  const out = zeroStats();
  for (const k of STAT_KEYS) out[k] = Math.max(0, stats[k] - a[k] + b[k]);
  return out;
}

function campaignFromData(id: string, data: FirebaseFirestore.DocumentData): { campaign: Campaign; stats: Stats } {
  const { readers: _readers, stats, ...rest } = data;
  void _readers;
  return { campaign: { ...(rest as Omit<Campaign, "id">), id }, stats: normalizeStats(stats) };
}

function campaignNotFound(): never {
  fail("not_found", "Campanha não encontrada. Ela pode ter sido removida ou não estar disponível para o seu perfil.");
}

function saleNotFound(): never {
  fail("not_found", "Venda não encontrada. Ela pode ter sido removida ou não estar disponível para o seu perfil.");
}

function requireVisible(actor: Actor, campaign: Campaign) {
  if (!canSeeCampaign(actor.ctx, campaign)) fail("forbidden", "Esta campanha não está disponível para o seu perfil.");
}

/** Lê a campanha na transação e exige que o autor possa vê-la. */
async function loadCampaign(tx: Transaction, actor: Actor, campaignId: string) {
  const campaignRef = ref.campaign(campaignId);
  const snap = await tx.get(campaignRef);
  if (!snap.exists) campaignNotFound();
  const { campaign, stats } = campaignFromData(snap.id, snap.data()!);
  requireVisible(actor, campaign);
  return { campaignRef, campaign, stats };
}

interface SaleContext {
  campaignRef: DocumentReference;
  campaign: Campaign;
  stats: Stats;
  saleRef: DocumentReference;
  buyerRef: DocumentReference;
  sale: Sale;
  buyerDoc: BuyerDocData | null;
}

/** Lê campanha, parte pública e comprador de uma venda (na transação). */
async function loadSale(tx: Transaction, actor: Actor, { campaignId, saleId }: SaleRef): Promise<SaleContext> {
  const campaignRef = ref.campaign(campaignId);
  const saleRef = ref.sale(campaignId, saleId);
  const buyerRef = ref.buyer(campaignId, saleId);
  const [campaignSnap, saleSnap, buyerSnap] = await tx.getAll(campaignRef, saleRef, buyerRef);
  if (!campaignSnap.exists) campaignNotFound();
  const { campaign, stats } = campaignFromData(campaignSnap.id, campaignSnap.data()!);
  requireVisible(actor, campaign);
  if (!saleSnap.exists) saleNotFound();
  const buyerDoc = buyerSnap.exists ? (buyerSnap.data() as BuyerDocData) : null;
  const sale = saleFromDocs(saleId, saleSnap.data() as SalePublicDoc, buyerDoc);
  if (sale.campaignId !== campaignId) saleNotFound();
  return { campaignRef, campaign, stats, saleRef, buyerRef, sale, buyerDoc };
}

/** Dados do comprador a gravar (público recalculado; histórico de comprovantes preservado). */
function buyerData(campaign: Campaign, sale: Sale, previous: BuyerDocData | null, replacedReceipt?: FileRef): BuyerDocData {
  const doc: BuyerDocData = saleBuyerDoc(campaign, sale);
  const history = [...(previous?.receiptHistory ?? []), ...(replacedReceipt ? [replacedReceipt] : [])];
  if (history.length) doc.receiptHistory = history;
  return doc;
}

function writeSale(tx: Transaction, s: SaleContext, sale: Sale, replacedReceipt?: FileRef) {
  tx.set(s.saleRef, salePublicDoc(sale));
  tx.set(s.buyerRef, buyerData(s.campaign, sale, s.buyerDoc, replacedReceipt));
}

async function readLocks(tx: Transaction, campaignId: string, numbers: number[]): Promise<DocumentSnapshot[]> {
  if (numbers.length === 0) return [];
  return tx.getAll(...numbers.map((n) => ref.lock(campaignId, n)));
}

/**
 * Mantém as travas de acordo com a situação da venda. Só altera travas que
 * pertencem a esta venda (ou que faltam, enquanto ela está ativa); nunca toma
 * um número de outra venda.
 */
function syncLocks(tx: Transaction, campaignId: string, sale: Sale, snaps: DocumentSnapshot[]) {
  const active = isSaleActive(sale);
  sale.numbers.forEach((n, i) => {
    const snap = snaps[i];
    const owner = snap?.exists ? (snap.data()!.saleId as string) : null;
    if (active) {
      if (!owner || owner === sale.id) tx.set(ref.lock(campaignId, n), { saleId: sale.id, status: sale.status });
    } else if (owner === sale.id) {
      tx.delete(ref.lock(campaignId, n));
    }
  });
}

/** Números pedidos: inteiros, sem repetição, ordenados, dentro da campanha e no máximo 100. */
function normalizeNumbers(raw: number[], campaign: Campaign): number[] {
  const invalid = raw.filter((n) => !Number.isInteger(n));
  if (invalid.length) fail("invalid", `Números inválidos: ${invalid.slice(0, 10).join(", ")}. Use apenas números inteiros.`);
  const numbers = [...new Set(raw)].sort((a, b) => a - b);
  if (numbers.length === 0) fail("invalid", "Selecione pelo menos um número.");
  const outOfRange = numbers.filter((n) => n < 1 || n > campaign.quantity);
  if (outOfRange.length) {
    fail("invalid", `Números fora da campanha (1 a ${campaign.quantity}): ${outOfRange.slice(0, 20).join(", ")}${outOfRange.length > 20 ? "…" : ""}.`);
  }
  if (numbers.length > MAX_NUMBERS_PER_SALE) {
    fail(
      "invalid",
      `Uma venda pode ter no máximo ${MAX_NUMBERS_PER_SALE} números por operação (foram escolhidos ${numbers.length}). Divida a seleção em vendas separadas de até ${MAX_NUMBERS_PER_SALE} números.`,
    );
  }
  return numbers;
}

const ACCESS_RULES: Record<keyof CampaignAccess, { label: string; scopes: AudienceScope[] }> = {
  view: { label: "Quem pode visualizar", scopes: ["board", "all", "roles", "people"] },
  sell: { label: "Quem pode registrar vendas", scopes: ["directors", "directors_advisors", "all", "roles", "people"] },
  buyerData: { label: "Quem pode consultar dados dos compradores", scopes: ["board", "directors", "roles", "people"] },
};

function sanitizeAudience(a: Audience): Audience {
  return {
    scope: a.scope,
    departmentId: a.scope === "department" ? a.departmentId : undefined,
    roleIds: a.scope === "roles" ? [...new Set(a.roleIds)].sort() : [],
    userIds: a.scope === "people" ? [...new Set(a.userIds)].sort() : [],
  };
}

const ACCESS_KEYS = Object.keys(ACCESS_RULES) as (keyof CampaignAccess)[];

/** Normaliza e valida a configuração de acesso (opções disponíveis em cada pergunta, listas não vazias). */
function sanitizeAccess(access: CampaignAccess): CampaignAccess {
  const out = {} as CampaignAccess;
  for (const key of ACCESS_KEYS) {
    const rule = ACCESS_RULES[key];
    const a = sanitizeAudience(access[key]);
    if (!rule.scopes.includes(a.scope)) fail("invalid", `${rule.label}: opção de público não disponível.`);
    if (a.scope === "roles" && a.roleIds.length === 0) fail("invalid", `${rule.label}: escolha pelo menos um cargo.`);
    if (a.scope === "people" && a.userIds.length === 0) fail("invalid", `${rule.label}: escolha pelo menos uma pessoa.`);
    out[key] = a;
  }
  return out;
}

function sameAudience(a: Audience, b: Audience) {
  const x = sanitizeAudience(a);
  const y = sanitizeAudience(b);
  return x.scope === y.scope && x.departmentId === y.departmentId && x.roleIds.join(",") === y.roleIds.join(",") && x.userIds.join(",") === y.userIds.join(",");
}

function validateDates(c: Pick<Campaign, "startDate" | "endDate" | "drawDate">) {
  if (c.startDate && c.endDate && c.endDate < c.startDate) fail("invalid", "A data de encerramento não pode ser anterior à data de início.");
  if (c.startDate && c.drawDate && c.drawDate < c.startDate) fail("invalid", "A data do sorteio não pode ser anterior à data de início.");
  if (c.endDate && c.drawDate && c.drawDate < c.endDate) fail("invalid", "O sorteio deve ser no dia do encerramento ou depois.");
}

/** O evento relacionado precisa existir e estar visível para quem vincula. */
async function requireLinkableEvent(tx: Transaction, actor: Actor, eventId: string) {
  const snap = await tx.get(db.doc(`events/${eventId}`));
  let visible = false;
  if (snap.exists) {
    const data = snap.data()!;
    try {
      const event = { ...data, id: snap.id, responsibleIds: data.responsibleIds ?? [] } as AtleticaEvent;
      visible = canSeeEvent(actor.ctx, event);
    } catch {
      visible = false;
    }
  }
  if (!visible) fail("invalid", "O evento relacionado não foi encontrado ou não está disponível para o seu perfil.");
}

/** Remove valores "apagados" (null ou texto vazio). */
function cleared<T>(value: T | null | "" | undefined, current: T | undefined): T | undefined {
  if (value === undefined) return current;
  if (value === null || value === "") return undefined;
  return value;
}

function audit(
  tx: Transaction,
  actor: Actor,
  ctx: RunContext,
  action: string,
  resourceType: "campaign" | "sale",
  resourceId: string,
  summary: string,
  details?: Record<string, string | number | boolean | null>,
) {
  auditInTx(tx, { uid: actor.uid, name: actor.name }, { action: `campaigns.${action}`, module: "campaigns", resourceType, resourceId, summary, details }, ctx.requestId, ctx.now);
}

function saleAuditDetails(campaign: Campaign, sale: Sale): Record<string, string | number | boolean | null> {
  return { campaignId: campaign.id, saleId: sale.id, numbers: formatNumberRanges(sale.numbers, campaign.quantity), count: sale.numbers.length, status: sale.status };
}

function label(campaign: Campaign, numbers: number[]) {
  return formatNumberRanges(numbers, campaign.quantity);
}

/* ------------------------------- respostas ------------------------------- */

/** Venda como o autor pode vê-la: comprador, observações e comprovante só para quem tem acesso. */
export function redactSale(actor: Actor, campaign: Campaign, sale: Sale): Sale {
  if (actor.can("campaigns.view") && canSeeBuyer(actor.ctx, campaign, sale)) return sale;
  return { ...sale, buyer: null, notes: undefined, receipt: undefined };
}

export async function presentCampaign(id: string): Promise<Campaign> {
  const snap = await ref.campaign(id).get();
  if (!snap.exists) campaignNotFound();
  return campaignFromData(snap.id, snap.data()!).campaign;
}

/** Venda montada para o autor (usada como resposta das operações). */
export async function presentSale(actor: Actor, { campaignId, saleId }: SaleRef): Promise<Sale> {
  const [campaignSnap, saleSnap, buyerSnap] = await db.getAll(ref.campaign(campaignId), ref.sale(campaignId, saleId), ref.buyer(campaignId, saleId));
  if (!campaignSnap.exists) campaignNotFound();
  if (!saleSnap.exists) saleNotFound();
  const { campaign } = campaignFromData(campaignSnap.id, campaignSnap.data()!);
  const sale = saleFromDocs(saleId, saleSnap.data() as SalePublicDoc, buyerSnap.exists ? (buyerSnap.data() as SaleBuyerDoc) : null);
  return redactSale(actor, campaign, sale);
}

/** Vendas de uma campanha como o autor pode vê-las (mesma regra das leituras pelo navegador). */
export async function listSalesFor(actor: Actor, campaign: Campaign): Promise<Sale[]> {
  const [sales, buyers] = await Promise.all([ref.sales(campaign.id).get(), ref.buyers(campaign.id).get()]);
  const buyerMap = new Map(buyers.docs.map((d) => [d.id, d.data() as SaleBuyerDoc]));
  return sales.docs.map((d) => redactSale(actor, campaign, saleFromDocs(d.id, d.data() as SalePublicDoc, buyerMap.get(d.id) ?? null)));
}

/* --------------------------------- ações --------------------------------- */

const presentCampaignResult = async (result: { id: string }) => presentCampaign(result.id);
const presentSaleResult = async (result: SaleRef, actor: Actor | null) => presentSale(actor!, result);

export const campaignsActions = {
  create: mutation({
    module: "campaigns",
    schema: createInput,
    async run(tx, actor, input, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      requirePermission(actor, "campaigns.create", "Seu perfil não pode criar campanhas.");
      const access = sanitizeAccess(input.access);
      const dates = { startDate: input.startDate || undefined, endDate: input.endDate || undefined, drawDate: input.drawDate || undefined };
      validateDates(dates);
      const eventId = input.eventId || undefined;
      if (eventId) await requireLinkableEvent(tx, actor, eventId);
      const code = await nextCode(tx, ctx, "RIFA");

      const campaignRef = db.collection("campaigns").doc();
      const campaign: Campaign = {
        id: campaignRef.id,
        kind: "raffle",
        code,
        name: input.name,
        description: input.description,
        prize: input.prize,
        status: "active",
        departmentId: actor.role.departmentId,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        ...dates,
        notes: input.notes || undefined,
        eventId,
        access,
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedBy: actor.uid,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", `Campanha criada com ${input.quantity} números a ${formatMoney(input.unitPrice)}`, ctx.now)],
      };
      tx.create(campaignRef, campaignDoc(campaign, zeroStats()));
      indexRecord(tx, searchEntryFor.campaign(campaign));
      audit(tx, actor, ctx, "create", "campaign", campaign.id, `Campanha criada: ${campaign.code} · ${campaign.name}`, {
        code,
        quantity: campaign.quantity,
        unitPrice: campaign.unitPrice,
        eventId: eventId ?? null,
      });
      const author = actor;
      ctx.after(async () => {
        await notify({
          eventKey: `campaign_shared__${campaign.id}`,
          kind: "campaign_shared",
          title: "Nova campanha disponível",
          body: `${author.name} criou “${campaign.name}”.`,
          href: `/campanhas/${campaign.id}`,
          module: "campaigns",
          readers: campaignReaders(campaign),
          actorId: author.uid,
        });
      });
      return { id: campaign.id };
    },
    present: presentCampaignResult,
  }),

  update: mutation({
    module: "campaigns",
    schema: updateInput,
    async run(tx, actor, { id, input }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const { campaignRef, campaign, stats } = await loadCampaign(tx, actor, id);
      if (!canManageCampaign(actor.ctx, campaign)) fail("forbidden", "Seu perfil não pode editar esta campanha.");

      const proposed = input.access ?? campaign.access;
      const viewChanged = !sameAudience(proposed.view, campaign.access.view);
      const sellChanged = !sameAudience(proposed.sell, campaign.access.sell);
      const buyerDataChanged = !sameAudience(proposed.buyerData, campaign.access.buyerData);
      const accessChanged = viewChanged || sellChanged || buyerDataChanged;
      // Só valida (e regrava) o acesso quando ele de fato muda.
      const access = accessChanged ? sanitizeAccess(proposed) : campaign.access;

      const next: Campaign = {
        ...campaign,
        name: input.name ?? campaign.name,
        prize: input.prize ?? campaign.prize,
        description: input.description ?? campaign.description,
        notes: cleared(input.notes, campaign.notes),
        startDate: cleared(input.startDate, campaign.startDate),
        endDate: cleared(input.endDate, campaign.endDate),
        drawDate: cleared(input.drawDate, campaign.drawDate),
        eventId: cleared(input.eventId, campaign.eventId),
        access,
        updatedBy: actor.uid,
        updatedAt: ctx.now,
      };
      const datesChanged = next.startDate !== campaign.startDate || next.endDate !== campaign.endDate || next.drawDate !== campaign.drawDate;
      if (datesChanged) validateDates(next);
      if (next.eventId && next.eventId !== campaign.eventId) await requireLinkableEvent(tx, actor, next.eventId);
      // Mudou quem vê os compradores: o público de cada `buyers/{saleId}` precisa acompanhar.
      const buyersSnap = buyerDataChanged ? await tx.get(ref.buyers(id)) : null;

      next.history = appendHistory(
        campaign.history,
        historyEntry(actor.uid, "updated", "Dados da campanha editados", ctx.now),
        ...(accessChanged ? [historyEntry(actor.uid, "shared", "Configuração de acesso e permissões alterada", ctx.now)] : []),
      );
      tx.set(campaignRef, campaignDoc(next, stats));
      indexRecord(tx, searchEntryFor.campaign(next));

      const overflow: { id: string; sellerId: string; registeredById: string }[] = [];
      if (buyersSnap) {
        buyersSnap.docs.forEach((d, i) => {
          const data = d.data() as SaleBuyerDoc;
          const item = { id: d.id, sellerId: data.sellerId, registeredById: data.registeredById };
          if (i < BUYER_READERS_TX_LIMIT) tx.update(d.ref, { readers: buyerReaders(next, item) });
          else overflow.push(item);
        });
      }
      const changed = [
        input.name !== undefined && input.name !== campaign.name ? "nome" : null,
        input.prize !== undefined && input.prize !== campaign.prize ? "prêmio" : null,
        input.description !== undefined && input.description !== campaign.description ? "descrição" : null,
        next.notes !== campaign.notes ? "observações" : null,
        datesChanged ? "datas" : null,
        next.eventId !== campaign.eventId ? "evento relacionado" : null,
        viewChanged ? "quem vê" : null,
        sellChanged ? "quem vende" : null,
        buyerDataChanged ? "quem vê os compradores" : null,
      ].filter(Boolean);
      audit(tx, actor, ctx, "update", "campaign", id, `Campanha ${campaign.code} editada: ${changed.join(", ") || "sem alterações"}`, {
        accessChanged,
        buyersReadersUpdated: buyersSnap ? buyersSnap.size : 0,
      });

      if (overflow.length) {
        ctx.after(async () => {
          for (let i = 0; i < overflow.length; i += 400) {
            const batch = db.batch();
            for (const item of overflow.slice(i, i + 400)) batch.update(ref.buyer(id, item.id), { readers: buyerReaders(next, item) });
            await batch.commit();
          }
          logger.info("Público dos compradores atualizado em lotes", { campaignId: id, count: overflow.length });
        });
      }
      if (accessChanged) {
        const author = actor;
        // Mesma chave da criação: só quem ainda não foi avisado recebe (novos integrantes do público).
        ctx.after(async () => {
          await notify({
            eventKey: `campaign_shared__${id}`,
            kind: "campaign_shared",
            title: "Campanha compartilhada com você",
            body: `${author.name} compartilhou “${next.name}”.`,
            href: `/campanhas/${id}`,
            module: "campaigns",
            readers: campaignReaders(next),
            actorId: author.uid,
          });
        });
      }
      return { id };
    },
    present: presentCampaignResult,
  }),

  close: mutation({
    module: "campaigns",
    schema: campaignRefInput,
    async run(tx, actor, { id }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const { campaignRef, campaign, stats } = await loadCampaign(tx, actor, id);
      if (!canCloseCampaign(actor.ctx, campaign)) fail("forbidden", "Seu perfil não pode encerrar campanhas.");
      if (campaign.status === "closed") fail("conflict", "A campanha já está encerrada.");
      const next: Campaign = {
        ...campaign,
        status: "closed",
        closedAt: ctx.now,
        closedBy: actor.uid,
        updatedAt: ctx.now,
        updatedBy: actor.uid,
        history: appendHistory(campaign.history, historyEntry(actor.uid, "closed", "Campanha encerrada para novas vendas", ctx.now)),
      };
      tx.set(campaignRef, campaignDoc(next, stats));
      indexRecord(tx, searchEntryFor.campaign(next));
      audit(tx, actor, ctx, "close", "campaign", id, `Campanha ${campaign.code} encerrada para novas vendas (${stats.reserved} reservado(s) e ${stats.pending} pendente(s) continuam gerenciáveis)`, {
        reserved: stats.reserved,
        pending: stats.pending,
        paid: stats.paid,
      });
      const author = actor;
      const stamp = ctx.now.replace(/\D/g, "");
      ctx.after(async () => {
        await notify({
          eventKey: `campaign_closed__${id}__${stamp}`,
          kind: "campaign_closed",
          title: "Campanha encerrada",
          body: `“${next.name}” foi encerrada para novas vendas.`,
          href: `/campanhas/${id}`,
          module: "campaigns",
          readers: campaignReaders(next),
          actorId: author.uid,
        });
      });
      return { id };
    },
    present: presentCampaignResult,
  }),

  reopen: mutation({
    module: "campaigns",
    schema: campaignRefInput,
    async run(tx, actor, { id }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const { campaignRef, campaign, stats } = await loadCampaign(tx, actor, id);
      if (!canCloseCampaign(actor.ctx, campaign)) fail("forbidden", "Seu perfil não pode reabrir campanhas.");
      if (campaign.status === "active") fail("conflict", "A campanha já está ativa.");
      const next: Campaign = {
        ...campaign,
        status: "active",
        closedAt: undefined,
        closedBy: undefined,
        updatedAt: ctx.now,
        updatedBy: actor.uid,
        history: appendHistory(campaign.history, historyEntry(actor.uid, "reopened", "Campanha reaberta para vendas", ctx.now)),
      };
      tx.set(campaignRef, campaignDoc(next, stats));
      indexRecord(tx, searchEntryFor.campaign(next));
      audit(tx, actor, ctx, "reopen", "campaign", id, `Campanha ${campaign.code} reaberta para vendas`);
      return { id };
    },
    present: presentCampaignResult,
  }),

  registerSale: mutation({
    module: "campaigns",
    schema: registerSaleInput,
    async run(tx, actor, input, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const { campaignRef, campaign, stats } = await loadCampaign(tx, actor, input.campaignId);
      if (campaign.status !== "active") fail("conflict", "Esta campanha está encerrada e não aceita novas vendas.");
      if (!canSellIn(actor.ctx, campaign)) fail("forbidden", "Seu perfil não está autorizado a registrar vendas nesta campanha.");
      if (input.status === "paid") {
        requirePermission(actor, "campaigns.approve", "Seu perfil não pode registrar uma venda já como paga. Registre como pendente; quem confirma recebimentos fará a confirmação.");
        if (!input.paymentMethod) fail("invalid", "Informe a forma de pagamento.");
      }
      const numbers = normalizeNumbers(input.numbers, campaign);

      // Leituras: responsável pela venda + travas de TODOS os números pedidos.
      const [sellerSnap, ...lockSnaps] = await tx.getAll(db.doc(`members/${input.sellerId}`), ...numbers.map((n) => ref.lock(campaign.id, n)));
      if (!sellerSnap.exists || sellerSnap.data()!.status !== "active") fail("invalid", "Escolha um responsável pela venda que esteja ativo.");
      const blocked = numbers.filter((_, i) => lockSnaps[i].exists);
      if (blocked.length) {
        fail("conflict", `Estes números já não estão disponíveis: ${label(campaign, blocked)}. Atualize a seleção e tente novamente.`, { numbers: blocked });
      }

      const saleRef = ref.sales(campaign.id).doc();
      const numbersLabel = label(campaign, numbers);
      const sale: Sale = {
        id: saleRef.id,
        campaignId: campaign.id,
        numbers,
        buyer: { name: input.buyerName, contact: input.buyerContact },
        sellerId: input.sellerId,
        registeredById: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        status: input.status,
        paymentMethod: input.status === "reserved" ? undefined : (input.paymentMethod as PaymentMethod | undefined),
        notes: input.notes || undefined,
        history: [
          historyEntry(
            actor.uid,
            input.status === "reserved" ? "status" : "sale",
            input.status === "reserved" ? `Reserva registrada (${numbersLabel})` : `Venda registrada (${numbersLabel})`,
            ctx.now,
          ),
        ],
      };
      if (input.status === "paid") {
        sale.paidAt = ctx.now;
        sale.confirmedById = actor.uid;
        sale.history.push(historyEntry(actor.uid, "payment", `Pagamento confirmado no registro (${PAYMENT_METHOD_LABELS[input.paymentMethod!]})`, ctx.now));
      }

      tx.create(saleRef, salePublicDoc(sale));
      tx.create(ref.buyer(campaign.id, sale.id), saleBuyerDoc(campaign, sale));
      for (const n of numbers) tx.create(ref.lock(campaign.id, n), { saleId: sale.id, status: sale.status });
      tx.update(campaignRef, { stats: applyDelta(stats, null, sale), updatedAt: ctx.now });
      audit(
        tx,
        actor,
        ctx,
        "registerSale",
        "sale",
        sale.id,
        `${input.status === "reserved" ? "Reserva" : "Venda"} registrada na campanha ${campaign.code}: ${numbers.length} número(s) (${numbersLabel}) · ${SALE_STATUS[sale.status].label}`,
        saleAuditDetails(campaign, sale),
      );
      return { campaignId: campaign.id, saleId: sale.id };
    },
    present: presentSaleResult,
  }),

  updateSale: mutation({
    module: "campaigns",
    schema: updateSaleInput,
    async run(tx, actor, { campaignId, saleId, input }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const s = await loadSale(tx, actor, { campaignId, saleId });
      const current = s.sale;
      if (!canEditSale(actor.ctx, current)) fail("forbidden", "Seu perfil não pode editar esta venda.");
      if (current.status === "cancelled") fail("conflict", "Vendas canceladas não podem ser editadas.");
      const buyerAllowed = canSeeBuyer(actor.ctx, s.campaign, current);
      if ((input.buyerName !== undefined || input.buyerContact !== undefined) && !buyerAllowed) {
        fail("forbidden", "Seu perfil não pode alterar os dados pessoais deste comprador.");
      }
      const nextNotes = input.notes === undefined ? current.notes : input.notes || undefined;
      if (nextNotes !== current.notes && !buyerAllowed) fail("forbidden", "Seu perfil não pode alterar as observações desta venda.");
      const sellerChanged = !!input.sellerId && input.sellerId !== current.sellerId;
      if (sellerChanged) {
        const sellerSnap = await tx.get(db.doc(`members/${input.sellerId}`));
        if (!sellerSnap.exists || sellerSnap.data()!.status !== "active") fail("invalid", "Escolha um responsável pela venda que esteja ativo.");
      }

      const next: Sale = { ...current, buyer: current.buyer ? { ...current.buyer } : null, history: [...current.history] };
      const changes: string[] = [];
      if (input.buyerName !== undefined && input.buyerName !== current.buyer?.name) {
        next.buyer = { name: input.buyerName, contact: next.buyer?.contact ?? "" };
        changes.push("nome do comprador");
      }
      if (input.buyerContact !== undefined && input.buyerContact !== current.buyer?.contact) {
        next.buyer = { name: next.buyer?.name ?? "", contact: input.buyerContact };
        changes.push("contato");
      }
      if (sellerChanged) {
        next.sellerId = input.sellerId!;
        changes.push("responsável pela venda");
      }
      if (input.paymentMethod && input.paymentMethod !== current.paymentMethod) {
        next.paymentMethod = input.paymentMethod;
        changes.push("forma de pagamento");
      }
      if (nextNotes !== current.notes) {
        next.notes = nextNotes;
        changes.push("observações");
      }
      if (changes.length === 0) return { campaignId, saleId };

      next.updatedAt = ctx.now;
      next.history = appendHistory(current.history, historyEntry(actor.uid, "updated", `Alterado: ${changes.join(", ")}`, ctx.now));
      writeSale(tx, s, next);
      audit(tx, actor, ctx, "updateSale", "sale", saleId, `Venda ${label(s.campaign, current.numbers)} da campanha ${s.campaign.code} alterada: ${changes.join(", ")}`, {
        ...saleAuditDetails(s.campaign, next),
        sellerChanged,
      });
      return { campaignId, saleId };
    },
    present: presentSaleResult,
  }),

  setSaleStatus: mutation({
    module: "campaigns",
    schema: setSaleStatusInput,
    async run(tx, actor, { campaignId, saleId, status }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const s = await loadSale(tx, actor, { campaignId, saleId });
      const current = s.sale;
      if (!canEditSale(actor.ctx, current)) fail("forbidden", "Seu perfil não pode alterar esta venda.");
      if (current.status === "paid" || current.status === "cancelled") {
        fail("conflict", "Só é possível alternar entre reservado e pendente antes do pagamento.");
      }
      if (current.status === status) return { campaignId, saleId };
      const locks = await readLocks(tx, campaignId, current.numbers);

      const next: Sale = {
        ...current,
        status,
        updatedAt: ctx.now,
        history: appendHistory(
          current.history,
          historyEntry(actor.uid, "status", status === "pending" ? "Reserva convertida em venda com pagamento pendente" : "Venda voltou para reservada", ctx.now),
        ),
      };
      writeSale(tx, s, next);
      syncLocks(tx, campaignId, next, locks);
      tx.update(s.campaignRef, { stats: applyDelta(s.stats, current, next) });
      audit(tx, actor, ctx, "setSaleStatus", "sale", saleId, `Venda ${label(s.campaign, current.numbers)} da campanha ${s.campaign.code}: ${SALE_STATUS[current.status].label} → ${SALE_STATUS[status].label}`, {
        ...saleAuditDetails(s.campaign, next),
        from: current.status,
      });
      return { campaignId, saleId };
    },
    present: presentSaleResult,
  }),

  confirmPayment: mutation({
    module: "campaigns",
    schema: confirmPaymentInput,
    async prepare(actor, input, ctx) {
      if (!input.uploadId) return null;
      // Conferência antecipada (a permissão é verificada de novo dentro da transação).
      requirePermission(actor, "campaigns.approve", "Seu perfil não pode confirmar recebimentos.");
      return finalizeUpload(actor, input.uploadId, "saleReceipt", `campaigns/${input.campaignId}/receipts/${input.saleId}`, ctx);
    },
    async run(tx, actor, { campaignId, saleId, paymentMethod: method, uploadId }, ctx, receipt: FileRef | null) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const s = await loadSale(tx, actor, { campaignId, saleId });
      requirePermission(actor, "campaigns.approve", "Seu perfil não pode confirmar recebimentos.");
      const current = s.sale;
      if (current.status === "paid") fail("conflict", "O pagamento desta venda já foi confirmado.");
      if (current.status === "cancelled") fail("conflict", "Não é possível confirmar pagamento de uma venda cancelada.");
      const locks = await readLocks(tx, campaignId, current.numbers);

      const next: Sale = {
        ...current,
        status: "paid",
        paymentMethod: method,
        paidAt: ctx.now,
        confirmedById: actor.uid,
        updatedAt: ctx.now,
        receipt: receipt ?? current.receipt,
        history: appendHistory(
          current.history,
          historyEntry(actor.uid, "payment", `Pagamento confirmado (${PAYMENT_METHOD_LABELS[method]})${receipt ? " com comprovante anexado" : ""}`, ctx.now),
        ),
      };
      const replaced = receipt && current.receipt && current.receipt.path !== receipt.path ? current.receipt : undefined;
      writeSale(tx, s, next, replaced);
      syncLocks(tx, campaignId, next, locks);
      tx.update(s.campaignRef, { stats: applyDelta(s.stats, current, next) });
      if (receipt && uploadId) markAttached(tx, uploadId, `campaigns/${campaignId}/buyers/${saleId}`);
      audit(
        tx,
        actor,
        ctx,
        "confirmPayment",
        "sale",
        saleId,
        `Pagamento confirmado na campanha ${s.campaign.code}: números ${label(s.campaign, current.numbers)} (${PAYMENT_METHOD_LABELS[method]})${receipt ? ", com comprovante" : ""}`,
        { ...saleAuditDetails(s.campaign, next), from: current.status, paymentMethod: method, receipt: !!receipt },
      );
      return { campaignId, saleId };
    },
    present: presentSaleResult,
  }),

  revertPayment: mutation({
    module: "campaigns",
    schema: reasonInput("Explique o motivo para desfazer a confirmação."),
    async run(tx, actor, { campaignId, saleId, reason }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const s = await loadSale(tx, actor, { campaignId, saleId });
      requirePermission(actor, "campaigns.approve", "Seu perfil não pode desfazer confirmações de pagamento.");
      const current = s.sale;
      if (current.status !== "paid") fail("conflict", "Esta venda não está marcada como paga.");
      const locks = await readLocks(tx, campaignId, current.numbers);

      const next: Sale = {
        ...current,
        status: "pending",
        paidAt: undefined,
        confirmedById: undefined,
        updatedAt: ctx.now,
        history: appendHistory(current.history, historyEntry(actor.uid, "payment", `Confirmação de pagamento desfeita: ${reason}`, ctx.now)),
      };
      writeSale(tx, s, next);
      syncLocks(tx, campaignId, next, locks);
      tx.update(s.campaignRef, { stats: applyDelta(s.stats, current, next) });
      // O motivo fica no histórico da venda; a auditoria não copia texto livre (pode conter dados pessoais).
      audit(tx, actor, ctx, "revertPayment", "sale", saleId, `Confirmação de pagamento desfeita na campanha ${s.campaign.code}: números ${label(s.campaign, current.numbers)} (motivo no histórico da venda)`, {
        ...saleAuditDetails(s.campaign, next),
        from: current.status,
      });
      return { campaignId, saleId };
    },
    present: presentSaleResult,
  }),

  cancelSale: mutation({
    module: "campaigns",
    schema: reasonInput("Informe o motivo do cancelamento."),
    async run(tx, actor, { campaignId, saleId, reason }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const s = await loadSale(tx, actor, { campaignId, saleId });
      const current = s.sale;
      if (current.status === "cancelled") fail("conflict", "Esta venda já está cancelada.");
      if (current.status === "paid") {
        requirePermission(actor, "campaigns.approve", "Vendas já pagas só podem ser canceladas por quem confirma recebimentos.");
      } else if (!canEditSale(actor.ctx, current)) {
        fail("forbidden", "Seu perfil não pode cancelar esta venda.");
      }
      const locks = await readLocks(tx, campaignId, current.numbers);

      const wasPaid = current.status === "paid";
      const next: Sale = {
        ...current,
        status: "cancelled",
        cancelledAt: ctx.now,
        cancelledById: actor.uid,
        cancelReason: reason,
        updatedAt: ctx.now,
        history: appendHistory(
          current.history,
          historyEntry(actor.uid, "cancelled", `Venda cancelada${wasPaid ? " (estava paga — verificar devolução)" : ""}: ${reason}`, ctx.now),
        ),
      };
      writeSale(tx, s, next);
      syncLocks(tx, campaignId, next, locks);
      tx.update(s.campaignRef, { stats: applyDelta(s.stats, current, next) });
      audit(
        tx,
        actor,
        ctx,
        "cancelSale",
        "sale",
        saleId,
        `Venda cancelada na campanha ${s.campaign.code}: números ${label(s.campaign, current.numbers)}${wasPaid ? " (estava paga)" : ""} (motivo no histórico da venda)`,
        { ...saleAuditDetails(s.campaign, next), from: current.status },
      );
      return { campaignId, saleId };
    },
    present: presentSaleResult,
  }),

  releaseSale: mutation({
    module: "campaigns",
    schema: saleRefInput,
    async run(tx, actor, { campaignId, saleId }, ctx) {
      actor = actor!;
      await requireModuleEnabled(tx, "campaigns");
      const s = await loadSale(tx, actor, { campaignId, saleId });
      requirePermission(actor, "campaigns.edit", "Seu perfil não pode liberar números cancelados.");
      const current = s.sale;
      if (current.status !== "cancelled") fail("conflict", "Só é possível liberar números de vendas canceladas.");
      if (current.releasedAt) fail("conflict", "Os números desta venda já foram liberados.");
      const locks = await readLocks(tx, campaignId, current.numbers);
      const clash = current.numbers.filter((_, i) => locks[i].exists && locks[i].data()!.saleId !== saleId);
      if (clash.length) fail("conflict", `Os números ${label(s.campaign, clash)} já estão em outra venda.`, { numbers: clash });

      const next: Sale = {
        ...current,
        releasedAt: ctx.now,
        releasedById: actor.uid,
        updatedAt: ctx.now,
        history: appendHistory(
          current.history,
          historyEntry(actor.uid, "released", `Números ${label(s.campaign, current.numbers)} liberados para nova venda (registro cancelado mantido)`, ctx.now),
        ),
      };
      writeSale(tx, s, next);
      syncLocks(tx, campaignId, next, locks);
      tx.update(s.campaignRef, { stats: applyDelta(s.stats, current, next) });
      audit(tx, actor, ctx, "releaseSale", "sale", saleId, `Números ${label(s.campaign, current.numbers)} da campanha ${s.campaign.code} liberados para nova venda`, saleAuditDetails(s.campaign, next));
      return { campaignId, saleId };
    },
    present: presentSaleResult,
  }),

  /** Reparo: recalcula os totais da campanha a partir das vendas gravadas. */
  recount: mutation({
    module: "campaigns",
    schema: campaignRefInput,
    async run(tx, actor, { id }, ctx) {
      actor = actor!;
      requirePermission(actor, "campaigns.admin", "Somente quem administra campanhas pode recalcular os totais.");
      const { campaignRef, campaign, stats } = await loadCampaign(tx, actor, id);
      const salesSnap = await tx.get(ref.sales(id));
      const sales = salesSnap.docs.map((d) => saleFromDocs(d.id, d.data() as SalePublicDoc, null));
      const after = campaignStats(campaign, sales);
      const changed = STAT_KEYS.some((k) => after[k] !== stats[k]);
      if (changed) tx.update(campaignRef, { stats: after });
      const fmt = (s: Stats) => `${s.reserved} reservado(s), ${s.pending} pendente(s), ${s.paid} pago(s), ${s.cancelled} cancelado(s)`;
      audit(tx, actor, ctx, "recount", "campaign", id, changed ? `Totais da campanha ${campaign.code} corrigidos: ${fmt(stats)} → ${fmt(after)}` : `Totais da campanha ${campaign.code} conferidos (sem diferenças)`, {
        changed,
        sales: sales.length,
      });
      return { id, changed, before: stats, after };
    },
  }),

  /** Vendas da campanha como o autor pode vê-las (o navegador lê direto do Firestore; usado em diagnósticos e testes). */
  listSales: query({
    module: "campaigns",
    schema: z.strictObject({ campaignId: docId }, UNKNOWN_FIELDS),
    async run(actor, { campaignId }) {
      actor = actor!;
      requirePermission(actor, "campaigns.view", "Seu perfil não pode ver campanhas.");
      const snap = await ref.campaign(campaignId).get();
      if (!snap.exists) campaignNotFound();
      const { campaign } = campaignFromData(snap.id, snap.data()!);
      requireVisible(actor, campaign);
      return listSalesFor(actor, campaign);
    },
  }),
};

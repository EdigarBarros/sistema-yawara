/**
 * DOCUMENTOS: biblioteca institucional com versões (Cloud Storage).
 * ---------------------------------------------------------------------------
 * Armazenamento:
 *  - Firestore: `documents/{id}` = documentDoc(documento), com `readers`
 *    (público + criador) sempre recalculado aqui.
 *  - Storage: `documents/{docId}/v{n}/{uploadId}-{nome}`. As regras do Storage
 *    leem `documents/{docId}.readers` a cada download: mudar o
 *    compartilhamento vale imediatamente também para os arquivos.
 *
 * Arquivos: o navegador envia o arquivo para a área temporária (com tíquete) e
 * manda o `uploadId`. Na etapa `prepare`, `finalizeUpload` confere o conteúdo
 * real (assinatura binária), calcula o SHA-256 e move o arquivo para o caminho
 * definitivo; se a transação falhar, o arquivo movido é apagado.
 *  - Criar com arquivo: o id do novo documento é derivado da requisição
 *    (sha256 de `uid:requestId`), então o reenvio da mesma requisição aponta
 *    para o mesmo documento e a mesma pasta.
 *  - Nova versão: o número é calculado na transação (lendo o documento) e
 *    precisa coincidir com a pasta preparada; versões anteriores nunca são
 *    apagadas. Documento arquivado não recebe versões.
 *
 * Regras (as mesmas do serviço de demonstração e de src/lib/policies.ts):
 *  - Ver: `canSeeDocument` (público, criador ou documents.admin).
 *  - Criar: documents.create.
 *  - Editar, compartilhar e enviar versões: `canEditDocument` (criador,
 *    documents.admin ou documents.edit no mesmo departamento do documento).
 *  - Marcar como "Vigente": documents.approve ou criador.
 *  - Arquivar/restaurar: `canArchiveDocument` (criador ou documents.archive).
 *    Arquivar não apaga nada (nem arquivos).
 *  - Categoria, departamento, público e vínculos (evento, reunião, projeto)
 *    precisam existir; vínculos precisam estar visíveis para quem os faz.
 *
 * A auditoria não registra nomes de arquivo nem conteúdo — apenas ids,
 * versão, tipo, tamanho e o resumo SHA-256 calculado pelo servidor.
 */
import { createHash } from "node:crypto";
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { documentDoc } from "@/lib/firestore-model";
import { AUDIENCE_SCOPE_LABELS, DOCUMENT_STATUS } from "@/lib/labels";
import { canArchiveDocument, canEditDocument, canSeeDocument, canSeeEvent, canSeeMeeting, canSeeProject } from "@/lib/policies";
import { documentReaders } from "@/lib/record-readers";
import type {
  AtleticaEvent,
  Audience,
  AudienceScope,
  DocumentLinks,
  DocumentStatus,
  DocumentVersion,
  ExtensionProject,
  FileRef,
  HistoryAction,
  HistoryEntry,
  InstitutionalDocument,
  Meeting,
} from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { mutation, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { finalizeUpload, markAttached } from "../core/files";
import { appendHistory, historyEntry } from "../core/history";
import { notify } from "../core/notify";
import { requireDoc, toDTO } from "../core/records";
import { indexRecord, searchEntryFor } from "../core/search-index";

/* ------------------------------- limites -------------------------------- */

/** Versões por documento (o documento do Firestore tem limite de 1 MiB). */
export const MAX_VERSIONS = 200;

/* ------------------------------- esquemas ------------------------------- */

const AUDIENCE_SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const satisfies readonly AudienceScope[];
const EDITABLE_STATUSES = ["current", "draft"] as const satisfies readonly Exclude<DocumentStatus, "archived">[];

/** Objeto que recusa campos desconhecidos (com mensagem em português). */
function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? "Alguns campos enviados não são aceitos nesta operação. Atualize a página e tente novamente." : undefined),
  });
}

/** Identificadores usados em caminhos do Firestore: sem barras ou caracteres especiais. */
const docId = z.string({ error: "Identificador inválido." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Identificador inválido.");

const uploadIdSchema = z.string({ error: "Envio de arquivo inválido." }).regex(/^[a-f0-9]{32}$/, "Envio de arquivo inválido.");

const audienceSchema = strict({
  scope: z.enum(AUDIENCE_SCOPES, { error: "Escolha quem pode acessar o documento." }),
  departmentId: z.union([docId, z.literal("")]).nullish(),
  roleIds: z.array(docId).max(50, "Compartilhamento: escolha no máximo 50 cargos.").default([]),
  userIds: z.array(docId).max(100, "Compartilhamento: escolha no máximo 100 pessoas.").default([]),
}).superRefine((a, ctx) => {
  if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Compartilhamento: escolha pelo menos um cargo." });
  if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Compartilhamento: escolha pelo menos uma pessoa." });
});

/** Vínculos opcionais; vazio ou `null` = sem vínculo. */
const optionalLink = z.union([docId, z.literal("")]).nullish();
const linksSchema = strict({ eventId: optionalLink, meetingId: optionalLink, projectId: optionalLink });

const documentFields = {
  name: z
    .string({ error: "Informe o nome do documento." })
    .trim()
    .min(3, "Informe o nome do documento (mínimo de 3 caracteres).")
    .max(200, "O nome do documento pode ter no máximo 200 caracteres."),
  description: z.string({ error: "Descrição inválida." }).trim().max(1000, "A descrição pode ter no máximo 1.000 caracteres."),
  categoryId: z.string({ error: "Escolha a categoria." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Escolha a categoria."),
  departmentId: z.string({ error: "Escolha o departamento." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Escolha o departamento."),
  status: z.enum(EDITABLE_STATUSES, { error: "Situação inválida." }),
  /** Substitui todos os vínculos (como no serviço de demonstração); `null` remove os vínculos. */
  links: linksSchema.nullish(),
};

/** Campos editáveis (os nomes entram na auditoria; os valores, não). */
const DOCUMENT_FIELDS = ["name", "description", "categoryId", "departmentId", "status", "links"] as const;

const createSchema = strict({
  input: strict({
    ...documentFields,
    description: documentFields.description.default(""),
    access: audienceSchema,
  }),
  uploadId: uploadIdSchema.nullish(),
});

const updateSchema = strict({ id: docId, input: strict(documentFields).partial() });
const setAccessSchema = strict({ id: docId, access: audienceSchema });
const addVersionSchema = strict({
  id: docId,
  uploadId: uploadIdSchema,
  note: z.string({ error: "Observação inválida." }).trim().max(300, "A observação pode ter no máximo 300 caracteres.").nullish(),
});
const idSchema = strict({ id: docId });

/* ------------------------------- auxiliares ------------------------------ */

/**
 * Id de um documento novo, derivado da requisição: o reenvio da mesma
 * requisição (mesmo autor e `requestId`) usa o mesmo id e a mesma pasta no Storage.
 */
export function newDocumentId(uid: string, requestId: string) {
  return createHash("sha256").update(`${uid}:${requestId}`).digest("hex").slice(0, 20);
}

/**
 * A requisição já foi concluída? (mesma chave de idempotência do despachante,
 * `idempotency/{uid}__{requestId}`). Evita mover outro arquivo num reenvio: o
 * despachante devolve o resultado guardado sem executar `run`.
 */
async function alreadyCompleted(uid: string, requestId: string) {
  return (await db.doc(`idempotency/${uid}__${requestId}`).get()).exists;
}

function normalizeDocument(d: InstitutionalDocument): InstitutionalDocument {
  return {
    ...d,
    description: d.description ?? "",
    versions: d.versions ?? [],
    links: d.links ?? {},
    history: d.history ?? [],
    sample: !!d.sample,
  };
}

function documentFromSnap(snap: DocumentSnapshot) {
  return normalizeDocument(toDTO<InstitutionalDocument>(snap));
}

async function loadDocument(tx: Transaction, id: string): Promise<{ ref: DocumentReference; doc: InstitutionalDocument }> {
  const ref = db.doc(`documents/${id}`);
  const snap = requireDoc(await tx.get(ref), "Documento");
  return { ref, doc: documentFromSnap(snap) };
}

function requireVisible(actor: Actor, doc: InstitutionalDocument) {
  if (!canSeeDocument(actor.ctx, doc)) fail("forbidden", "Este documento não está disponível para o seu perfil.");
}

/** "Vigente" exige documents.approve ou ser quem criou o documento. */
function canMarkCurrent(actor: Actor, doc: Pick<InstitutionalDocument, "createdBy">) {
  return actor.can("documents.approve") || doc.createdBy === actor.uid;
}

function nextVersionNumber(doc: InstitutionalDocument) {
  return doc.versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

/** Mantém só os campos que valem para o escopo escolhido (como o serviço de demonstração). */
function sanitizeAudience(audience: { scope: AudienceScope; departmentId?: string | null; roleIds?: string[]; userIds?: string[] }): Audience {
  return {
    scope: audience.scope,
    departmentId: audience.scope === "department" ? audience.departmentId || undefined : undefined,
    roleIds: audience.scope === "roles" ? [...new Set(audience.roleIds ?? [])] : [],
    userIds: audience.scope === "people" ? [...new Set(audience.userIds ?? [])] : [],
  };
}

function sameAudience(a: Audience, b: Audience) {
  const norm = (x: Audience) => JSON.stringify([x.scope, x.departmentId ?? null, [...x.roleIds].sort(), [...x.userIds].sort()]);
  return norm(a) === norm(b);
}

/** Vínculos sem valores vazios. */
function cleanLinks(links: { eventId?: string | null; meetingId?: string | null; projectId?: string | null } | null | undefined): DocumentLinks {
  const out: DocumentLinks = {};
  if (links?.eventId) out.eventId = links.eventId;
  if (links?.meetingId) out.meetingId = links.meetingId;
  if (links?.projectId) out.projectId = links.projectId;
  return out;
}

/* ---- leituras de validação (todas feitas antes de qualquer escrita) ---- */

async function readCategory(tx: Transaction, categoryId: string) {
  return tx.get(db.doc(`documentCategories/${categoryId}`));
}

function assertCategory(snap: DocumentSnapshot) {
  if (!snap.exists) fail("invalid", "A categoria escolhida não existe. Atualize a página e escolha outra categoria.");
}

function categoryName(snap: DocumentSnapshot | null): string | undefined {
  return snap?.exists ? (snap.data()!.name as string | undefined) : undefined;
}

async function readDepartment(tx: Transaction, departmentId: string) {
  return tx.get(db.doc(`departments/${departmentId}`));
}

/** Departamento precisa existir; um departamento desativado só é aceito se já era o do documento. */
function assertDepartment(snap: DocumentSnapshot, previousId?: string) {
  if (!snap.exists) fail("invalid", "O departamento escolhido não existe.");
  if (snap.data()!.active === false && snap.id !== previousId) fail("invalid", "O departamento escolhido está desativado. Escolha outro departamento.");
}

/** Lê departamento, cargos e pessoas citados no público (para conferir que existem). */
async function readAudienceRefs(tx: Transaction, audience: Audience): Promise<DocumentSnapshot[]> {
  const refs = [
    ...(audience.scope === "department" && audience.departmentId ? [db.doc(`departments/${audience.departmentId}`)] : []),
    ...audience.roleIds.map((id) => db.doc(`roles/${id}`)),
    ...audience.userIds.map((id) => db.doc(`members/${id}`)),
  ];
  return refs.length > 0 ? tx.getAll(...refs) : [];
}

function assertAudienceRefs(snaps: DocumentSnapshot[]) {
  for (const snap of snaps) {
    if (snap.exists) continue;
    const collection = snap.ref.parent.id;
    if (collection === "departments") fail("invalid", "Compartilhamento: o departamento escolhido não existe.");
    if (collection === "roles") fail("invalid", "Compartilhamento: um dos cargos escolhidos não existe.");
    fail("invalid", "Compartilhamento: uma das pessoas escolhidas não é integrante da Central.");
  }
}

type LinkKey = keyof DocumentLinks;

const LINK_COLLECTIONS: Record<LinkKey, { collection: string; message: string }> = {
  eventId: { collection: "events", message: "O evento vinculado não existe ou não está disponível para o seu perfil." },
  meetingId: { collection: "meetings", message: "A reunião vinculada não existe ou não está disponível para o seu perfil." },
  projectId: { collection: "projects", message: "O projeto vinculado não existe ou não está disponível para o seu perfil." },
};

/** Lê os registros vinculados que mudaram (os que já estavam no documento não são conferidos de novo). */
async function readLinks(tx: Transaction, links: DocumentLinks, previous: DocumentLinks = {}) {
  const keys = (Object.keys(LINK_COLLECTIONS) as LinkKey[]).filter((k) => links[k] && links[k] !== previous[k]);
  if (keys.length === 0) return [] as { key: LinkKey; snap: DocumentSnapshot }[];
  const snaps = await tx.getAll(...keys.map((k) => db.doc(`${LINK_COLLECTIONS[k].collection}/${links[k]}`)));
  return keys.map((key, i) => ({ key, snap: snaps[i] }));
}

/** O registro vinculado precisa existir e estar visível para quem faz o vínculo (não revela registros ocultos). */
function linkVisible(actor: Actor, key: LinkKey, snap: DocumentSnapshot) {
  if (!snap.exists) return false;
  const data = { ...(snap.data() as Record<string, unknown>), id: snap.id };
  try {
    if (key === "eventId") {
      const ev = data as unknown as AtleticaEvent;
      return canSeeEvent(actor.ctx, { ...ev, responsibleIds: ev.responsibleIds ?? [] });
    }
    if (key === "meetingId") {
      const m = data as unknown as Meeting;
      return canSeeMeeting(actor.ctx, { ...m, participantIds: m.participantIds ?? [] });
    }
    return canSeeProject(actor.ctx, data as unknown as ExtensionProject);
  } catch {
    // Registro com formato inesperado: tratado como indisponível.
    return false;
  }
}

function assertLinks(actor: Actor, read: { key: LinkKey; snap: DocumentSnapshot }[]) {
  for (const { key, snap } of read) if (!linkVisible(actor, key, snap)) fail("invalid", LINK_COLLECTIONS[key].message);
}

/* ---------------------------- escrita e efeitos --------------------------- */

function addHistory(doc: InstitutionalDocument, actor: Actor, ctx: RunContext, ...entries: [HistoryAction, string][]): HistoryEntry[] {
  return appendHistory(doc.history, ...entries.map(([action, summary]) => historyEntry(actor.uid, action, summary, ctx.now)));
}

/** Grava o documento completo (público recalculado) e a entrada do índice de busca. */
function writeDocument(tx: Transaction, ref: DocumentReference, doc: InstitutionalDocument, category: string | undefined, create = false) {
  if (create) tx.create(ref, documentDoc(doc));
  else tx.set(ref, documentDoc(doc));
  indexRecord(tx, searchEntryFor.document(doc, category));
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, docIdValue: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(
    tx,
    { uid: actor.uid, name: actor.name },
    { action: `documents.${action}`, module: "documents", resourceType: "document", resourceId: docIdValue, summary, details },
    ctx.requestId,
    ctx.now,
  );
}

/** Detalhes do arquivo para a auditoria (sem nome nem conteúdo). */
function fileDetails(file: FileRef | null) {
  return file ? { mimeType: file.mimeType, size: file.size, sha256: file.sha256 ?? null } : { mimeType: null, size: null, sha256: null };
}

function scheduleShareNotice(ctx: RunContext, actor: Actor, doc: InstitutionalDocument, title: string, body: string) {
  const readers = documentReaders(doc);
  const actorId = actor.uid;
  const href = `/documentos/${doc.id}`;
  const eventKey = `document_shared__${doc.id}__${ctx.requestId}`;
  ctx.after(async () => {
    await notify({ eventKey, kind: "document_shared", title, body, href, module: "documents", readers, actorId });
  });
}

/**
 * Monta a resposta: o documento completo, se o autor ainda pode vê-lo.
 *
 * Quem edita por ter documents.edit no departamento pode, ao mudar o público
 * ou o departamento, deixar de ver o documento. Nesse caso a resposta é o
 * estado que a PRÓPRIA operação acabou de gravar (mesmo horário e mesmo autor
 * na última entrada do histórico) — nada além do que a pessoa via e alterou.
 * As leituras seguintes já seguem o novo público.
 */
async function presentDocument(result: DocumentRefResult, actor: Actor | null): Promise<InstitutionalDocument> {
  const snap = await db.doc(`documents/${result.id}`).get();
  if (!snap.exists) fail("not_found", "Documento não encontrado.");
  const doc = documentFromSnap(snap);
  if (actor && canSeeDocument(actor.ctx, doc)) return doc;
  if (actor && result.at && doc.updatedAt === result.at && doc.history.at(-1)?.actorId === actor.uid) return doc;
  fail("forbidden", "A operação foi concluída, mas este documento não está mais disponível para o seu perfil.");
}

interface DocumentRefResult {
  id: string;
  /** Horário da operação (ctx.now), usado para reconhecer o estado gravado por ela. */
  at: string;
}

interface CreatePrepared {
  docId: string;
  file: FileRef | null;
}

interface VersionPrepared {
  version: number;
  file: FileRef | null;
}

/* -------------------------------- ações --------------------------------- */

export const documentsActions = {
  create: mutation({
    module: "documents",
    schema: createSchema,
    async prepare(actor, { uploadId }, ctx): Promise<CreatePrepared> {
      // Conferência antecipada (repetida dentro da transação) para não mover arquivos à toa.
      requirePermission(actor, "documents.create", "Seu perfil não pode adicionar documentos.");
      const id = newDocumentId(actor.uid, ctx.requestId);
      if (!uploadId || (await alreadyCompleted(actor.uid, ctx.requestId))) return { docId: id, file: null };
      const file = await finalizeUpload(actor, uploadId, "document", `documents/${id}/v1`, ctx);
      return { docId: id, file };
    },
    async run(tx, actor, { input, uploadId }, ctx, prepared): Promise<DocumentRefResult> {
      actor = actor!;
      requirePermission(actor, "documents.create", "Seu perfil não pode adicionar documentos.");
      const id = newDocumentId(actor.uid, ctx.requestId);
      if (prepared.docId !== id) fail("conflict", "Requisição inconsistente. Atualize a página e tente novamente.");
      if (uploadId && !prepared.file) fail("conflict", "O arquivo enviado não pôde ser anexado. Envie o arquivo novamente.");
      const access = sanitizeAudience(input.access);
      const links = cleanLinks(input.links);

      // Leituras
      await requireModuleEnabled(tx, "documents");
      const ref = db.doc(`documents/${id}`);
      const [existing, catSnap, depSnap, audienceSnaps, linkSnaps] = await Promise.all([
        tx.get(ref),
        readCategory(tx, input.categoryId),
        readDepartment(tx, input.departmentId),
        readAudienceRefs(tx, access),
        readLinks(tx, links),
      ]);

      // Regras
      if (existing.exists) fail("conflict", "Este documento já foi registrado. Atualize a página.");
      assertCategory(catSnap);
      assertDepartment(depSnap);
      assertAudienceRefs(audienceSnaps);
      assertLinks(actor, linkSnaps);

      const file = prepared.file;
      const firstVersion: DocumentVersion = { version: 1, file, uploadedBy: actor.uid, uploadedAt: ctx.now, note: "Versão inicial" };
      const doc: InstitutionalDocument = {
        id,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        departmentId: input.departmentId,
        access,
        // Quem cria pode marcar como vigente (mesma regra do serviço de demonstração).
        status: input.status,
        versions: [firstVersion],
        links,
        sample: false,
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", file ? "Documento adicionado com arquivo" : "Documento adicionado sem arquivo", ctx.now)],
      };

      // Escritas
      writeDocument(tx, ref, doc, categoryName(catSnap), true);
      if (uploadId && file) markAttached(tx, uploadId, `documents/${id}`);
      audit(tx, actor, ctx, "create", id, `Documento adicionado: ${doc.name}`, {
        categoryId: doc.categoryId,
        departmentId: doc.departmentId,
        status: doc.status,
        scope: doc.access.scope,
        version: 1,
        hasFile: !!file,
        ...fileDetails(file),
      });
      scheduleShareNotice(ctx, actor, doc, "Documento compartilhado", `${actor.name} compartilhou “${doc.name}” (${AUDIENCE_SCOPE_LABELS[doc.access.scope].toLowerCase()}).`);
      return { id, at: ctx.now };
    },
    async present(result, actor) {
      return presentDocument(result, actor);
    },
  }),

  update: mutation({
    module: "documents",
    schema: updateSchema,
    async run(tx, actor, { id, input }, ctx): Promise<DocumentRefResult> {
      actor = actor!;
      // Leituras
      await requireModuleEnabled(tx, "documents");
      const { ref, doc: current } = await loadDocument(tx, id);
      requireVisible(actor, current);
      if (!canEditDocument(actor.ctx, current)) fail("forbidden", "Seu perfil não pode editar este documento.");
      const nextCategoryId = input.categoryId ?? current.categoryId;
      const depChanged = input.departmentId !== undefined && input.departmentId !== current.departmentId;
      const links = input.links !== undefined ? cleanLinks(input.links) : current.links;
      const [catSnap, depSnap, linkSnaps] = await Promise.all([
        readCategory(tx, nextCategoryId),
        depChanged ? readDepartment(tx, input.departmentId!) : Promise.resolve(null),
        readLinks(tx, links, current.links),
      ]);

      // Regras
      if (input.categoryId !== undefined && input.categoryId !== current.categoryId) assertCategory(catSnap);
      if (depSnap) assertDepartment(depSnap, current.departmentId);
      assertLinks(actor, linkSnaps);
      const statusChanged = input.status !== undefined && input.status !== current.status;
      if (statusChanged && current.status === "archived") {
        fail("conflict", "Este documento está arquivado. Restaure-o antes de alterar a situação.");
      }
      if (input.status === "current" && current.status !== "current" && !canMarkCurrent(actor, current)) {
        fail("forbidden", "Seu perfil não pode marcar documentos como vigentes.");
      }

      const next: InstitutionalDocument = { ...current, links };
      if (input.name !== undefined) next.name = input.name;
      if (input.description !== undefined) next.description = input.description;
      if (input.categoryId !== undefined) next.categoryId = input.categoryId;
      if (input.departmentId !== undefined) next.departmentId = input.departmentId;
      if (input.status !== undefined) next.status = input.status;
      next.updatedAt = ctx.now;
      next.history = addHistory(
        current,
        actor,
        ctx,
        ["updated", "Informações do documento alteradas"],
        ...(statusChanged ? [["status", `Situação alterada para ${DOCUMENT_STATUS[next.status].label}`] as [HistoryAction, string]] : []),
      );

      // Escritas (documento completo: o público é recalculado)
      writeDocument(tx, ref, next, categoryName(catSnap));
      const changed = DOCUMENT_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null));
      audit(tx, actor, ctx, "update", id, `Documento editado: ${next.name}${changed.length ? ` (${changed.join(", ")})` : ""}`, {
        status: next.status,
        statusChanged,
        categoryId: next.categoryId,
        departmentId: next.departmentId,
      });
      return { id, at: ctx.now };
    },
    async present(result, actor) {
      return presentDocument(result, actor);
    },
  }),

  setAccess: mutation({
    module: "documents",
    schema: setAccessSchema,
    async run(tx, actor, { id, access: rawAccess }, ctx): Promise<DocumentRefResult> {
      actor = actor!;
      const access = sanitizeAudience(rawAccess);
      // Leituras
      await requireModuleEnabled(tx, "documents");
      const { ref, doc: current } = await loadDocument(tx, id);
      requireVisible(actor, current);
      if (!canEditDocument(actor.ctx, current)) fail("forbidden", "Seu perfil não pode alterar o compartilhamento deste documento.");
      const [catSnap, audienceSnaps] = await Promise.all([readCategory(tx, current.categoryId), readAudienceRefs(tx, access)]);

      // Regras
      assertAudienceRefs(audienceSnaps);

      const next: InstitutionalDocument = {
        ...current,
        access,
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["shared", `Compartilhamento alterado para: ${AUDIENCE_SCOPE_LABELS[access.scope]}`]),
      };

      // Escritas: `readers` muda junto (as regras do Storage passam a valer para os arquivos na hora).
      writeDocument(tx, ref, next, categoryName(catSnap));
      audit(tx, actor, ctx, "setAccess", id, `Compartilhamento do documento ${next.name} alterado para: ${AUDIENCE_SCOPE_LABELS[access.scope]}`, {
        from: current.access.scope,
        to: access.scope,
        changed: !sameAudience(current.access, access),
        roles: access.roleIds.length,
        people: access.userIds.length,
      });
      scheduleShareNotice(ctx, actor, next, "Documento compartilhado com você", `${actor.name} alterou o acesso de “${next.name}”.`);
      return { id, at: ctx.now };
    },
    async present(result, actor) {
      return presentDocument(result, actor);
    },
  }),

  addVersion: mutation({
    module: "documents",
    schema: addVersionSchema,
    async prepare(actor, { id, uploadId }, ctx): Promise<VersionPrepared> {
      if (await alreadyCompleted(actor.uid, ctx.requestId)) return { version: 0, file: null };
      // Conferência antecipada (repetida dentro da transação) e pasta da próxima versão.
      const snap = await db.doc(`documents/${id}`).get();
      if (!snap.exists) fail("not_found", "Documento não encontrado. Pode ter sido removido ou não estar disponível para o seu perfil.");
      const doc = documentFromSnap(snap);
      requireVisible(actor, doc);
      if (!canEditDocument(actor.ctx, doc)) fail("forbidden", "Seu perfil não pode enviar novas versões deste documento.");
      if (doc.status === "archived") fail("conflict", "Restaure o documento antes de enviar uma nova versão.");
      if (doc.versions.length >= MAX_VERSIONS) fail("conflict", `Este documento atingiu o limite de ${MAX_VERSIONS} versões. Crie um novo documento.`);
      const version = nextVersionNumber(doc);
      const file = await finalizeUpload(actor, uploadId, "document", `documents/${id}/v${version}`, ctx);
      return { version, file };
    },
    async run(tx, actor, { id, uploadId, note }, ctx, prepared): Promise<DocumentRefResult> {
      actor = actor!;
      // Leituras (o número da versão é calculado aqui, com o documento lido na transação)
      await requireModuleEnabled(tx, "documents");
      const { ref, doc: current } = await loadDocument(tx, id);
      requireVisible(actor, current);
      if (!canEditDocument(actor.ctx, current)) fail("forbidden", "Seu perfil não pode enviar novas versões deste documento.");
      if (current.status === "archived") fail("conflict", "Restaure o documento antes de enviar uma nova versão.");
      if (current.versions.length >= MAX_VERSIONS) fail("conflict", `Este documento atingiu o limite de ${MAX_VERSIONS} versões. Crie um novo documento.`);
      const catSnap = await readCategory(tx, current.categoryId);

      // Regras
      const version = nextVersionNumber(current);
      if (!prepared.file) fail("conflict", "O arquivo enviado não pôde ser anexado. Envie o arquivo novamente.");
      if (prepared.version !== version) {
        fail("conflict", "Outra versão deste documento foi enviada ao mesmo tempo. Atualize a página e envie o arquivo novamente.");
      }

      const entry: DocumentVersion = { version, file: prepared.file, uploadedBy: actor.uid, uploadedAt: ctx.now, note: note || undefined };
      const next: InstitutionalDocument = {
        ...current,
        // As versões anteriores são mantidas (nunca apagadas).
        versions: [...current.versions, entry],
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["version", `Versão ${version} enviada; versões anteriores mantidas`]),
      };

      // Escritas
      writeDocument(tx, ref, next, categoryName(catSnap));
      markAttached(tx, uploadId, `documents/${id}`);
      audit(tx, actor, ctx, "addVersion", id, `Versão ${version} enviada para o documento ${next.name}`, { version, ...fileDetails(prepared.file) });
      return { id, at: ctx.now };
    },
    async present(result, actor) {
      return presentDocument(result, actor);
    },
  }),

  archive: mutation({
    module: "documents",
    schema: idSchema,
    async run(tx, actor, { id }, ctx): Promise<DocumentRefResult> {
      actor = actor!;
      await requireModuleEnabled(tx, "documents");
      const { ref, doc: current } = await loadDocument(tx, id);
      requireVisible(actor, current);
      if (!canArchiveDocument(actor.ctx, current)) fail("forbidden", "Seu perfil não pode arquivar documentos.");
      if (current.status === "archived") fail("conflict", "O documento já está arquivado.");
      const catSnap = await readCategory(tx, current.categoryId);

      const next: InstitutionalDocument = {
        ...current,
        status: "archived",
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["archived", "Documento arquivado (continua disponível para consulta)"]),
      };
      // Arquivar não apaga nada: versões e arquivos continuam disponíveis para quem pode ver.
      writeDocument(tx, ref, next, categoryName(catSnap));
      audit(tx, actor, ctx, "archive", id, `Documento arquivado: ${next.name}`, { from: current.status, versions: next.versions.length });
      return { id, at: ctx.now };
    },
    async present(result, actor) {
      return presentDocument(result, actor);
    },
  }),

  restore: mutation({
    module: "documents",
    schema: idSchema,
    async run(tx, actor, { id }, ctx): Promise<DocumentRefResult> {
      actor = actor!;
      await requireModuleEnabled(tx, "documents");
      const { ref, doc: current } = await loadDocument(tx, id);
      requireVisible(actor, current);
      if (!canArchiveDocument(actor.ctx, current)) fail("forbidden", "Seu perfil não pode restaurar documentos.");
      if (current.status !== "archived") fail("conflict", "O documento não está arquivado.");
      const catSnap = await readCategory(tx, current.categoryId);

      // Volta como vigente; sem permissão de aprovar (e sem ser o criador), volta em elaboração.
      const status: DocumentStatus = canMarkCurrent(actor, current) ? "current" : "draft";
      const next: InstitutionalDocument = {
        ...current,
        status,
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["restored", status === "current" ? "Documento restaurado" : "Documento restaurado (em elaboração)"]),
      };
      writeDocument(tx, ref, next, categoryName(catSnap));
      audit(tx, actor, ctx, "restore", id, `Documento restaurado: ${next.name}`, { to: status });
      return { id, at: ctx.now };
    },
    async present(result, actor) {
      return presentDocument(result, actor);
    },
  }),
};

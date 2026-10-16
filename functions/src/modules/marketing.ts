/**
 * MARKETING: conteúdos (briefing → produção → revisão → aprovado → publicado).
 * ---------------------------------------------------------------------------
 * Armazenamento: `contents/{id}` = contentDoc(conteúdo), com `readers`
 * (público + criador + responsável) sempre recalculado aqui. Arquivos ficam no
 * Storage em `marketing/{contentId}/{uploadId}-{nome}` (finalidade
 * "marketingFile": PDF, imagens, vídeos MP4/MOV e Office, até 50 MB cada) e
 * os metadados em `files` do próprio conteúdo (até 100 por conteúdo, até 10
 * por envio). As regras do Storage liberam o download para quem vê o conteúdo.
 *
 * Regras (as mesmas do serviço de demonstração e de src/lib/policies.ts):
 *  - Ver: `canSeeContent` (público, criador, responsável ou marketing.admin).
 *  - Criar: marketing.create.
 *  - Editar e anexar arquivos: `canEditContent` (marketing.edit, criador ou
 *    responsável — mesmo sem marketing.edit). Depois de "Aprovado" (e em
 *    "Publicado"), só quem tem marketing.approve altera (`canChangeContent`):
 *    o que chega a "Publicado" é o que foi aprovado. Quem não aprova devolve o
 *    conteúdo publicado para revisão (ou pede a devolução de um aprovado) e ele
 *    precisa ser aprovado de novo.
 *  - Etapas: `allowedContentStatuses` — "Aprovado" exige marketing.approve;
 *    "Cancelado" (arquivar) exige marketing.archive; um conteúdo aprovado só
 *    pode ir para "Publicado" por quem não aprova.
 *  - "Publicado" é só a marcação feita pela equipe: a Central NUNCA publica
 *    nada nas redes sociais.
 *  - Compartilhamento: o público (`access`) define quem mais vê o conteúdo —
 *    ex.: uma arte aprovada compartilhada com o departamento de Eventos.
 *
 * Validações extras do servidor: links http/https, ao menos um canal,
 * responsável integrante ativo, campanha/evento vinculados existentes e
 * visíveis para quem vincula, departamento do público existente e ativo.
 *
 * A auditoria não registra textos livres, nomes de arquivos ou conteúdo de
 * arquivos — apenas identificadores, códigos, etapas e contagens.
 */
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { TOKEN } from "@/lib/access-tokens";
import { contentDoc } from "@/lib/firestore-model";
import { CONTENT_STATUS } from "@/lib/labels";
import { allowedContentStatuses, canChangeContent, canEditContent, canSeeCampaign, canSeeContent, canSeeEvent } from "@/lib/policies";
import { contentReaders } from "@/lib/record-readers";
import type { AtleticaEvent, Audience, AudienceScope, Campaign, Channel, ContentItem, ContentLink, ContentStatus, ContentType, FileRef, HistoryAction, HistoryEntry } from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { nextCode } from "../core/counters";
import { mutation, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { finalizeUpload, markAttached } from "../core/files";
import { appendHistory, historyEntry } from "../core/history";
import { notify, resolveRecipients } from "../core/notify";
import { requireDoc, toDTO } from "../core/records";
import { indexRecord, searchEntryFor } from "../core/search-index";

/* ------------------------------- limites -------------------------------- */

/** Arquivos por envio (uma operação). */
export const MAX_FILES_PER_CALL = 10;
/** Arquivos por conteúdo (o documento guarda os metadados). */
export const MAX_FILES = 100;
export const MAX_LINKS = 20;

/* ------------------------------- esquemas ------------------------------- */

const CONTENT_TYPES = ["arte", "video", "reels", "story", "carrossel", "texto", "outro"] as const satisfies readonly ContentType[];
const CHANNELS = ["instagram_feed", "instagram_stories", "tiktok", "whatsapp", "mural", "outro"] as const satisfies readonly Channel[];
const CONTENT_STATUSES = ["briefing", "production", "review", "approved", "published", "cancelled"] as const satisfies readonly ContentStatus[];
const AUDIENCE_SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const satisfies readonly AudienceScope[];

/** Objeto que recusa campos desconhecidos (com mensagem em português). */
function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? "Alguns campos enviados não são aceitos nesta operação. Atualize a página e tente novamente." : undefined),
  });
}

/** Identificadores usados em caminhos do Firestore/Storage: sem barras ou caracteres especiais. */
const docId = z.string({ error: "Identificador inválido." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Identificador inválido.");

function isRealDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const dateOnly = z
  .string({ error: "Data de publicação inválida." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de publicação inválida.")
  .refine(isRealDate, "Data de publicação inválida.");

/** Somente endereços web (http/https) — nada de javascript:, data:, file: etc. */
export function isHttpUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

const linkSchema = strict({
  label: z.string().trim().max(120, "A descrição do link pode ter no máximo 120 caracteres.").nullish(),
  url: z.string({ error: "Informe o endereço do link." }).trim().min(1, "Informe o endereço do link.").max(2000, "O endereço do link pode ter no máximo 2000 caracteres."),
});

const linksSchema = z
  .array(linkSchema)
  .max(MAX_LINKS, `Informe no máximo ${MAX_LINKS} links.`)
  .superRefine((links, ctx) => {
    for (const link of links) {
      if (!isHttpUrl(link.url)) {
        const name = (link.label || link.url).slice(0, 80);
        ctx.addIssue({ code: "custom", message: `O link “${name}” precisa começar com http:// ou https://` });
        return;
      }
    }
  });

const audienceSchema = strict({
  scope: z.enum(AUDIENCE_SCOPES, { error: "Escolha quem pode ver o conteúdo." }),
  departmentId: z.union([docId, z.literal("")]).nullish(),
  roleIds: z.array(docId).max(50, "Escolha no máximo 50 cargos.").default([]),
  userIds: z.array(docId).max(100, "Escolha no máximo 100 pessoas.").default([]),
}).superRefine((a, ctx) => {
  // Conteúdos não pertencem a um departamento: o escopo "departamento" precisa dizer qual.
  if (a.scope === "department" && !a.departmentId) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha o departamento." });
  if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos um cargo." });
  if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos uma pessoa." });
});

/** Vínculo opcional: vazio ou `null` = sem vínculo. */
const optionalLink = z.union([docId, z.literal("")]).nullish();

const contentFields = {
  title: z.string({ error: "Informe o nome do conteúdo." }).trim().min(3, "Informe o nome do conteúdo.").max(120, "O nome do conteúdo pode ter no máximo 120 caracteres."),
  type: z.enum(CONTENT_TYPES, { error: "Escolha um tipo de conteúdo válido." }),
  campaignId: optionalLink,
  eventId: optionalLink,
  responsibleId: z.string({ error: "Escolha o responsável." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Escolha o responsável."),
  publishDate: z.union([dateOnly, z.literal("")]).nullish(),
  channels: z
    .array(z.enum(CHANNELS, { error: "Canal de divulgação inválido." }), { error: "Escolha pelo menos um canal de divulgação." })
    .min(1, "Escolha pelo menos um canal de divulgação.")
    .max(CHANNELS.length, `Escolha no máximo ${CHANNELS.length} canais de divulgação.`),
  briefing: z.string({ error: "Escreva um briefing com pelo menos 10 caracteres." }).trim().min(10, "Escreva um briefing com pelo menos 10 caracteres.").max(4000, "O briefing pode ter no máximo 4000 caracteres."),
  notes: z.string().trim().max(500, "As observações podem ter no máximo 500 caracteres.").nullish(),
  links: linksSchema,
  access: audienceSchema,
};

/** Campos editáveis (os nomes entram na auditoria; os valores, não). */
const CONTENT_FIELDS = ["title", "type", "campaignId", "eventId", "responsibleId", "publishDate", "channels", "briefing", "notes", "links", "access"] as const;

const createSchema = strict({
  ...contentFields,
  links: linksSchema.default([]),
  // Público opcional: padrão = todos os integrantes com acesso ao Marketing.
  access: audienceSchema.nullish(),
});

const updateSchema = strict({ id: docId, input: strict(contentFields).partial() });

const statusSchema = strict({ id: docId, status: z.enum(CONTENT_STATUSES, { error: "Etapa inválida." }) });

const addFilesSchema = strict({
  id: docId,
  uploadIds: z
    .array(z.string({ error: "Envio de arquivo inválido." }).regex(/^[a-f0-9]{32}$/, "Envio de arquivo inválido."), { error: "Escolha pelo menos um arquivo." })
    .min(1, "Escolha pelo menos um arquivo.")
    .max(MAX_FILES_PER_CALL, `Envie no máximo ${MAX_FILES_PER_CALL} arquivos por vez.`)
    .refine((ids) => new Set(ids).size === ids.length, "O mesmo arquivo foi enviado mais de uma vez."),
});

/* ------------------------------- auxiliares ------------------------------ */

const ALL: Audience = { scope: "all", roleIds: [], userIds: [] };

type AudienceInput = { scope: AudienceScope; departmentId?: string | null; roleIds?: string[]; userIds?: string[] };

/** Mantém só os campos que valem para o escopo escolhido (como o serviço de demonstração). */
function sanitizeAudience(audience: AudienceInput): Audience {
  return {
    scope: audience.scope,
    departmentId: audience.scope === "department" ? audience.departmentId || undefined : undefined,
    roleIds: audience.scope === "roles" ? [...new Set(audience.roleIds ?? [])] : [],
    userIds: audience.scope === "people" ? [...new Set(audience.userIds ?? [])] : [],
  };
}

function sameAudience(a: Audience, b: Audience) {
  const norm = (x: Audience) => JSON.stringify([x.scope, x.departmentId ?? null, [...(x.roleIds ?? [])].sort(), [...(x.userIds ?? [])].sort()]);
  return norm(a) === norm(b);
}

function cleanLinks(links: { label?: string | null; url: string }[]): ContentLink[] {
  return links.map((l) => ({ label: l.label ?? "", url: l.url }));
}

function normalizeContent(c: ContentItem): ContentItem {
  return {
    ...c,
    channels: c.channels ?? [],
    links: c.links ?? [],
    files: c.files ?? [],
    access: c.access ?? ALL,
    history: c.history ?? [],
  };
}

async function loadContent(tx: Transaction, contentId: string): Promise<{ ref: DocumentReference; item: ContentItem }> {
  const ref = db.doc(`contents/${contentId}`);
  const snap = requireDoc(await tx.get(ref), "Conteúdo");
  return { ref, item: normalizeContent(toDTO<ContentItem>(snap)) };
}

function requireVisible(actor: Actor, item: ContentItem) {
  if (!canSeeContent(actor.ctx, item)) fail("forbidden", "Este conteúdo não está disponível para o seu perfil.");
}

/** Material já aprovado (ou publicado): só quem aprova altera dados e arquivos. Use depois de conferir `canEditContent`. */
function requireChangeable(actor: Actor, item: ContentItem) {
  if (canChangeContent(actor.ctx, item)) return;
  fail(
    "conflict",
    item.status === "published"
      ? "Este material já foi publicado. Volte-o para a etapa “Em revisão” antes de alterar; depois ele precisa ser aprovado de novo."
      : "Este material já foi aprovado. Peça a quem aprova para devolvê-lo à revisão antes de alterar.",
  );
}

/** Leituras dos dados relacionados que mudaram (todas na fase de leitura da transação). */
interface Related {
  member: DocumentSnapshot | null;
  campaign: DocumentSnapshot | null;
  event: DocumentSnapshot | null;
  department: DocumentSnapshot | null;
}

async function loadRelated(tx: Transaction, ids: { responsibleId?: string; campaignId?: string; eventId?: string; departmentId?: string }): Promise<Related> {
  const get = (path: string | null) => (path ? tx.get(db.doc(path)) : Promise.resolve(null));
  const [member, campaign, event, department] = await Promise.all([
    get(ids.responsibleId ? `members/${ids.responsibleId}` : null),
    get(ids.campaignId ? `campaigns/${ids.campaignId}` : null),
    get(ids.eventId ? `events/${ids.eventId}` : null),
    get(ids.departmentId ? `departments/${ids.departmentId}` : null),
  ]);
  return { member, campaign, event, department };
}

/**
 * Responsável: precisa ser integrante ativo da Central. Quem já era o
 * responsável pode permanecer mesmo que a conta tenha sido desativada depois.
 */
function assertResponsible(snap: DocumentSnapshot | null) {
  if (!snap) return;
  if (!snap.exists) fail("invalid", "O responsável escolhido não é integrante da Central.");
  if (snap.data()!.status !== "active") fail("invalid", "O responsável escolhido está com a conta desativada. Escolha um integrante ativo.");
}

/** Campanha vinculada: precisa existir e estar visível para quem vincula (mesma mensagem nos dois casos). */
function assertCampaign(actor: Actor, snap: DocumentSnapshot | null) {
  if (!snap) return;
  const message = "A campanha escolhida não existe ou não está disponível para o seu perfil.";
  if (!snap.exists) fail("invalid", message);
  const campaign = toDTO<Campaign>(snap);
  if (!campaign.access?.view || !canSeeCampaign(actor.ctx, campaign)) fail("invalid", message);
}

/** Evento vinculado: precisa existir e estar visível para quem vincula. */
function assertEvent(actor: Actor, snap: DocumentSnapshot | null) {
  if (!snap) return;
  const message = "O evento escolhido não existe ou não está disponível para o seu perfil.";
  if (!snap.exists) fail("invalid", message);
  const ev = toDTO<AtleticaEvent>(snap);
  if (!ev.access || !canSeeEvent(actor.ctx, { ...ev, responsibleIds: ev.responsibleIds ?? [] })) fail("invalid", message);
}

/** Departamento do público: precisa existir; um departamento desativado só é aceito se já era o do público. */
function assertDepartment(snap: DocumentSnapshot | null, previousId?: string) {
  if (!snap) return;
  if (!snap.exists) fail("invalid", "O departamento escolhido para a visibilidade não existe.");
  if (snap.data()!.active === false && snap.id !== previousId) fail("invalid", "O departamento escolhido para a visibilidade está desativado. Escolha outro departamento.");
}

function addHistory(item: ContentItem, actor: Actor, ctx: RunContext, ...entries: [HistoryAction, string][]): HistoryEntry[] {
  return appendHistory(item.history, ...entries.map(([action, summary]) => historyEntry(actor.uid, action, summary, ctx.now)));
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, contentId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(
    tx,
    { uid: actor.uid, name: actor.name },
    { action: `marketing.${action}`, module: "marketing", resourceType: "content", resourceId: contentId, summary, details },
    ctx.requestId,
    ctx.now,
  );
}

/** Monta a resposta: o conteúdo completo, se o autor ainda pode vê-lo. */
async function presentContent(contentId: string, actor: Actor | null): Promise<ContentItem> {
  const snap = await db.doc(`contents/${contentId}`).get();
  if (!snap.exists) fail("not_found", "Conteúdo não encontrado.");
  const item = normalizeContent(toDTO<ContentItem>(snap));
  if (!actor || !canSeeContent(actor.ctx, item)) fail("forbidden", "A operação foi concluída, mas este conteúdo não está mais disponível para o seu perfil.");
  return item;
}

/**
 * Aviso de material aprovado: diretoria (como no modo demonstração), mas só
 * quem pode abrir o conteúdo (público, criador, responsável ou marketing.admin).
 * Quem aprovou não recebe aviso.
 */
async function notifyApproved(item: ContentItem, readers: string[], actorId: string, requestId: string) {
  const [board, audience] = await Promise.all([
    resolveRecipients({ readers: [TOKEN.board], module: "marketing", actorId }),
    resolveRecipients({ readers, module: "marketing", actorId, includeModuleAdmins: true }),
  ]);
  const allowed = new Set(audience);
  const targets = board.filter((uid) => allowed.has(uid));
  if (targets.length === 0) return;
  await notify({
    eventKey: `content_approved__${item.id}__${requestId}`,
    kind: "content_approved",
    title: "Material aprovado",
    body: `“${item.title}” foi aprovado pelo Marketing.`,
    href: `/marketing?item=${item.id}`,
    module: "marketing",
    readers: targets.map(TOKEN.user),
    actorId,
  });
}

interface ContentRef {
  id: string;
}

/* -------------------------------- ações --------------------------------- */

export const marketingActions = {
  create: mutation({
    module: "marketing",
    schema: createSchema,
    async run(tx, actor, input, ctx): Promise<ContentRef> {
      actor = actor!;
      requirePermission(actor, "marketing.create", "Seu perfil não pode criar conteúdos.");
      // Leituras
      await requireModuleEnabled(tx, "marketing");
      const code = await nextCode(tx, ctx, "MKT");
      const access = sanitizeAudience(input.access ?? ALL);
      const campaignId = input.campaignId || undefined;
      const eventId = input.eventId || undefined;
      const related = await loadRelated(tx, { responsibleId: input.responsibleId, campaignId, eventId, departmentId: access.departmentId });
      // Regras
      assertResponsible(related.member);
      assertCampaign(actor, related.campaign);
      assertEvent(actor, related.event);
      assertDepartment(related.department);

      // Escritas
      const ref = db.collection("contents").doc();
      const item: ContentItem = {
        id: ref.id,
        code,
        title: input.title,
        type: input.type,
        campaignId,
        eventId,
        responsibleId: input.responsibleId,
        publishDate: input.publishDate || undefined,
        channels: [...new Set(input.channels)],
        briefing: input.briefing,
        notes: input.notes || undefined,
        links: cleanLinks(input.links),
        files: [],
        status: "briefing",
        access,
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", "Conteúdo criado com briefing", ctx.now)],
      };
      tx.create(ref, contentDoc(item));
      indexRecord(tx, searchEntryFor.content(item));
      audit(tx, actor, ctx, "create", ref.id, `Conteúdo ${code} criado na etapa Briefing`, {
        code,
        type: item.type,
        scope: access.scope,
        channels: item.channels.length,
        links: item.links.length,
        campaignLinked: !!campaignId,
        eventLinked: !!eventId,
      });
      return { id: ref.id };
    },
    async present(result, actor) {
      return presentContent(result.id, actor);
    },
  }),

  update: mutation({
    module: "marketing",
    schema: updateSchema,
    async run(tx, actor, { id: contentId, input }, ctx): Promise<ContentRef> {
      actor = actor!;
      // Leituras
      await requireModuleEnabled(tx, "marketing");
      const { ref, item: current } = await loadContent(tx, contentId);
      requireVisible(actor, current);
      if (!canEditContent(actor.ctx, current)) fail("forbidden", "Seu perfil não pode editar este conteúdo.");
      requireChangeable(actor, current);

      const next: ContentItem = { ...current };
      if (input.title !== undefined) next.title = input.title;
      if (input.type !== undefined) next.type = input.type;
      if ("campaignId" in input) next.campaignId = input.campaignId || undefined;
      if ("eventId" in input) next.eventId = input.eventId || undefined;
      if (input.responsibleId !== undefined) next.responsibleId = input.responsibleId;
      if ("publishDate" in input) next.publishDate = input.publishDate || undefined;
      if (input.channels !== undefined) next.channels = [...new Set(input.channels)];
      if (input.briefing !== undefined) next.briefing = input.briefing;
      if ("notes" in input) next.notes = input.notes || undefined;
      if (input.links !== undefined) next.links = cleanLinks(input.links);
      if (input.access !== undefined) next.access = sanitizeAudience(input.access);

      // Só confere o que mudou (vínculos antigos continuam válidos mesmo que o registro tenha mudado depois).
      const responsibleChanged = next.responsibleId !== current.responsibleId;
      const campaignChanged = !!next.campaignId && next.campaignId !== current.campaignId;
      const eventChanged = !!next.eventId && next.eventId !== current.eventId;
      const accessChanged = !sameAudience(next.access, current.access);
      const departmentChanged = !!next.access.departmentId && next.access.departmentId !== current.access.departmentId;
      const related = await loadRelated(tx, {
        responsibleId: responsibleChanged ? next.responsibleId : undefined,
        campaignId: campaignChanged ? next.campaignId : undefined,
        eventId: eventChanged ? next.eventId : undefined,
        departmentId: departmentChanged ? next.access.departmentId : undefined,
      });
      // Regras
      assertResponsible(related.member);
      assertCampaign(actor, related.campaign);
      assertEvent(actor, related.event);
      assertDepartment(related.department, current.access.departmentId);

      const changed = CONTENT_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null));
      if (changed.length === 0) return { id: contentId };

      next.updatedAt = ctx.now;
      next.history = addHistory(
        current,
        actor,
        ctx,
        ["updated", "Conteúdo editado"],
        ...(accessChanged ? [["shared", "Visibilidade do conteúdo alterada"] as [HistoryAction, string]] : []),
      );

      // Escritas (documento completo: campos esvaziados deixam de existir; readers recalculado)
      tx.set(ref, contentDoc(next));
      indexRecord(tx, searchEntryFor.content(next));
      audit(tx, actor, ctx, "update", contentId, `Conteúdo ${current.code} editado: ${changed.join(", ")}`, {
        fields: changed.join(","),
        accessChanged,
        scope: next.access.scope,
        responsibleChanged,
      });
      return { id: contentId };
    },
    async present(result, actor) {
      return presentContent(result.id, actor);
    },
  }),

  setStatus: mutation({
    module: "marketing",
    schema: statusSchema,
    async run(tx, actor, { id: contentId, status }, ctx): Promise<ContentRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "marketing");
      const { ref, item: current } = await loadContent(tx, contentId);
      requireVisible(actor, current);
      const label = CONTENT_STATUS[status].label;
      if (current.status === status) fail("conflict", `Este conteúdo já está na etapa “${label}”.`);
      if (!allowedContentStatuses(actor.ctx, current).includes(status)) {
        fail("forbidden", `Seu perfil não pode mover este conteúdo para “${label}”.`);
      }

      const next: ContentItem = {
        ...current,
        status,
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["status", `Etapa alterada para ${label}`]),
      };
      tx.update(ref, { status, updatedAt: ctx.now, history: next.history });
      indexRecord(tx, searchEntryFor.content(next));
      audit(tx, actor, ctx, "setStatus", contentId, `Conteúdo ${current.code}: ${CONTENT_STATUS[current.status].label} → ${label}`, { from: current.status, to: status });

      if (status === "approved") {
        const readers = contentReaders(next);
        const actorId = actor.uid;
        ctx.after(() => notifyApproved(next, readers, actorId, ctx.requestId));
      }
      return { id: contentId };
    },
    async present(result, actor) {
      return presentContent(result.id, actor);
    },
  }),

  addFiles: mutation({
    module: "marketing",
    schema: addFilesSchema,
    /**
     * Antes da transação: conferência antecipada do acesso (repetida dentro
     * dela) e conferência/cópia dos arquivos para `marketing/{id}/`.
     * Repetir a mesma requisição devolve os mesmos arquivos (finalizeUpload é idempotente).
     */
    async prepare(actor, { id: contentId, uploadIds }, ctx): Promise<FileRef[]> {
      const snap = await db.doc(`contents/${contentId}`).get();
      if (!snap.exists) fail("not_found", "Conteúdo não encontrado. Pode ter sido removido ou não estar disponível para o seu perfil.");
      const item = normalizeContent(toDTO<ContentItem>(snap));
      requireVisible(actor, item);
      if (!canEditContent(actor.ctx, item)) fail("forbidden", "Seu perfil não pode anexar arquivos a este conteúdo.");
      requireChangeable(actor, item);
      const results = await Promise.allSettled(uploadIds.map((uploadId) => finalizeUpload(actor, uploadId, "marketingFile", `marketing/${contentId}`, ctx)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
      return results.map((r) => (r as PromiseFulfilledResult<FileRef>).value);
    },
    async run(tx, actor, { id: contentId, uploadIds }, ctx, files): Promise<ContentRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "marketing");
      const { ref, item: current } = await loadContent(tx, contentId);
      requireVisible(actor, current);
      if (!canEditContent(actor.ctx, current)) fail("forbidden", "Seu perfil não pode anexar arquivos a este conteúdo.");
      requireChangeable(actor, current);

      // O mesmo arquivo nunca é anexado duas vezes (ex.: requisição repetida com outro identificador).
      const known = new Set(current.files.map((f) => f.path).filter(Boolean));
      const fresh = files.filter((f) => !known.has(f.path));
      if (fresh.length === 0) return { id: contentId };
      if (current.files.length + fresh.length > MAX_FILES) {
        fail("conflict", `Este conteúdo já tem ${current.files.length} arquivos; o limite é ${MAX_FILES} por conteúdo.`);
      }

      const next: ContentItem = {
        ...current,
        files: [...current.files, ...fresh],
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["attachment", `${fresh.length} arquivo(s) anexado(s)`]),
      };
      tx.update(ref, { files: next.files, updatedAt: ctx.now, history: next.history });
      for (const uploadId of uploadIds) markAttached(tx, uploadId, `contents/${contentId}`);
      indexRecord(tx, searchEntryFor.content(next));
      audit(tx, actor, ctx, "addFiles", contentId, `${fresh.length} arquivo(s) anexado(s) ao conteúdo ${current.code}`, {
        files: fresh.length,
        bytes: fresh.reduce((sum, f) => sum + f.size, 0),
        uploadIds: uploadIds.join(","),
        total: next.files.length,
      });
      return { id: contentId };
    },
    async present(result, actor) {
      return presentContent(result.id, actor);
    },
  }),
};

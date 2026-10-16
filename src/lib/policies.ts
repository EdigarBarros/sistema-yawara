/**
 * Políticas de acesso por registro (SIMULADAS nesta etapa).
 *
 * Usadas pelos serviços locais para filtrar dados e pelas telas para
 * mostrar ou esconder ações. Na Etapa 2, as mesmas regras devem ser
 * reproduzidas nas regras de segurança do backend — a interface não é
 * uma barreira de segurança.
 */
import type {
  AtleticaEvent,
  Campaign,
  ContentItem,
  ContentStatus,
  ExtensionProject,
  FinanceEntry,
  InstitutionalDocument,
  Meeting,
  MeetingStatus,
  Sale,
} from "@/types";
import { canSeeRecord, hasPermission, matchesAudience, type AccessContext } from "./permissions";

/* ------------------------------- Campanhas ------------------------------ */

export function canSeeCampaign(ctx: AccessContext, c: Campaign) {
  return canSeeRecord(ctx, "campaigns", { access: c.access.view, createdBy: c.createdBy, departmentId: c.departmentId });
}

export function canManageCampaign(ctx: AccessContext, c: Campaign) {
  return c.createdBy === ctx.user.id || hasPermission(ctx, "campaigns.edit") || hasPermission(ctx, "campaigns.admin");
}

export function canCloseCampaign(ctx: AccessContext, c: Campaign) {
  return c.createdBy === ctx.user.id || hasPermission(ctx, "campaigns.archive");
}

export function canSellIn(ctx: AccessContext, c: Campaign) {
  if (!hasPermission(ctx, "campaigns.register")) return false;
  if (c.createdBy === ctx.user.id || hasPermission(ctx, "campaigns.admin")) return true;
  return matchesAudience(ctx, c.access.sell, c.departmentId);
}

export function canSeeBuyer(ctx: AccessContext, c: Campaign, sale: Pick<Sale, "registeredById" | "sellerId">) {
  if (c.createdBy === ctx.user.id || hasPermission(ctx, "campaigns.admin")) return true;
  if (sale.registeredById === ctx.user.id || sale.sellerId === ctx.user.id) return true;
  return matchesAudience(ctx, c.access.buyerData, c.departmentId);
}

/** Pode ver dados de compradores de forma geral (para exportações internas). */
export function canSeeAllBuyers(ctx: AccessContext, c: Campaign) {
  if (c.createdBy === ctx.user.id || hasPermission(ctx, "campaigns.admin")) return true;
  return matchesAudience(ctx, c.access.buyerData, c.departmentId);
}

export function canEditSale(ctx: AccessContext, sale: Pick<Sale, "registeredById">) {
  return hasPermission(ctx, "campaigns.edit") || sale.registeredById === ctx.user.id;
}

/**
 * Trocar o responsável pela venda dá ao novo responsável acesso aos dados do
 * comprador: só quem pode editar a venda E já vê esses dados pode transferi-la.
 */
export function canChangeSeller(ctx: AccessContext, c: Campaign, sale: Pick<Sale, "registeredById" | "sellerId">) {
  return canEditSale(ctx, sale) && canSeeBuyer(ctx, c, sale);
}

/** Forma de pagamento de uma venda já paga: só quem confirma recebimentos altera (a confirmação vale para a forma registrada). */
export function canChangePaymentMethod(ctx: AccessContext, sale: Pick<Sale, "status">) {
  return sale.status !== "paid" || hasPermission(ctx, "campaigns.approve");
}

/* -------------------------------- Eventos ------------------------------- */

export function canSeeEvent(ctx: AccessContext, ev: AtleticaEvent) {
  if (ev.responsibleIds.includes(ctx.user.id) && hasPermission(ctx, "events.view")) return true;
  return canSeeRecord(ctx, "events", ev);
}

/** Editar dados do evento: criador, administradores ou quem tem "editar" e não é assessor. */
export function canEditEvent(ctx: AccessContext, ev: AtleticaEvent) {
  if (ev.createdBy === ctx.user.id || hasPermission(ctx, "events.admin")) return true;
  return hasPermission(ctx, "events.edit") && ctx.role.level !== "advisor";
}

/** Tarefas e programação: quem pode editar eventos, assessores com "editar" ou responsáveis designados. */
export function canEditTasks(ctx: AccessContext, ev: AtleticaEvent) {
  return canEditEvent(ctx, ev) || hasPermission(ctx, "events.edit") || ev.responsibleIds.includes(ctx.user.id);
}

export function canCloseEvent(ctx: AccessContext, ev: AtleticaEvent) {
  return ev.createdBy === ctx.user.id || hasPermission(ctx, "events.archive");
}

/** Aba financeira do evento: Financeiro ou diretoria do departamento responsável. */
export function canSeeEventFinance(ctx: AccessContext, ev: AtleticaEvent) {
  if (hasPermission(ctx, "finance.view")) return true;
  return ctx.role.isBoard && (ctx.role.departmentId === ev.departmentId || ctx.role.level === "presidency");
}

/* ------------------------------ Documentos ------------------------------ */

export function canSeeDocument(ctx: AccessContext, doc: InstitutionalDocument) {
  return canSeeRecord(ctx, "documents", doc);
}

export function canEditDocument(ctx: AccessContext, doc: InstitutionalDocument) {
  if (doc.createdBy === ctx.user.id || hasPermission(ctx, "documents.admin")) return true;
  return hasPermission(ctx, "documents.edit") && doc.departmentId === ctx.role.departmentId;
}

export function canArchiveDocument(ctx: AccessContext, doc: InstitutionalDocument) {
  return doc.createdBy === ctx.user.id || hasPermission(ctx, "documents.archive");
}

/**
 * Marcar como "Vigente" (validar o documento): documents.approve ou quem criou.
 * Uma nova versão enviada por quem não valida faz um documento vigente voltar
 * para "Em elaboração" até ser validado de novo.
 */
export function canMarkDocumentCurrent(ctx: AccessContext, doc: Pick<InstitutionalDocument, "createdBy">) {
  return doc.createdBy === ctx.user.id || hasPermission(ctx, "documents.approve");
}

/* ------------------------------- Reuniões ------------------------------- */

export function canSeeMeeting(ctx: AccessContext, m: Meeting) {
  if (m.participantIds.includes(ctx.user.id) && hasPermission(ctx, "meetings.view")) return true;
  return canSeeRecord(ctx, "meetings", { access: m.access, createdBy: m.createdBy });
}

export function canEditMeeting(ctx: AccessContext, m: Meeting) {
  if (m.status === "approved" || m.status === "archived") return false;
  return m.createdBy === ctx.user.id || hasPermission(ctx, "meetings.edit");
}

/** Transições permitidas da ata e a permissão exigida em cada uma. */
export const MEETING_TRANSITIONS: Record<MeetingStatus, Partial<Record<MeetingStatus, "edit" | "approve" | "archive">>> = {
  draft: { pending_approval: "edit" },
  pending_approval: { approved: "approve", draft: "edit" },
  approved: { archived: "archive", draft: "approve" },
  archived: { approved: "archive" },
};

export function allowedMeetingTransitions(ctx: AccessContext, m: Meeting): MeetingStatus[] {
  return (Object.entries(MEETING_TRANSITIONS[m.status]) as [MeetingStatus, "edit" | "approve" | "archive"][])
    .filter(([, perm]) => hasPermission(ctx, `meetings.${perm}`) || (perm === "edit" && m.createdBy === ctx.user.id))
    .map(([status]) => status);
}

/* ------------------------------ Financeiro ------------------------------ */

export function canEditEntry(ctx: AccessContext, entry: FinanceEntry) {
  if (entry.status === "cancelled") return false;
  if (hasPermission(ctx, "finance.edit")) return true;
  return entry.createdBy === ctx.user.id && entry.status === "pending" && hasPermission(ctx, "finance.register");
}

/* ------------------------------- Marketing ------------------------------ */

export function canSeeContent(ctx: AccessContext, c: ContentItem) {
  if (c.responsibleId === ctx.user.id && hasPermission(ctx, "marketing.view")) return true;
  return canSeeRecord(ctx, "marketing", c);
}

export function canEditContent(ctx: AccessContext, c: ContentItem) {
  return hasPermission(ctx, "marketing.edit") || c.createdBy === ctx.user.id || c.responsibleId === ctx.user.id;
}

/** O material já passou pela aprovação ("Aprovado" ou "Publicado"). */
export function isContentApproved(c: Pick<ContentItem, "status">) {
  return c.status === "approved" || c.status === "published";
}

/**
 * Alterar o material (dados, links, público e arquivos). Depois da aprovação,
 * só quem aprova altera — senão o que chega a "Publicado" não seria o que foi
 * aprovado. Quem não aprova devolve o conteúdo publicado para revisão (ou pede
 * a quem aprova que devolva um aprovado) e ele precisa de nova aprovação.
 */
export function canChangeContent(ctx: AccessContext, c: ContentItem) {
  if (!canEditContent(ctx, c)) return false;
  return !isContentApproved(c) || hasPermission(ctx, "marketing.approve");
}

/**
 * Quais etapas o perfil pode escolher a partir da etapa atual.
 * "Publicado" só vem depois de "Aprovado" (para todos os perfis): a aprovação
 * não pode ser pulada, fica no histórico e avisa a diretoria.
 */
export function allowedContentStatuses(ctx: AccessContext, c: ContentItem): ContentStatus[] {
  const all: ContentStatus[] = ["briefing", "production", "review", "approved", "published", "cancelled"];
  const approver = hasPermission(ctx, "marketing.approve");
  return all.filter((s) => {
    if (s === c.status) return false;
    if (s === "approved") return approver;
    if (s === "cancelled") return hasPermission(ctx, "marketing.archive");
    if (s === "published") return c.status === "approved" && (approver || canEditContent(ctx, c));
    if (c.status === "approved" && !approver) return false;
    return canEditContent(ctx, c);
  });
}

/* --------------------------- Ensino e Extensão -------------------------- */

export function canSeeProject(ctx: AccessContext, p: ExtensionProject) {
  if (p.responsibleId === ctx.user.id && hasPermission(ctx, "extension.view")) return true;
  return canSeeRecord(ctx, "extension", p);
}

/** Lista de presença (dados pessoais): somente quem pode editar o projeto. */
export function canSeeAttendees(ctx: AccessContext, p: ExtensionProject) {
  return canSeeProject(ctx, p) && (canEditProject(ctx, p) || hasPermission(ctx, "extension.admin"));
}

export function canEditProject(ctx: AccessContext, p: ExtensionProject) {
  return hasPermission(ctx, "extension.edit") || p.createdBy === ctx.user.id || p.responsibleId === ctx.user.id;
}

export function canCloseProject(ctx: AccessContext, p: ExtensionProject) {
  return p.createdBy === ctx.user.id || hasPermission(ctx, "extension.archive");
}

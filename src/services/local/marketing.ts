import type { ContentInput, MarketingService } from "../contracts";
import type { Audience, ContentItem } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import { emptyAudience, type AccessContext } from "@/lib/permissions";
import { CONTENT_STATUS } from "@/lib/labels";
import { newId } from "@/lib/utils";
import { commit, getDB } from "./db";
import { storeFile } from "./blob-store";
import {
  accessContext,
  clone,
  findOrThrow,
  historyEntry,
  latency,
  nextCode,
  now,
  pushNotification,
  requireModuleEnabled,
  requirePermission,
  sanitizeAudience,
  ServiceError,
  validateAudience,
} from "./context";
import { allowedContentStatuses, canChangeContent, canEditContent, canSeeContent } from "@/lib/policies";

function visible(db: DemoDB, ctx: AccessContext, id: string) {
  const item = findOrThrow(db.contents, id, "Conteúdo");
  if (!canSeeContent(ctx, item)) throw new ServiceError("forbidden", "Este conteúdo não está disponível para o seu perfil.");
  return item;
}

/** Material já aprovado (ou publicado): só quem aprova altera dados e arquivos (como no servidor). */
function requireChangeable(ctx: AccessContext, item: ContentItem) {
  if (canChangeContent(ctx, item)) return;
  throw new ServiceError(
    "conflict",
    item.status === "published"
      ? "Este material já foi publicado. Volte-o para a etapa “Em revisão” antes de alterar; depois ele precisa ser aprovado de novo."
      : "Este material já foi aprovado. Peça a quem aprova para devolvê-lo à revisão antes de alterar.",
  );
}

function validate(input: Partial<ContentInput>, creating: boolean) {
  if (creating || input.title !== undefined) {
    if (!input.title || input.title.trim().length < 3) throw new ServiceError("invalid", "Informe o nome do conteúdo.");
  }
  if (creating || input.briefing !== undefined) {
    if (!input.briefing || input.briefing.trim().length < 10) throw new ServiceError("invalid", "Escreva um briefing com pelo menos 10 caracteres.");
  }
  if (creating && (!input.channels || input.channels.length === 0)) throw new ServiceError("invalid", "Escolha pelo menos um canal de divulgação.");
  for (const link of input.links ?? []) {
    if (!/^https?:\/\//i.test(link.url)) throw new ServiceError("invalid", `O link “${link.label || link.url}” precisa começar com http:// ou https://`);
  }
  if (input.access) {
    // Conteúdos não pertencem a um departamento: o escopo "departamento" precisa dizer qual (como no servidor).
    if (input.access.scope === "department" && !input.access.departmentId) throw new ServiceError("invalid", "Visibilidade: escolha o departamento.");
    validateAudience(input.access, "Visibilidade");
  }
}

function sameAudience(a: Audience, b: Audience) {
  return JSON.stringify(sanitizeAudience(a)) === JSON.stringify(sanitizeAudience(b));
}

export const localMarketing: MarketingService = {
  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "marketing");
    const ctx = accessContext(db);
    return clone(db.contents.filter((c) => canSeeContent(ctx, c)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "marketing");
    return clone(visible(db, accessContext(db), id));
  },

  async create(input) {
    await latency(300, 550);
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "marketing.create", "Seu perfil não pode criar conteúdos.");
      validate(input, true);
      const at = now();
      const item: ContentItem = {
        id: newId("cnt"),
        code: nextCode(db, "MKT"),
        title: input.title.trim(),
        type: input.type,
        campaignId: input.campaignId || undefined,
        eventId: input.eventId || undefined,
        responsibleId: input.responsibleId,
        publishDate: input.publishDate || undefined,
        channels: input.channels,
        briefing: input.briefing.trim(),
        notes: input.notes?.trim() || undefined,
        links: input.links,
        files: [],
        status: "briefing",
        // Público opcional (compartilhamento); padrão: todos com acesso ao Marketing.
        access: sanitizeAudience(input.access ?? emptyAudience("all")),
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", "Conteúdo criado com briefing")],
      };
      db.contents.unshift(item);
      return clone(item);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const item = visible(db, ctx, id);
      if (!canEditContent(ctx, item)) throw new ServiceError("forbidden", "Seu perfil não pode editar este conteúdo.");
      requireChangeable(ctx, item);
      validate(input, false);
      const accessChanged = !!input.access && !sameAudience(input.access, item.access);
      Object.assign(item, input, input.access ? { access: sanitizeAudience(input.access) } : {}, { updatedAt: now() });
      item.history.push(historyEntry(ctx.user.id, "updated", "Conteúdo editado"));
      if (accessChanged) item.history.push(historyEntry(ctx.user.id, "shared", "Visibilidade do conteúdo alterada"));
      return clone(item);
    });
  },

  async setStatus(id, status) {
    await latency(150, 300);
    return commit((db) => {
      const ctx = accessContext(db);
      const item = visible(db, ctx, id);
      if (!allowedContentStatuses(ctx, item).includes(status)) {
        throw new ServiceError("forbidden", `Seu perfil não pode mover este conteúdo para “${CONTENT_STATUS[status].label}”.`);
      }
      item.status = status;
      item.updatedAt = now();
      item.history.push(historyEntry(ctx.user.id, "status", `Etapa alterada para ${CONTENT_STATUS[status].label}`));
      if (status === "approved") {
        pushNotification(db, {
          kind: "content_approved",
          title: "Material aprovado",
          body: `“${item.title}” foi aprovado pelo Marketing.`,
          href: `/marketing?item=${item.id}`,
          audience: { scope: "board", roleIds: [], userIds: [] },
          actorId: ctx.user.id,
        });
      }
      return clone(item);
    });
  },

  async addFiles(id, files) {
    await latency(300, 600);
    return commit((db) => {
      const ctx = accessContext(db);
      const item = visible(db, ctx, id);
      if (!canEditContent(ctx, item)) throw new ServiceError("forbidden", "Seu perfil não pode anexar arquivos a este conteúdo.");
      requireChangeable(ctx, item);
      if (files.some((f) => f.size > 50 * 1024 * 1024)) throw new ServiceError("invalid", "Cada arquivo deve ter no máximo 50 MB.");
      item.files.push(...files.map((f) => storeFile(f)));
      item.updatedAt = now();
      item.history.push(historyEntry(ctx.user.id, "attachment", `${files.length} arquivo(s) anexado(s) (somente neste navegador)`));
      return clone(item);
    });
  },
};

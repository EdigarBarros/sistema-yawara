import type { DocumentInput, DocumentService } from "../contracts";
import type { InstitutionalDocument } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import type { AccessContext } from "@/lib/permissions";
import { AUDIENCE_SCOPE_LABELS, DOCUMENT_STATUS } from "@/lib/labels";
import { newId } from "@/lib/utils";
import { isSupportRole } from "@/lib/support";
import { commit, getDB } from "./db";
import { storeFile } from "./blob-store";
import {
  accessContext,
  clone,
  findOrThrow,
  historyEntry,
  latency,
  now,
  pushNotification,
  requireModuleEnabled,
  requirePermission,
  sanitizeAudience,
  ServiceError,
  validateAudience,
} from "./context";
import { canEditDocument, canMarkDocumentCurrent, canSeeDocument } from "@/lib/policies";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function visibleDoc(db: DemoDB, ctx: AccessContext, id: string) {
  const doc = findOrThrow(db.documents, id, "Documento");
  if (!canSeeDocument(ctx, doc)) throw new ServiceError("forbidden", "Este documento não está disponível para o seu perfil.");
  return doc;
}

function checkFile(file: File | Blob | null) {
  if (file && file.size > MAX_FILE_BYTES) {
    throw new ServiceError("invalid", "O arquivo é maior que 25 MB. Escolha um arquivo menor para a demonstração.");
  }
}

export const localDocuments: DocumentService = {
  async listCategories() {
    await latency(60, 140);
    return clone(getDB().documentCategories);
  },

  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "documents");
    const ctx = accessContext(db);
    return clone(db.documents.filter((d) => canSeeDocument(ctx, d)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "documents");
    return clone(visibleDoc(db, accessContext(db), id));
  },

  async create(input: DocumentInput, file, fileName) {
    await latency(400, 800);
    checkFile(file);
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "documents.create", "Seu perfil não pode adicionar documentos.");
      if (!input.name || input.name.trim().length < 3) throw new ServiceError("invalid", "Informe o nome do documento.");
      findOrThrow(db.documentCategories, input.categoryId, "Categoria");
      validateAudience(input.access, "Compartilhamento");
      const at = now();
      const doc: InstitutionalDocument = {
        id: newId("doc"),
        name: input.name.trim(),
        description: input.description.trim(),
        categoryId: input.categoryId,
        departmentId: input.departmentId,
        access: sanitizeAudience(input.access),
        status: input.status,
        versions: [{ version: 1, file: file ? storeFile(file, fileName) : null, uploadedBy: ctx.user.id, uploadedAt: at, note: "Versão inicial" }],
        links: input.links ?? {},
        sample: false,
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", file ? "Documento adicionado com arquivo local (somente neste navegador)" : "Documento adicionado sem arquivo")],
      };
      db.documents.unshift(doc);
      pushNotification(db, {
        kind: "document_shared",
        title: "Documento compartilhado",
        body: `${ctx.user.name} compartilhou “${doc.name}” (${AUDIENCE_SCOPE_LABELS[doc.access.scope].toLowerCase()}).`,
        href: `/documentos/${doc.id}`,
        audience: doc.access,
        actorId: ctx.user.id,
      });
      return clone(doc);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const doc = visibleDoc(db, ctx, id);
      if (!canEditDocument(ctx, doc)) throw new ServiceError("forbidden", "Seu perfil não pode editar este documento.");
      if (input.name !== undefined && input.name.trim().length < 3) throw new ServiceError("invalid", "Informe o nome do documento.");
      if (input.status === "current" && doc.status !== "current" && !canMarkDocumentCurrent(ctx, doc)) {
        throw new ServiceError("forbidden", "Seu perfil não pode marcar documentos como vigentes.");
      }
      const statusChanged = input.status && input.status !== doc.status;
      Object.assign(doc, input, { updatedAt: now() });
      doc.history.push(historyEntry(ctx.user.id, "updated", "Informações do documento alteradas"));
      if (statusChanged) doc.history.push(historyEntry(ctx.user.id, "status", `Situação alterada para ${DOCUMENT_STATUS[doc.status].label}`));
      return clone(doc);
    });
  },

  async setAccess(id, access) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const doc = visibleDoc(db, ctx, id);
      if (!canEditDocument(ctx, doc)) throw new ServiceError("forbidden", "Seu perfil não pode alterar o compartilhamento deste documento.");
      validateAudience(access, "Compartilhamento");
      doc.access = sanitizeAudience(access);
      doc.updatedAt = now();
      doc.history.push(historyEntry(ctx.user.id, "shared", `Compartilhamento alterado para: ${AUDIENCE_SCOPE_LABELS[access.scope]}`));
      pushNotification(db, {
        kind: "document_shared",
        title: "Documento compartilhado com você",
        body: `${ctx.user.name} alterou o acesso de “${doc.name}”.`,
        href: `/documentos/${doc.id}`,
        audience: doc.access,
        actorId: ctx.user.id,
      });
      return clone(doc);
    });
  },

  async addVersion(id, file, note) {
    await latency(400, 800);
    checkFile(file);
    return commit((db) => {
      const ctx = accessContext(db);
      const doc = visibleDoc(db, ctx, id);
      if (!canEditDocument(ctx, doc)) throw new ServiceError("forbidden", "Seu perfil não pode enviar novas versões deste documento.");
      if (doc.status === "archived") throw new ServiceError("conflict", "Restaure o documento antes de enviar uma nova versão.");
      const version = doc.versions.length + 1;
      // Como no servidor: documento vigente com versão nova de quem não valida volta para "Em elaboração".
      const awaitingValidation = doc.status === "current" && !canMarkDocumentCurrent(ctx, doc);
      doc.versions.push({ version, file: storeFile(file), uploadedBy: ctx.user.id, uploadedAt: now(), note: note?.trim() || undefined });
      doc.updatedAt = now();
      doc.history.push(historyEntry(ctx.user.id, "version", `Versão ${version} enviada; versões anteriores mantidas`));
      if (awaitingValidation) {
        doc.status = "draft";
        doc.history.push(historyEntry(ctx.user.id, "status", `Nova versão aguardando validação: situação alterada para ${DOCUMENT_STATUS.draft.label}`));
      }
      return clone(doc);
    });
  },

  async archive(id) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const doc = visibleDoc(db, ctx, id);
      if (doc.createdBy !== ctx.user.id) requirePermission(ctx, "documents.archive", "Seu perfil não pode arquivar documentos.");
      if (doc.status === "archived") throw new ServiceError("conflict", "O documento já está arquivado.");
      doc.status = "archived";
      doc.updatedAt = now();
      doc.history.push(historyEntry(ctx.user.id, "archived", "Documento arquivado (continua disponível para consulta)"));
      return clone(doc);
    });
  },

  async restore(id) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const doc = visibleDoc(db, ctx, id);
      if (doc.createdBy !== ctx.user.id) requirePermission(ctx, "documents.archive", "Seu perfil não pode restaurar documentos.");
      if (doc.status !== "archived") throw new ServiceError("conflict", "O documento não está arquivado.");
      // Como no servidor: volta vigente só para quem pode marcar como vigente; senão, em elaboração.
      doc.status = canMarkDocumentCurrent(ctx, doc) ? "current" : "draft";
      doc.updatedAt = now();
      doc.history.push(historyEntry(ctx.user.id, "restored", doc.status === "current" ? "Documento restaurado" : "Documento restaurado (em elaboração)"));
      return clone(doc);
    });
  },

  async remove(id) {
    await latency();
    commit((db) => {
      const ctx = accessContext(db);
      if (!isSupportRole(ctx.role.id)) throw new ServiceError("forbidden", "Somente o Suporte do sistema pode excluir documentos de vez. Use Arquivar.");
      findOrThrow(db.documents, id, "Documento");
      db.documents = db.documents.filter((d) => d.id !== id);
    });
  },
};

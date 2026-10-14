/**
 * SISTEMA: configurações institucionais, módulos, categorias e envio de arquivos.
 */
import { z } from "zod";
import { MODULE_MAP } from "@/lib/modules";
import type { DocumentCategory, FinanceCategory, ModuleKey, SystemSettings } from "@/types";
import { db } from "../core/admin";
import { loadSettings, requirePermission } from "../core/actor";
import { auditInTx } from "../core/audit";
import { mutation, query } from "../core/dispatch";
import { fail } from "../core/errors";
import { createUploadTicket, UPLOAD_RULES, type UploadPurpose } from "../core/files";
import { requireDoc, toDTO } from "../core/records";

const MODULE_KEYS = Object.keys(MODULE_MAP) as [ModuleKey, ...ModuleKey[]];
const categoryName = z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres.").max(80);

const institution = z
  .object({
    legalName: z.string().trim().min(3).max(200),
    shortName: z.string().trim().min(2).max(80),
    systemName: z.string().trim().min(3, "O nome do sistema precisa ter pelo menos 3 caracteres.").max(60),
    course: z.string().trim().max(120),
    institution: z.string().trim().max(160),
    city: z.string().trim().max(120),
    email: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Informe um e-mail válido."),
    instagram: z.string().trim().max(60),
    motto: z.string().trim().max(120),
  })
  .partial()
  .strict();

async function presentSettings(): Promise<SystemSettings> {
  return (await db.doc("settings/system").get()).data() as SystemSettings;
}

export const systemActions = {
  updateInstitution: mutation({
    module: "system",
    schema: institution,
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "settings.edit", "Seu perfil não pode editar os dados institucionais.");
      const settings = await loadSettings(tx);
      if (!settings) fail("unavailable", "As configurações ainda não foram inicializadas. Rode o script de implantação inicial.");
      tx.update(db.doc("settings/system"), Object.fromEntries(Object.entries(input).map(([k, v]) => [`institution.${k}`, v])));
      auditInTx(
        tx,
        { uid: actor.uid, name: actor.name },
        { action: "settings.updateInstitution", module: "settings", resourceType: "settings", resourceId: "system", summary: `Dados institucionais alterados: ${Object.keys(input).join(", ")}` },
        ctx.requestId,
        ctx.now,
      );
      return { ok: true };
    },
    present: presentSettings,
  }),

  setModuleEnabled: mutation({
    module: "system",
    schema: z.object({ module: z.enum(MODULE_KEYS), enabled: z.boolean() }),
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "settings.admin", "Seu perfil não pode ativar ou desativar módulos.");
      if (MODULE_MAP[input.module].core) fail("invalid", "Este módulo é essencial e não pode ser desativado.");
      const settings = await loadSettings(tx);
      if (!settings) fail("unavailable", "As configurações ainda não foram inicializadas.");
      tx.update(db.doc("settings/system"), { [`modules.${input.module}`]: input.enabled });
      auditInTx(
        tx,
        { uid: actor.uid, name: actor.name },
        {
          action: "settings.setModuleEnabled",
          module: "settings",
          resourceType: "settings",
          resourceId: "system",
          summary: `Módulo ${MODULE_MAP[input.module].label} ${input.enabled ? "ativado" : "desativado"}`,
        },
        ctx.requestId,
        ctx.now,
      );
      return { ok: true };
    },
    present: presentSettings,
  }),

  createDocumentCategory: mutation({
    module: "system",
    schema: z.object({ name: categoryName }),
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "settings.edit", "Seu perfil não pode alterar categorias.");
      const all = await tx.get(db.collection("documentCategories"));
      if (all.docs.some((d) => String(d.data().name).toLowerCase() === input.name.toLowerCase())) fail("conflict", "Essa categoria já existe.");
      const ref = db.collection("documentCategories").doc();
      tx.create(ref, { name: input.name, createdAt: ctx.now, createdBy: actor.uid });
      auditInTx(tx, { uid: actor.uid, name: actor.name }, { action: "settings.createDocumentCategory", module: "settings", resourceType: "documentCategory", resourceId: ref.id, summary: `Categoria de documento criada: ${input.name}` }, ctx.requestId, ctx.now);
      return { id: ref.id };
    },
    async present(r) {
      return toDTO<DocumentCategory>(await db.doc(`documentCategories/${r.id}`).get());
    },
  }),

  renameDocumentCategory: mutation({
    module: "system",
    schema: z.object({ id: z.string().min(1).max(128), name: categoryName }),
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "settings.edit", "Seu perfil não pode alterar categorias.");
      const snap = requireDoc(await tx.get(db.doc(`documentCategories/${input.id}`)), "Categoria");
      tx.update(snap.ref, { name: input.name, updatedAt: ctx.now, updatedBy: actor.uid });
      auditInTx(tx, { uid: actor.uid, name: actor.name }, { action: "settings.renameDocumentCategory", module: "settings", resourceType: "documentCategory", resourceId: input.id, summary: `Categoria renomeada para ${input.name}` }, ctx.requestId, ctx.now);
      return { id: input.id };
    },
    async present(r) {
      return toDTO<DocumentCategory>(await db.doc(`documentCategories/${r.id}`).get());
    },
  }),

  createFinanceCategory: mutation({
    module: "system",
    schema: z.object({ name: categoryName, type: z.enum(["income", "expense"]) }),
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "settings.edit", "Seu perfil não pode alterar categorias.");
      const all = await tx.get(db.collection("financeCategories"));
      if (all.docs.some((d) => d.data().type === input.type && String(d.data().name).toLowerCase() === input.name.toLowerCase())) fail("conflict", "Essa categoria já existe.");
      const ref = db.collection("financeCategories").doc();
      tx.create(ref, { name: input.name, type: input.type, createdAt: ctx.now, createdBy: actor.uid });
      auditInTx(tx, { uid: actor.uid, name: actor.name }, { action: "settings.createFinanceCategory", module: "settings", resourceType: "financeCategory", resourceId: ref.id, summary: `Categoria financeira criada: ${input.name}` }, ctx.requestId, ctx.now);
      return { id: ref.id };
    },
    async present(r) {
      return toDTO<FinanceCategory>(await db.doc(`financeCategories/${r.id}`).get());
    },
  }),

  renameFinanceCategory: mutation({
    module: "system",
    schema: z.object({ id: z.string().min(1).max(128), name: categoryName }),
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "settings.edit", "Seu perfil não pode alterar categorias.");
      const snap = requireDoc(await tx.get(db.doc(`financeCategories/${input.id}`)), "Categoria");
      tx.update(snap.ref, { name: input.name, updatedAt: ctx.now, updatedBy: actor.uid });
      auditInTx(tx, { uid: actor.uid, name: actor.name }, { action: "settings.renameFinanceCategory", module: "settings", resourceType: "financeCategory", resourceId: input.id, summary: `Categoria financeira renomeada para ${input.name}` }, ctx.requestId, ctx.now);
      return { id: input.id };
    },
    async present(r) {
      return toDTO<FinanceCategory>(await db.doc(`financeCategories/${r.id}`).get());
    },
  }),

  /**
   * Emite o tíquete de envio de arquivo. A permissão é conferida aqui de forma
   * geral e, de novo, de forma específica quando o arquivo é anexado ao registro.
   */
  prepareUpload: query({
    module: "system",
    schema: z.object({
      purpose: z.enum(Object.keys(UPLOAD_RULES) as [UploadPurpose, ...UploadPurpose[]]),
      fileName: z.string().trim().min(1).max(300),
      size: z.number().int().positive(),
      contentType: z.string().trim().min(3).max(150),
      targetId: z.string().min(1).max(128).optional(),
    }),
    async run(actor, input) {
      actor = actor!;
      const allowed: Record<UploadPurpose, boolean> = {
        document: actor.can("documents.create") || actor.can("documents.edit") || actor.can("documents.admin"),
        saleReceipt: actor.can("campaigns.approve"),
        financeReceipt: actor.can("finance.register") || actor.can("finance.edit"),
        marketingFile: actor.can("marketing.create") || actor.can("marketing.edit") || actor.can("marketing.view"),
      };
      if (!allowed[input.purpose]) fail("forbidden", "Seu perfil não pode enviar este tipo de arquivo.");
      return createUploadTicket(actor, input);
    },
  }),
};

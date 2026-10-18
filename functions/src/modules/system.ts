/**
 * SISTEMA: configurações institucionais, módulos, categorias e envio de arquivos.
 */
import { z } from "zod";
import { MODULE_MAP } from "@/lib/modules";
import type { DocumentCategory, FinanceCategory, InstitutionSettings, ModuleKey, SystemSettings } from "@/types";
import { db } from "../core/admin";
import { loadSettings, requirePermission } from "../core/actor";
import { auditDirect, auditInTx } from "../core/audit";
import { loadActorOutsideTx, mutation, query } from "../core/dispatch";
import { fail } from "../core/errors";
import { createUploadTicket, DRIVE_CHUNK_BYTES, FILE_CHUNK_BYTES, readDriveFile, storesInDrive, UPLOAD_RULES, writeUploadChunk, type UploadPurpose } from "../core/files";
import { requireDoc, toDTO } from "../core/records";
import { completeDriveConnection, consumeDriveState, driveAuthUrl, driveRedirectUri, driveStatus } from "../core/drive";

const MODULE_KEYS = Object.keys(MODULE_MAP) as [ModuleKey, ...ModuleKey[]];
const categoryName = z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres.").max(80, "O nome da categoria pode ter no máximo 80 caracteres.");

/** Texto institucional com limites e mensagens em português (`field` com artigo: "A razão social"). */
function institutionText(field: string, max: number, min = 0) {
  const base = z.string().trim();
  return (min > 0 ? base.min(min, `${field} precisa ter pelo menos ${min} caracteres.`) : base).max(max, `${field} pode ter no máximo ${max} caracteres.`);
}

const institution = z
  .object({
    legalName: institutionText("A razão social", 200, 3),
    shortName: institutionText("O nome curto", 80, 2),
    systemName: institutionText("O nome do sistema", 60, 3),
    course: institutionText("O curso", 120),
    institution: institutionText("A instituição de ensino", 160),
    city: institutionText("A cidade", 120),
    email: institutionText("O e-mail", 200).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Informe um e-mail válido."),
    instagram: institutionText("O Instagram", 60),
    motto: institutionText("O lema", 120),
  })
  .partial()
  .strict();

/** Campos institucionais na ordem da tela, com o nome usado no resumo da auditoria. */
const INSTITUTION_LABELS: Record<keyof InstitutionSettings, string> = {
  legalName: "razão social",
  shortName: "nome curto",
  systemName: "nome do sistema",
  course: "curso",
  institution: "instituição de ensino",
  city: "cidade",
  email: "e-mail de contato",
  instagram: "Instagram",
  motto: "lema",
};

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
      // Só o que mudou de fato é gravado e auditado (o formulário pode reenviar campos iguais).
      const current: Partial<InstitutionSettings> = settings.institution ?? {};
      const changed = (Object.keys(INSTITUTION_LABELS) as (keyof InstitutionSettings)[]).filter((k) => input[k] !== undefined && input[k] !== current[k]);
      if (changed.length === 0) return { ok: true };
      tx.update(db.doc("settings/system"), Object.fromEntries(changed.map((k) => [`institution.${k}`, input[k]])));
      auditInTx(
        tx,
        { uid: actor.uid, name: actor.name },
        {
          action: "settings.updateInstitution",
          module: "settings",
          resourceType: "settings",
          resourceId: "system",
          summary: `Dados institucionais alterados: ${changed.map((k) => INSTITUTION_LABELS[k]).join(", ")}`,
        },
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
      targetId: z
        .string()
        .min(1)
        .max(128)
        .nullish()
        .transform((v) => v ?? undefined),
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

  /**
   * Implantação gratuita com arquivos no banco: recebe um pedaço (base64) do
   * arquivo de um tíquete pendente da própria pessoa (ver core/files.ts).
   */
  uploadChunk: query({
    module: "system",
    schema: z.object({
      uploadId: z.string().regex(/^[a-f0-9]{32}$/),
      index: z.number().int().min(0).max(1000),
      data: z
        .string()
        .min(4)
        .max(Math.ceil(Math.max(FILE_CHUNK_BYTES, DRIVE_CHUNK_BYTES) / 3) * 4)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Pedaço do arquivo inválido."),
    }),
    async run(actor, input) {
      return writeUploadChunk(actor!, input);
    },
  }),

  /**
   * Implantação gratuita com arquivos no Google Drive: devolve um pedaço
   * (base64) de um arquivo anexado a um registro que a pessoa pode ver.
   */
  /** Situação da conexão com o Google Drive da Atlética (sem segredos). */
  driveStatus: query({
    module: "system",
    schema: z.object({}),
    async run(actor) {
      requirePermission(actor!, "settings.admin", "Somente quem administra as configurações pode ver a conexão com o Google Drive.");
      return driveStatus();
    },
  }),

  /** Começa a conexão com o Google Drive: devolve o endereço de autorização do Google. */
  driveConnectUrl: query({
    module: "system",
    schema: z.object({}),
    async run(actor) {
      requirePermission(actor!, "settings.admin", "Somente quem administra as configurações pode conectar o Google Drive.");
      return { url: await driveAuthUrl(actor!.uid, driveRedirectUri()) };
    },
  }),

  readFile: query({
    module: "system",
    schema: z.object({
      uploadId: z.string().regex(/^[a-f0-9]{32}$/),
      index: z.number().int().min(0).max(200),
    }),
    async run(actor, input) {
      if (!storesInDrive()) fail("unavailable", "A leitura de arquivos pelo servidor não está ativa nesta instalação.");
      return readDriveFile(actor!, input);
    },
  }),
};

/**
 * Retorno do Google depois de "Conectar Google Drive" (rota /api/drive/callback).
 * O `state` de uso único identifica quem iniciou; a permissão é conferida de
 * novo aqui. Devolve o resultado para a tela de Configurações, sem segredos.
 */
export async function finishDriveConnection(params: { code?: string | null; state?: string | null; error?: string | null }) {
  const uid = params.state ? await consumeDriveState(params.state) : null;
  if (!uid) return "invalid" as const;
  if (params.error || !params.code) return "denied" as const;
  let actor;
  try {
    actor = await loadActorOutsideTx(uid);
  } catch {
    return "forbidden" as const;
  }
  if (!actor.can("settings.admin")) return "forbidden" as const;
  try {
    await completeDriveConnection(params.code, driveRedirectUri(), { uid: actor.uid, name: actor.name });
  } catch {
    return "error" as const;
  }
  await auditDirect(
    { uid: actor.uid, name: actor.name },
    { action: "settings.connectDrive", module: "settings", resourceType: "settings", resourceId: "drive", summary: "Google Drive da Atlética conectado para guardar os arquivos" },
  );
  return "ok" as const;
}

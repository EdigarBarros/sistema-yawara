/**
 * AUDITORIA DE EXPORTAÇÕES (systemApi.recordExport)
 * ---------------------------------------------------------------------------
 * PDFs, CSVs e imagens são gerados no navegador a partir de dados que o perfil
 * já pode ver. Esta ação registra a exportação na auditoria oficial, com
 * autor verificado e horário do servidor. A leitura da auditoria é feita
 * diretamente no Firestore (regras: `audit.view`), com paginação por cursor.
 *
 * Regras (conferidas aqui, não só na interface):
 *  - o módulo precisa estar ativo e a pessoa precisa ter `<módulo>.view`;
 *  - exportações com dados pessoais exigem `<módulo>.export`;
 *  - Secretaria (PDF da ata) e Ensino e Extensão (listas e certificados)
 *    exigem sempre `meetings.export` / `extension.export`;
 *  - quando o tipo de registro é conhecido, o registro precisa existir e ser
 *    visível para a pessoa (mesmas políticas de src/lib/policies.ts); com
 *    dados pessoais, a pessoa também precisa poder ver esses dados
 *    (compradores de toda a campanha, lista de presença do projeto).
 *
 * O resumo é texto curto, sem dados pessoais (ex.: "PDF da ata",
 * "CSV interno com dados dos compradores (12 números)").
 *
 * APAGAR REGISTROS (deleteAuditLogs): só o Suporte do sistema. Fica um
 * registro dizendo quantos foram apagados e por quem (que também pode ser
 * apagado depois).
 */
import { z } from "zod";
import { MODULE_MAP } from "@/lib/modules";
import {
  canSeeAllBuyers,
  canSeeAttendees,
  canSeeCampaign,
  canSeeContent,
  canSeeDocument,
  canSeeEvent,
  canSeeMeeting,
  canSeeProject,
} from "@/lib/policies";
import type { AtleticaEvent, Campaign, ContentItem, ExtensionProject, InstitutionalDocument, Meeting, ModuleKey, Permission, SystemSettings } from "@/types";
import { db } from "../core/admin";
import { requirePermission, requireSupport, type Actor } from "../core/actor";
import { auditDirect, auditInTx } from "../core/audit";
import { mutation, query } from "../core/dispatch";
import { fail } from "../core/errors";

const MODULE_KEYS = Object.keys(MODULE_MAP) as [ModuleKey, ...ModuleKey[]];

/** Módulos em que toda exportação exige a permissão de exportar (a interface só oferece o botão com ela). */
const EXPORT_ALWAYS_REQUIRED = new Set<ModuleKey>(["meetings", "extension"]);

type Visibility = (actor: Actor, record: Record<string, unknown>, personalData: boolean) => boolean;

/** Tipos de registro conferidos no Firestore antes de registrar a exportação. */
const RESOURCES: Record<string, { module: ModuleKey; collection: string; visible: Visibility }> = {
  campaign: {
    module: "campaigns",
    collection: "campaigns",
    visible: (a, r, personal) => canSeeCampaign(a.ctx, r as unknown as Campaign) && (!personal || canSeeAllBuyers(a.ctx, r as unknown as Campaign)),
  },
  event: { module: "events", collection: "events", visible: (a, r) => canSeeEvent(a.ctx, r as unknown as AtleticaEvent) },
  document: { module: "documents", collection: "documents", visible: (a, r) => canSeeDocument(a.ctx, r as unknown as InstitutionalDocument) },
  meeting: { module: "meetings", collection: "meetings", visible: (a, r) => canSeeMeeting(a.ctx, r as unknown as Meeting) },
  content: { module: "marketing", collection: "contents", visible: (a, r) => canSeeContent(a.ctx, r as unknown as ContentItem) },
  project: {
    module: "extension",
    collection: "projects",
    visible: (a, r, personal) => {
      // A lista de presença fica em documento separado; as políticas usam só responsáveis e público.
      const project = { ...r, attendees: [] } as unknown as ExtensionProject;
      return canSeeProject(a.ctx, project) && (!personal || canSeeAttendees(a.ctx, project));
    },
  },
};

const INVALID_ID = "Identificador inválido.";

export const recordExportSchema = z
  .object({
    module: z.enum(MODULE_KEYS, "Módulo inválido."),
    resourceType: z
      .string("Tipo de registro inválido.")
      .trim()
      .min(1, "Tipo de registro inválido.")
      .max(60, "Tipo de registro inválido.")
      .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "Tipo de registro inválido."),
    resourceId: z.string(INVALID_ID).trim().min(1, INVALID_ID).max(128, INVALID_ID).regex(/^[A-Za-z0-9_-]+$/, INVALID_ID),
    summary: z
      .string("Descreva a exportação.")
      .trim()
      .min(3, "Descreva a exportação em poucas palavras.")
      .max(300, "O resumo da exportação pode ter no máximo 300 caracteres."),
    personalData: z.boolean("Informe se a exportação inclui dados pessoais."),
  })
  .strict();

function safeVisible(check: Visibility, actor: Actor, record: Record<string, unknown>, personalData: boolean) {
  try {
    return check(actor, record, personalData);
  } catch {
    // Registro com formato inesperado: na dúvida, não registra em nome de quem pode não vê-lo.
    return false;
  }
}

const auditIds = z
  .array(z.string(INVALID_ID).regex(/^[A-Za-z0-9_-]{1,128}$/, INVALID_ID), "Escolha os registros.")
  .min(1, "Escolha pelo menos um registro.")
  .max(100, "Apague no máximo 100 registros por vez.");

export const auditActions = {
  deleteAuditLogs: mutation({
    module: "audit",
    schema: z.object({ ids: auditIds }).strict(),
    async run(tx, actor, { ids }, ctx) {
      actor = actor!;
      requireSupport(actor, "Somente o Suporte do sistema pode apagar registros da auditoria.");
      const unique = [...new Set(ids)];
      for (const logId of unique) tx.delete(db.doc(`auditLogs/${logId}`));
      auditInTx(
        tx,
        { uid: actor.uid, name: actor.name },
        { action: "audit.deleteLogs", module: "audit", resourceType: "auditLog", resourceId: null, summary: `Suporte apagou ${unique.length} registro(s) da auditoria`, details: { count: unique.length } },
        ctx.requestId,
        ctx.now,
      );
      return { deleted: unique.length };
    },
  }),


  recordExport: query({
    module: "audit",
    schema: recordExportSchema,
    async run(actor, input, ctx) {
      actor = actor!;
      const resource = Object.prototype.hasOwnProperty.call(RESOURCES, input.resourceType) ? RESOURCES[input.resourceType] : undefined;
      if (resource && resource.module !== input.module) fail("invalid", "O tipo de registro não pertence a este módulo.");

      const settings = (await db.doc("settings/system").get()).data() as SystemSettings | undefined;
      if (settings?.modules?.[input.module] === false) fail("unavailable", "Este módulo está desativado nas configurações.");

      const label = MODULE_MAP[input.module].label;
      requirePermission(actor, `${input.module}.view` as Permission, `Seu perfil não tem acesso ao módulo ${label}.`);
      if (input.personalData || EXPORT_ALWAYS_REQUIRED.has(input.module)) {
        requirePermission(actor, `${input.module}.export` as Permission, `Seu perfil não pode exportar dados do módulo ${label}.`);
      }

      if (resource) {
        const snap = await db.doc(`${resource.collection}/${input.resourceId}`).get();
        if (!snap.exists) fail("not_found", "Registro não encontrado. Pode ter sido removido ou não estar disponível para o seu perfil.");
        if (!safeVisible(resource.visible, actor, { ...snap.data(), id: snap.id }, input.personalData)) {
          fail("forbidden", input.personalData ? "Seu perfil não pode exportar os dados pessoais deste registro." : "Este registro não está disponível para o seu perfil.");
        }
      }

      await auditDirect(
        { uid: actor.uid, name: actor.name },
        {
          action: `${input.module}.export`,
          module: input.module,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          summary: input.summary,
          details: { personalData: input.personalData },
          outcome: "success",
        },
        ctx.requestId,
      );
      return { recorded: true };
    },
  }),
};

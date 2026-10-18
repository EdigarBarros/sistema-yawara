/**
 * Marketing (Firebase).
 *
 * LEITURAS: Firestore com as regras de segurança (`contents/{id}` filtrado por
 * `readers` — público + criador + responsável).
 *
 * ESCRITAS: função chamável `marketingApi` — o servidor confere permissões
 * (criar, editar, aprovar, cancelar), responsável, vínculos, links e público,
 * recalcula quem pode ver o conteúdo (e, com isso, os arquivos no Storage) e
 * grava histórico, auditoria e índice de busca. `takeRequestId()` é sempre a
 * primeira linha. Nada é publicado nas redes sociais: "Publicado" é apenas a
 * etapa marcada pela equipe.
 *
 * ARQUIVOS: `uploadFile("marketingFile", ...)` envia cada arquivo para a área
 * temporária (com progresso e cancelamento no indicador de envios); a ação
 * `addFiles` recebe os `uploadId`s (até 10 por vez) e o servidor confere o
 * conteúdo real, calcula o SHA-256 e move para `marketing/{id}/`. Tipo e
 * tamanho também são conferidos aqui antes do envio, só para avisar mais cedo.
 */
import { doc, getDoc } from "firebase/firestore";
import type { Audience, ContentItem } from "@/types";
import type { ContentInput, MarketingService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, isRetriable, takeRequestId } from "./call";
import { mapFirestoreError } from "./convert";
import { contentTypeOf, isLinkFile, uploadFile } from "./files";
import { getVisible, listVisible } from "./queries";
import { whenAccess } from "./session";
import { FILE_LIMIT_MB, usesFileDatabase } from "@/lib/mode";

/* --------------------------- regras dos arquivos --------------------------- */

/** Limite por arquivo (o mesmo do servidor: functions/src/core/files.ts). */
export const MARKETING_MAX_BYTES = FILE_LIMIT_MB.marketingFile * 1024 * 1024;
/** Arquivos por envio (o mesmo do servidor: functions/src/modules/marketing.ts). */
export const MARKETING_MAX_FILES_PER_CALL = 10;

/** Vídeo só com o Cloud Storage: no banco gratuito os arquivos são pequenos (até 8 MB). */
const VIDEO_TYPES = usesFileDatabase ? [] : ["video/mp4", "video/quicktime"];

const MARKETING_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  ...VIDEO_TYPES,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
];

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};

/** Valor do atributo `accept` do seletor de arquivos. */
export const MARKETING_ACCEPT = `.pdf,.png,.jpg,.jpeg,.webp,.gif,${usesFileDatabase ? "" : ".mp4,.mov,"}.docx,.xlsx,.pptx,.odt,.ods,.odp`;

export const MARKETING_FORMATS_LABEL = `PDF, imagens (PNG, JPG, WEBP, GIF), ${usesFileDatabase ? "" : "vídeos MP4/MOV, "}Word/Excel/PowerPoint/ODF`;

/** Tipo aceito com que o arquivo será enviado: o do navegador, se aceito; senão, o da extensão. */
function marketingTypeOf(file: File): string | null {
  const declared = contentTypeOf(file, file.name);
  if (MARKETING_MIME_TYPES.includes(declared)) return declared;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExtension = MIME_BY_EXTENSION[ext];
  return byExtension && MARKETING_MIME_TYPES.includes(byExtension) ? byExtension : null;
}

/** Problema do arquivo escolhido (tipo ou tamanho), ou `null` quando pode ser enviado. */
export function marketingFileProblem(file: File): string | null {
  // Link (implantação gratuita): o servidor confere o endereço.
  if (isLinkFile(file)) return null;
  if (file.size <= 0) return `O arquivo “${file.name}” está vazio.`;
  if (file.size > MARKETING_MAX_BYTES) return `O arquivo “${file.name}” é maior que ${FILE_LIMIT_MB.marketingFile} MB. Cada arquivo deve ter no máximo ${FILE_LIMIT_MB.marketingFile} MB.`;
  if (!marketingTypeOf(file)) return `Formato não aceito em “${file.name}”. Formatos aceitos: ${MARKETING_FORMATS_LABEL}.`;
  return null;
}

/* -------------------------------- auxiliares ------------------------------- */

const CONTENT_KEYS = ["title", "type", "campaignId", "eventId", "responsibleId", "publishDate", "channels", "briefing", "notes", "links"] as const;
const AUDIENCE_KEYS = ["scope", "departmentId", "roleIds", "userIds"] as const;

/**
 * Envia só os campos do contrato. Campo presente com `undefined` vai como
 * `null` (= limpar o campo opcional, como no modo demonstração); campo
 * ausente não é alterado.
 */
function pick(input: object, keys: readonly string[]): Record<string, unknown> {
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in source) out[key] = source[key] ?? null;
  return out;
}

function contentPayload(input: Partial<ContentInput>) {
  const payload = pick(input, CONTENT_KEYS);
  if (Array.isArray(input.links)) payload.links = input.links.map((l) => ({ label: l.label ?? "", url: l.url }));
  // Público: ausente = não alterar (na criação, o servidor usa "todos").
  if (input.access) payload.access = pick(input.access as Audience, AUDIENCE_KEYS);
  return payload;
}

/** Ids viram parte do caminho do documento: recusa barras e caracteres estranhos. */
function safeId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError("not_found", "Conteúdo não encontrado.");
  return id;
}

function normalize(c: ContentItem): ContentItem {
  return {
    ...c,
    channels: c.channels ?? [],
    links: c.links ?? [],
    files: c.files ?? [],
    access: c.access ?? { scope: "all", roleIds: [], userIds: [] },
    history: c.history ?? [],
  };
}

/** Mesmo comportamento do modo demonstração: módulo desativado não é consultado. */
async function requireModuleEnabled() {
  await whenAccess();
  let disabled = false;
  try {
    const snap = await getDoc(doc(firebase().db, "settings/system"));
    disabled = snap.exists() && (snap.data() as { modules?: Record<string, boolean> }).modules?.marketing === false;
  } catch (error) {
    throw mapFirestoreError(error);
  }
  if (disabled) throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
}

/**
 * Envios já concluídos por requisição: se a operação for repetida com o mesmo
 * identificador (falha de conexão), os arquivos não são enviados de novo.
 */
const uploadedByRequest = new Map<string, string[]>();

/* --------------------------------- serviço --------------------------------- */

export const firebaseMarketing: MarketingService = {
  async list() {
    const [, items] = await Promise.all([requireModuleEnabled(), listVisible<ContentItem>("contents", "marketing")]);
    return items.map(normalize);
  },

  async get(id) {
    const [, item] = await Promise.all([requireModuleEnabled(), getVisible<ContentItem>(`contents/${safeId(id)}`, "Conteúdo")]);
    return normalize(item);
  },

  async create(input) {
    const rid = takeRequestId();
    return normalize(await callApi<ContentItem>("marketing", "create", contentPayload(input), rid));
  },

  async update(id, input) {
    const rid = takeRequestId();
    return normalize(await callApi<ContentItem>("marketing", "update", { id: safeId(id), input: contentPayload(input) }, rid));
  },

  async setStatus(id, status) {
    const rid = takeRequestId();
    return normalize(await callApi<ContentItem>("marketing", "setStatus", { id: safeId(id), status }, rid));
  },

  async addFiles(id, files) {
    const rid = takeRequestId();
    const contentId = safeId(id);
    if (files.length === 0) throw new ServiceError("invalid", "Escolha pelo menos um arquivo.");
    if (files.length > MARKETING_MAX_FILES_PER_CALL) throw new ServiceError("invalid", `Envie no máximo ${MARKETING_MAX_FILES_PER_CALL} arquivos por vez.`);
    for (const file of files) {
      const problem = marketingFileProblem(file);
      if (problem) throw new ServiceError("invalid", problem);
    }
    const linkFiles = files.filter(isLinkFile);
    const links = await Promise.all(linkFiles.map(async (f) => ({ name: f.name, url: (await f.text()).trim() })));
    let uploadIds = uploadedByRequest.get(rid);
    if (!uploadIds) {
      uploadIds = [];
      for (const file of files.filter((f) => !isLinkFile(f))) {
        const type = marketingTypeOf(file)!;
        const blob = file.type === type ? file : new Blob([file], { type });
        uploadIds.push(await uploadFile("marketingFile", blob, { name: file.name, targetId: contentId }));
      }
      uploadedByRequest.set(rid, uploadIds);
    }
    try {
      const item = normalize(await callApi<ContentItem>("marketing", "addFiles", { id: contentId, uploadIds, links }, rid));
      uploadedByRequest.delete(rid);
      return item;
    } catch (error) {
      // Só uma falha de conexão é repetida com o mesmo identificador (ver useAction).
      if (!isRetriable(error)) uploadedByRequest.delete(rid);
      throw error;
    }
  },
};

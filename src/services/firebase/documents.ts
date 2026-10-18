/**
 * Documentos (Firebase).
 *
 * LEITURAS (Firestore, com regras de segurança):
 *  - documentos: `documents/{id}` filtrado por `readers` (ou tudo para quem
 *    tem documents.admin), com metadados e todas as versões;
 *  - categorias: `documentCategories` (qualquer conta ativa).
 *
 * ESCRITAS: função chamável `documentsApi` — o servidor confere permissões,
 * categoria, departamento, público e vínculos, recalcula quem pode ver o
 * documento (e, com isso, os arquivos no Storage), grava histórico, auditoria
 * e índice de busca. `takeRequestId()` é sempre a primeira linha.
 *
 * ARQUIVOS: `uploadFile("document", ...)` envia para a área temporária (com
 * progresso e cancelamento no indicador de envios) e devolve o `uploadId`; o
 * servidor confere o conteúdo real, calcula o SHA-256 e move o arquivo para
 * `documents/{id}/v{n}/`. O tipo e o tamanho também são conferidos aqui antes
 * do envio, só para avisar mais cedo — a conferência que vale é a do servidor.
 */
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import type { Audience, DocumentCategory, InstitutionalDocument } from "@/types";
import type { DocumentInput, DocumentService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { fromSnap, mapFirestoreError } from "./convert";
import { contentTypeOf, fileSource, isLinkFile } from "./files";
import { getVisible, listVisible } from "./queries";
import { useFirebaseSession, whenAccess } from "./session";
import { FILE_LIMIT_MB } from "@/lib/mode";

/* --------------------------- regras dos arquivos --------------------------- */

/** Limite de tamanho de um documento (o mesmo do servidor: functions/src/core/files.ts). */
export const DOCUMENT_MAX_BYTES = FILE_LIMIT_MB.document * 1024 * 1024;

/** Tipos aceitos para documentos (conferidos de novo pelo servidor, pelo conteúdo real). */
export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "text/plain",
  "text/csv",
] as const;

/** Valor do atributo `accept` do seletor de arquivos. */
export const DOCUMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.csv";

export const DOCUMENT_FORMATS_LABEL = "PDF, imagens (PNG, JPG, WEBP, GIF), Word/Excel/PowerPoint/ODF, TXT/CSV";

type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number];

const MIME_BY_EXTENSION: Record<string, DocumentMime> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  txt: "text/plain",
  csv: "text/csv",
};

function fileNameOf(file: File | Blob, name?: string) {
  return name ?? (typeof File !== "undefined" && file instanceof File ? file.name : "");
}

/**
 * Tipo com que o arquivo será enviado: o informado pelo navegador quando é
 * aceito; senão, o da extensão (ex.: CSV que o Windows informa como
 * "application/vnd.ms-excel"). O servidor confere o conteúdo real de qualquer forma.
 */
function documentTypeOf(file: File | Blob, name?: string): DocumentMime | null {
  const declared = contentTypeOf(file, fileNameOf(file, name));
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(declared)) return declared as DocumentMime;
  const ext = fileNameOf(file, name).split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? null;
}

/** Problema do arquivo escolhido (tipo ou tamanho), ou `null` quando pode ser enviado. */
export function documentFileProblem(file: File | Blob, name?: string): string | null {
  // Link (implantação gratuita): o servidor confere o endereço.
  if (isLinkFile(file)) return null;
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > DOCUMENT_MAX_BYTES) return `O arquivo é maior que ${FILE_LIMIT_MB.document} MB. Escolha um arquivo menor.`;
  if (!documentTypeOf(file, name)) return `Formato não aceito. Formatos aceitos: ${DOCUMENT_FORMATS_LABEL}.`;
  return null;
}

/** Confere tipo e tamanho e devolve o conteúdo com o tipo aceito, pronto para o envio. */
function acceptableFile(file: File | Blob, name?: string): { blob: Blob; name: string } {
  if (isLinkFile(file)) return { blob: file, name: fileNameOf(file, name) || "documento" };
  const problem = documentFileProblem(file, name);
  if (problem) throw new ServiceError("invalid", problem);
  const type = documentTypeOf(file, name)!;
  const fileName = fileNameOf(file, name) || "documento";
  return { blob: file.type === type ? file : new Blob([file], { type }), name: fileName };
}

/* -------------------------------- auxiliares ------------------------------- */

const AUDIENCE_KEYS = ["scope", "departmentId", "roleIds", "userIds"] as const;
const LINK_KEYS = ["eventId", "meetingId", "projectId"] as const;
const UPDATE_KEYS = ["name", "description", "categoryId", "departmentId", "status"] as const;

/** Ids viram parte do caminho do documento: recusa barras e caracteres estranhos. */
function safeId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError("not_found", "Documento não encontrado.");
  return id;
}

/** Só os campos do público; `undefined` vai como `null` (o servidor trata como "sem valor"). */
function audiencePayload(access: Audience) {
  const source = access as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of AUDIENCE_KEYS) if (key in source) out[key] = source[key] ?? null;
  return out;
}

/** Vínculos sem valores vazios (o servidor substitui todos os vínculos pelos enviados). */
function linksPayload(links: DocumentInput["links"]) {
  const out: Record<string, string> = {};
  for (const key of LINK_KEYS) if (links?.[key]) out[key] = links[key]!;
  return out;
}

function createPayload(input: DocumentInput) {
  return {
    name: input.name,
    description: input.description ?? "",
    categoryId: input.categoryId,
    departmentId: input.departmentId,
    status: input.status,
    access: audiencePayload(input.access),
    links: linksPayload(input.links),
  };
}

/** Edição: só os campos informados (campo ausente ou `undefined` = não alterar). */
function updatePayload(input: Partial<Omit<DocumentInput, "access">>) {
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of UPDATE_KEYS) if (source[key] !== undefined) out[key] = source[key];
  if (input.links !== undefined) out.links = linksPayload(input.links);
  return out;
}

function normalize(d: InstitutionalDocument): InstitutionalDocument {
  return {
    ...d,
    description: d.description ?? "",
    versions: d.versions ?? [],
    links: d.links ?? {},
    history: d.history ?? [],
    sample: !!d.sample,
  };
}

/** Mesmo comportamento do modo demonstração: módulo desativado não é consultado. */
async function requireModuleEnabled() {
  await whenAccess();
  let disabled = false;
  try {
    const snap = await getDoc(doc(firebase().db, "settings/system"));
    disabled = snap.exists() && (snap.data() as { modules?: Record<string, boolean> }).modules?.documents === false;
  } catch (error) {
    throw mapFirestoreError(error);
  }
  if (disabled) throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
}

/**
 * Id que o servidor dará ao documento novo (sha256 de `uid:requestId`, 20
 * caracteres — ver functions/src/modules/documents.ts). Usado só como
 * referência no tíquete de envio do arquivo.
 */
async function expectedDocumentId(requestId: string): Promise<string> {
  const uid = useFirebaseSession.getState().uid ?? firebase().auth.currentUser?.uid;
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!uid || !subtle) return "novo-documento";
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(`${uid}:${requestId}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
}

/* --------------------------------- serviço --------------------------------- */

export const firebaseDocuments: DocumentService = {
  async listCategories() {
    await whenAccess();
    try {
      const snap = await getDocs(collection(firebase().db, "documentCategories"));
      return snap.docs.map((d) => fromSnap<DocumentCategory>(d)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    } catch (error) {
      throw mapFirestoreError(error, "As categorias de documentos não estão disponíveis para o seu perfil.");
    }
  },

  async list() {
    const [, items] = await Promise.all([requireModuleEnabled(), listVisible<InstitutionalDocument>("documents", "documents")]);
    return items.map(normalize);
  },

  async get(id) {
    safeId(id);
    const [, d] = await Promise.all([requireModuleEnabled(), getVisible<InstitutionalDocument>(`documents/${id}`, "Documento")]);
    return normalize(d);
  },

  async create(input, file, fileName) {
    const rid = takeRequestId();
    const upload = file ? acceptableFile(file, fileName) : null;
    const source = upload ? await fileSource("document", upload.blob, { name: upload.name, targetId: await expectedDocumentId(rid) }) : {};
    return normalize(await callApi<InstitutionalDocument>("documents", "create", { input: createPayload(input), ...source }, rid));
  },

  async update(id, input) {
    const rid = takeRequestId();
    safeId(id);
    return normalize(await callApi<InstitutionalDocument>("documents", "update", { id, input: updatePayload(input) }, rid));
  },

  async setAccess(id, access) {
    const rid = takeRequestId();
    safeId(id);
    return normalize(await callApi<InstitutionalDocument>("documents", "setAccess", { id, access: audiencePayload(access) }, rid));
  },

  async addVersion(id, file, note) {
    const rid = takeRequestId();
    safeId(id);
    const upload = acceptableFile(file);
    const source = await fileSource("document", upload.blob, { name: upload.name, targetId: id });
    return normalize(await callApi<InstitutionalDocument>("documents", "addVersion", { id, ...source, note: note?.trim() || null }, rid));
  },

  async archive(id) {
    const rid = takeRequestId();
    safeId(id);
    return normalize(await callApi<InstitutionalDocument>("documents", "archive", { id }, rid));
  },

  async restore(id) {
    const rid = takeRequestId();
    safeId(id);
    return normalize(await callApi<InstitutionalDocument>("documents", "restore", { id }, rid));
  },
};

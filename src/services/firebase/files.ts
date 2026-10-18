/**
 * Envio e abertura de arquivos (Cloud Storage).
 *
 * Envio: tíquete no servidor → envio para a área temporária (com progresso e
 * cancelamento) → a operação do módulo recebe o `uploadId` e o servidor
 * confere o conteúdo e move o arquivo (ver functions/src/core/files.ts).
 *
 * Abertura: download autenticado pelo SDK (as regras do Storage conferem o
 * acesso ao registro). Nenhum link público é gerado; a URL criada é local ao
 * navegador e expira em seguida.
 *
 * Implantação gratuita com arquivos no banco (FILE_STORAGE=database): o envio
 * vai em pedaços pelo servidor (`system.uploadChunk`) e a abertura lê os
 * pedaços em `fileChunks/` (as regras do Firestore conferem o acesso).
 */
import { doc, getDoc, type Bytes } from "firebase/firestore";
import { getBlob, ref, uploadBytesResumable } from "firebase/storage";
import type { FileRef } from "@/types";
import { useUploads } from "@/stores/uploads";
import type { FileService } from "../contracts";
import { isLinkFile, isSafeLink } from "@/lib/file-links";
import { ServiceError } from "../errors";
import { FILE_STORAGE } from "@/lib/mode";
import { firebase } from "./app";
import { callApi } from "./call";

export type UploadPurpose = "document" | "saleReceipt" | "financeReceipt" | "marketingFile";

const MIME_BY_EXT: Record<string, string> = {
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
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** Extensão canônica de cada tipo aceito (a mesma que o servidor grava no nome). */
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "text/plain": "txt",
  "text/csv": "csv",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  [MIME_BY_EXT.docx]: "docx",
  [MIME_BY_EXT.xlsx]: "xlsx",
  [MIME_BY_EXT.pptx]: "pptx",
  [MIME_BY_EXT.odt]: "odt",
  [MIME_BY_EXT.ods]: "ods",
  [MIME_BY_EXT.odp]: "odp",
};

/**
 * Nome usado ao baixar: a extensão sempre corresponde ao tipo conferido pelo
 * servidor (protege também arquivos gravados antes dessa regra, ex.:
 * "ata.html" com conteúdo de texto é baixado como "ata.txt").
 */
export function downloadName(file: Pick<FileRef, "name" | "mimeType">) {
  const name = (file.name ?? "").trim().replace(/[. ]+$/, "");
  const ext = EXT_BY_MIME[file.mimeType];
  if (!ext) return name || "arquivo";
  // Extensão: até 8 letras/números com pelo menos uma letra ("Ata 15.10" não tem extensão).
  const found = name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  const current = found && /[A-Za-z]/.test(found) ? found.toLowerCase() : undefined;
  if (current === ext || (ext === "jpg" && current === "jpeg")) return name;
  const base = current ? name.slice(0, -(current.length + 1)).replace(/[. ]+$/, "") : name;
  return `${base || "arquivo"}.${ext}`;
}

/** Tipo usado na URL local: só tipos aceitos pelo servidor; qualquer outro é tratado como binário (nunca exibido como página). */
function blobType(file: FileRef, fallback: string) {
  const type = file.mimeType || fallback;
  return EXT_BY_MIME[type] ? type : "application/octet-stream";
}

export function contentTypeOf(file: File | Blob, name?: string) {
  if (file.type) return file.type;
  const ext = (name ?? (file instanceof File ? file.name : "")).split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/* ---------------------- arquivos como link (plano gratuito) ---------------------- */

export { isLinkFile, isSafeLink, LINK_MIME, makeLinkFile } from "@/lib/file-links";

export interface FileLinkInput {
  name: string;
  url: string;
}

/**
 * Origem do arquivo para uma operação: o link (plano gratuito) ou o `uploadId`
 * do envio ao Cloud Storage (plano Blaze).
 */
export async function fileSource(
  purpose: UploadPurpose,
  file: File | Blob,
  options: { name?: string; targetId?: string } = {},
): Promise<{ uploadId: string } | { link: FileLinkInput }> {
  if (isLinkFile(file)) {
    const name = options.name ?? (file instanceof File ? file.name : "arquivo");
    return { link: { name, url: (await file.text()).trim() } };
  }
  return { uploadId: await uploadFile(purpose, file, options) };
}

/**
 * Envia um arquivo e devolve o `uploadId` para a operação que vai anexá-lo.
 * O progresso aparece no indicador de envios; o envio pode ser cancelado.
 */
export async function uploadFile(purpose: UploadPurpose, file: File | Blob, options: { name?: string; targetId?: string } = {}): Promise<string> {
  const name = options.name ?? (file instanceof File ? file.name : "arquivo");
  const contentType = contentTypeOf(file, name);
  const ticket = await callApi<{ uploadId: string; path: string; fileName: string; chunkBytes?: number }>("system", "prepareUpload", {
    purpose,
    fileName: name,
    size: file.size,
    contentType,
    ...(options.targetId ? { targetId: options.targetId } : {}),
  });
  if (FILE_STORAGE === "database") return uploadInChunks(ticket.uploadId, ticket.chunkBytes ?? 512 * 1024, file, name);
  const { storage } = firebase();
  const task = uploadBytesResumable(ref(storage, ticket.path), file, { contentType });
  const store = useUploads.getState();
  const item = { id: ticket.uploadId, name, progress: 0, state: "uploading" as const, cancel: () => task.cancel() };
  store.upsert(item);
  try {
    await new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        (snap) => store.upsert({ ...item, progress: snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0 }),
        reject,
        () => resolve(),
      );
    });
    store.upsert({ ...item, progress: 1, state: "done", cancel: undefined });
    setTimeout(() => useUploads.getState().remove(item.id), 2500);
    return ticket.uploadId;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const cancelled = code === "storage/canceled";
    store.upsert({ ...item, state: cancelled ? "cancelled" : "error", cancel: undefined });
    setTimeout(() => useUploads.getState().remove(item.id), 4000);
    if (cancelled) throw new ServiceError("invalid", "Envio cancelado. Nada foi salvo.");
    if (code === "storage/unauthorized") throw new ServiceError("forbidden", "O envio foi recusado (arquivo diferente do informado ou tíquete expirado). Tente novamente.");
    throw new ServiceError("unavailable", "O envio do arquivo falhou. Verifique a conexão e tente novamente. Nada foi salvo.");
  }
}

/* ------------------- arquivos no próprio banco (plano gratuito) ------------------- */

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Envia o arquivo em pedaços pelo servidor, com progresso, cancelamento e uma nova tentativa por pedaço. */
async function uploadInChunks(uploadId: string, chunkBytes: number, file: File | Blob, name: string): Promise<string> {
  const total = Math.max(1, Math.ceil(file.size / chunkBytes));
  let cancelled = false;
  const store = useUploads.getState();
  const item = { id: uploadId, name, progress: 0, state: "uploading" as const, cancel: () => (cancelled = true) };
  store.upsert(item);
  try {
    for (let index = 0; index < total; index++) {
      if (cancelled) throw new ServiceError("invalid", "Envio cancelado. Nada foi salvo.");
      const data = toBase64(new Uint8Array(await file.slice(index * chunkBytes, (index + 1) * chunkBytes).arrayBuffer()));
      try {
        await callApi("system", "uploadChunk", { uploadId, index, data });
      } catch (error) {
        if ((error as { code?: string })?.code !== "unavailable") throw error;
        await callApi("system", "uploadChunk", { uploadId, index, data });
      }
      store.upsert({ ...item, progress: (index + 1) / total });
    }
    store.upsert({ ...item, progress: 1, state: "done", cancel: undefined });
    setTimeout(() => useUploads.getState().remove(item.id), 2500);
    return uploadId;
  } catch (error) {
    store.upsert({ ...item, state: cancelled ? "cancelled" : "error", cancel: undefined });
    setTimeout(() => useUploads.getState().remove(item.id), 4000);
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("unavailable", "O envio do arquivo falhou. Verifique a conexão e tente novamente. Nada foi salvo.");
  }
}

/** O uploadId é o começo do nome no caminho: `{destino}/{uploadId}-{nome}`. */
function uploadIdOf(file: FileRef) {
  return file.path?.split("/").pop()?.match(/^([a-f0-9]{32})-/)?.[1] ?? null;
}

/** Remonta o arquivo a partir dos pedaços (as regras do Firestore conferem o acesso a cada um). */
async function loadFromDatabase(file: FileRef): Promise<Blob> {
  const uploadId = uploadIdOf(file);
  if (!uploadId || !file.chunks) throw new ServiceError("not_found", "O arquivo não foi encontrado no armazenamento.");
  const { db } = firebase();
  const parts: Uint8Array[] = [];
  try {
    // De 4 em 4 pedaços: rápido sem abrir dezenas de leituras ao mesmo tempo.
    for (let start = 0; start < file.chunks; start += 4) {
      const ids = Array.from({ length: Math.min(4, file.chunks - start) }, (_, i) => `${uploadId}_${start + i}`);
      const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, "fileChunks", id))));
      for (const snap of snaps) {
        if (!snap.exists()) throw new ServiceError("not_found", "O arquivo não foi encontrado no armazenamento.");
        parts.push((snap.get("data") as Bytes).toUint8Array());
      }
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if ((error as { code?: string })?.code === "permission-denied") throw new ServiceError("forbidden", "Seu perfil não tem acesso a este arquivo.");
    throw new ServiceError("unavailable", "Não foi possível carregar o arquivo agora. Tente novamente.");
  }
  return new Blob(parts as BlobPart[], { type: blobType(file, "application/octet-stream") });
}

/** Conteúdo do arquivo, venha do banco (pedaços) ou do Cloud Storage. */
async function loadBlob(file: FileRef): Promise<Blob> {
  if (file.chunks) return loadFromDatabase(file);
  const blob = await getBlob(ref(firebase().storage, file.path!));
  return new Blob([blob], { type: blobType(file, blob.type) });
}

export const firebaseFiles: FileService = {
  getObjectUrl() {
    return null;
  },

  isAvailable(file) {
    return !!(file?.path || file?.url);
  },

  async loadObjectUrl(file) {
    // Link externo: não há como pré-visualizar aqui (o acesso é controlado pelo serviço do link).
    if (file.url) throw new ServiceError("unavailable", "Este arquivo é um link externo: abra-o pelo botão.");
    if (!file.path) throw new ServiceError("unavailable", "Este registro não tem arquivo anexado.");
    try {
      return URL.createObjectURL(await loadBlob(file));
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const code = (error as { code?: string })?.code;
      if (code === "storage/unauthorized") throw new ServiceError("forbidden", "Seu perfil não tem acesso a este arquivo.");
      throw new ServiceError("unavailable", "Não foi possível carregar o arquivo agora.");
    }
  },

  async open(file: FileRef, options) {
    if (file.url) {
      // Link externo (implantação gratuita): abre em nova aba; o serviço do link controla o acesso.
      if (!isSafeLink(file.url)) throw new ServiceError("invalid", "O link deste arquivo não é válido.");
      window.open(file.url, "_blank", "noopener,noreferrer");
      void options;
      return;
    }
    if (!file.path) throw new ServiceError("unavailable", "Este registro não tem arquivo anexado.");
    // Abre a janela ainda dentro do clique (evita bloqueio de pop-up) e a preenche depois do download.
    const win = !options?.download && typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const url = URL.createObjectURL(await loadBlob(file));
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = downloadName(file);
        a.rel = "noopener";
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      win?.close();
      if (error instanceof ServiceError) throw error;
      const code = (error as { code?: string })?.code;
      if (code === "storage/unauthorized") throw new ServiceError("forbidden", "Seu perfil não tem acesso a este arquivo.");
      if (code === "storage/object-not-found") throw new ServiceError("not_found", "O arquivo não foi encontrado no armazenamento.");
      throw new ServiceError("unavailable", "Não foi possível baixar o arquivo agora. Tente novamente.");
    }
  },
};

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
 */
import { getBlob, ref, uploadBytesResumable } from "firebase/storage";
import type { FileRef } from "@/types";
import { useUploads } from "@/stores/uploads";
import type { FileService } from "../contracts";
import { ServiceError } from "../errors";
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

export function contentTypeOf(file: File | Blob, name?: string) {
  if (file.type) return file.type;
  const ext = (name ?? (file instanceof File ? file.name : "")).split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Envia um arquivo e devolve o `uploadId` para a operação que vai anexá-lo.
 * O progresso aparece no indicador de envios; o envio pode ser cancelado.
 */
export async function uploadFile(purpose: UploadPurpose, file: File | Blob, options: { name?: string; targetId?: string } = {}): Promise<string> {
  const name = options.name ?? (file instanceof File ? file.name : "arquivo");
  const contentType = contentTypeOf(file, name);
  const ticket = await callApi<{ uploadId: string; path: string; fileName: string }>("system", "prepareUpload", {
    purpose,
    fileName: name,
    size: file.size,
    contentType,
    ...(options.targetId ? { targetId: options.targetId } : {}),
  });
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

export const firebaseFiles: FileService = {
  getObjectUrl() {
    return null;
  },

  isAvailable(file) {
    return !!file?.path;
  },

  async loadObjectUrl(file) {
    if (!file.path) throw new ServiceError("unavailable", "Este registro não tem arquivo anexado.");
    try {
      const blob = await getBlob(ref(firebase().storage, file.path));
      return URL.createObjectURL(new Blob([blob], { type: file.mimeType || blob.type }));
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "storage/unauthorized") throw new ServiceError("forbidden", "Seu perfil não tem acesso a este arquivo.");
      throw new ServiceError("unavailable", "Não foi possível carregar o arquivo agora.");
    }
  },

  async open(file: FileRef, options) {
    if (!file.path) throw new ServiceError("unavailable", "Este registro não tem arquivo anexado.");
    // Abre a janela ainda dentro do clique (evita bloqueio de pop-up) e a preenche depois do download.
    const win = !options?.download && typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const blob = await getBlob(ref(firebase().storage, file.path));
      const url = URL.createObjectURL(new Blob([blob], { type: file.mimeType || blob.type }));
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.rel = "noopener";
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      win?.close();
      const code = (error as { code?: string })?.code;
      if (code === "storage/unauthorized") throw new ServiceError("forbidden", "Seu perfil não tem acesso a este arquivo.");
      if (code === "storage/object-not-found") throw new ServiceError("not_found", "O arquivo não foi encontrado no armazenamento.");
      throw new ServiceError("unavailable", "Não foi possível baixar o arquivo agora. Tente novamente.");
    }
  },
};

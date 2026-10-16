/**
 * Arquivos escolhidos na demonstração ficam apenas na memória desta aba.
 * Ao recarregar a página, os metadados permanecem, mas o conteúdo do arquivo
 * não. Na Etapa 2, os arquivos irão para o Firebase Storage.
 */
import type { FileRef } from "@/types";
import { newId } from "@/lib/utils";
import { ServiceError } from "../errors";

const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();

export function storeFile(file: File | Blob, name?: string): FileRef {
  const blobId = newId("blob");
  blobs.set(blobId, file);
  const fileName = name ?? (file instanceof File ? file.name : "arquivo");
  return { name: fileName, size: file.size, mimeType: file.type || "application/octet-stream", blobId };
}

export function getObjectUrl(blobId?: string) {
  if (!blobId) return null;
  const blob = blobs.get(blobId);
  if (!blob) return null;
  let url = urls.get(blobId);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(blobId, url);
  }
  return url;
}

export function hasBlob(blobId?: string) {
  return !!blobId && blobs.has(blobId);
}

export function isAvailable(file: FileRef | null | undefined) {
  return !!file?.blobId && blobs.has(file.blobId);
}

/** Abre o arquivo escolhido nesta sessão (demonstração). */
export async function openFile(file: FileRef, options?: { download?: boolean }) {
  const url = getObjectUrl(file.blobId);
  if (!url) throw new ServiceError("unavailable", "O arquivo só fica disponível na sessão em que foi escolhido (demonstração).");
  const a = document.createElement("a");
  a.href = url;
  if (options?.download) a.download = file.name;
  else a.target = "_blank";
  a.rel = "noopener";
  a.click();
}

/** Demonstração: a URL já existe enquanto o arquivo estiver na memória desta aba. */
export async function loadObjectUrl(file: FileRef) {
  const url = getObjectUrl(file.blobId);
  if (!url) throw new ServiceError("unavailable", "O arquivo só fica disponível na sessão em que foi escolhido (demonstração).");
  return url;
}

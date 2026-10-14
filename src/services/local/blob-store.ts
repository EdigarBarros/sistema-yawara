/**
 * Arquivos escolhidos na demonstração ficam apenas na memória desta aba.
 * Ao recarregar a página, os metadados permanecem, mas o conteúdo do arquivo
 * não. Na Etapa 2, os arquivos irão para o Firebase Storage.
 */
import type { FileRef } from "@/types";
import { newId } from "@/lib/utils";

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

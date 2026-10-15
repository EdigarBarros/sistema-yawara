/**
 * ENVIO E ARMAZENAMENTO DE ARQUIVOS (Cloud Storage)
 * ---------------------------------------------------------------------------
 * Fluxo em três passos, sem confiar no tipo declarado pelo navegador:
 *
 *  1. `systemApi.prepareUpload` cria um tíquete (`uploads/{id}`) com dono,
 *     finalidade, nome, tamanho exato, tipo declarado e validade de 1 hora.
 *  2. O navegador envia o arquivo para `staging/{uid}/{id}/{nome}`. As regras
 *     do Storage só aceitam o envio que corresponde ao tíquete.
 *  3. A operação do módulo (ex.: criar documento) chama `finalizeUpload` na
 *     etapa de preparação: o servidor confere a existência e o tamanho do
 *     objeto, lê a assinatura binária do conteúdo (não a extensão), calcula o
 *     SHA-256, copia para o caminho definitivo SEM token de download público e
 *     apaga a cópia temporária. Os metadados só são gravados no Firestore se a
 *     transação da operação for confirmada; se ela falhar, o arquivo definitivo
 *     é apagado (compensação).
 *
 * Envios abandonados e arquivos órfãos são removidos pela rotina diária
 * `cleanupUploads` (ver modules/maintenance.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import type { FileRef } from "@/types";
import type { Actor } from "./actor";
import { bucket, db, nowISO, Timestamp, timestampInDays } from "./admin";
import type { PrepareContext } from "./dispatch";
import { fail } from "./errors";

export type FileKind = "pdf" | "image" | "office" | "text" | "video";

export type UploadPurpose = "document" | "saleReceipt" | "financeReceipt" | "marketingFile";

const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<UploadPurpose, { label: string; maxBytes: number; kinds: FileKind[] }> = {
  document: { label: "documento", maxBytes: 25 * MB, kinds: ["pdf", "image", "office", "text"] },
  saleReceipt: { label: "comprovante", maxBytes: 10 * MB, kinds: ["pdf", "image"] },
  financeReceipt: { label: "comprovante", maxBytes: 15 * MB, kinds: ["pdf", "image"] },
  marketingFile: { label: "arquivo de marketing", maxBytes: 50 * MB, kinds: ["pdf", "image", "video", "office"] },
};

export const MIME_BY_KIND: Record<FileKind, string[]> = {
  pdf: ["application/pdf"],
  image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  office: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
  ],
  text: ["text/plain", "text/csv"],
  video: ["video/mp4", "video/quicktime"],
};

export function kindOfMime(mime: string): FileKind | null {
  for (const [kind, list] of Object.entries(MIME_BY_KIND) as [FileKind, string[]][]) if (list.includes(mime)) return kind;
  return null;
}

/** Nome seguro para o Storage: sem barras, caracteres de controle ou curingas; até 120 caracteres. */
export function safeFileName(name: string) {
  const clean = name
    .normalize("NFC")
    .replace(/[\\/#?[\]*\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const trimmed = clean.length > 120 ? clean.slice(0, 80) + "…" + clean.slice(-39) : clean;
  return trimmed || "arquivo";
}

/**
 * Identifica o tipo real pelo conteúdo (assinatura binária).
 * Retorna o MIME canônico ou null quando o conteúdo não é reconhecido.
 */
export function sniffMime(head: Buffer, declared: string): string | null {
  const ascii = (start: number, len: number) => head.subarray(start, start + len).toString("latin1");
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  // Documentos Office/ODF são pacotes ZIP: aceita o tipo declarado se for de escritório.
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return MIME_BY_KIND.office.includes(declared) ? declared : null;
  }
  // Texto: sem bytes nulos e UTF-8 válido.
  if ((declared === "text/plain" || declared === "text/csv") && !head.includes(0)) {
    try {
      // Trecho parcial: um caractere acentuado partido no fim do trecho não é erro.
      const partial = head.length >= 4096;
      new TextDecoder("utf-8", { fatal: true }).decode(partial ? head.subarray(0, 4000) : head, { stream: partial });
      return declared;
    } catch {
      return null;
    }
  }
  return null;
}

export interface TicketInput {
  purpose: UploadPurpose;
  fileName: string;
  size: number;
  contentType: string;
  /** Registro ao qual o arquivo será anexado (quando já existe). */
  targetId?: string;
}

/** Cria o tíquete de envio. A permissão específica é conferida de novo ao anexar. */
export async function createUploadTicket(actor: Actor, input: TicketInput) {
  const rule = UPLOAD_RULES[input.purpose];
  const kind = kindOfMime(input.contentType);
  if (!kind || !rule.kinds.includes(kind)) {
    fail("invalid", `Tipo de arquivo não aceito para ${rule.label}. Formatos aceitos: ${acceptedLabel(input.purpose)}.`);
  }
  if (!Number.isInteger(input.size) || input.size <= 0) fail("invalid", "O arquivo está vazio.");
  if (input.size > rule.maxBytes) fail("invalid", `O arquivo é maior que ${Math.round(rule.maxBytes / MB)} MB.`);
  const id = randomUUID().replace(/-/g, "");
  const fileName = safeFileName(input.fileName);
  const path = `staging/${actor.uid}/${id}/${fileName}`;
  await db.doc(`uploads/${id}`).create({
    uid: actor.uid,
    purpose: input.purpose,
    targetId: input.targetId ?? null,
    fileName,
    size: input.size,
    contentType: input.contentType,
    maxBytes: rule.maxBytes,
    path,
    status: "pending",
    createdAt: nowISO(),
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    expireAt: timestampInDays(7),
  });
  return { uploadId: id, path, fileName };
}

export function acceptedLabel(purpose: UploadPurpose) {
  const names: Record<FileKind, string> = { pdf: "PDF", image: "imagens (PNG, JPG, WEBP, GIF)", office: "Word/Excel/PowerPoint/ODF", text: "TXT/CSV", video: "vídeos MP4/MOV" };
  return UPLOAD_RULES[purpose].kinds.map((k) => names[k]).join(", ");
}

async function sha256Of(file: ReturnType<ReturnType<typeof bucket>["file"]>) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    file.createReadStream().on("data", (chunk) => hash.update(chunk)).on("end", () => resolve()).on("error", reject);
  });
  return hash.digest("hex");
}

/**
 * Confere e move um arquivo enviado para o caminho definitivo `destDir`.
 * Use na etapa `prepare` de uma mutação. Idempotente: repetir a mesma
 * requisição devolve o mesmo arquivo, sem copiar de novo.
 */
export async function finalizeUpload(actor: Actor, uploadId: string, purpose: UploadPurpose, destDir: string, ctx: PrepareContext): Promise<FileRef> {
  if (!/^[a-f0-9]{32}$/.test(uploadId)) fail("invalid", "Envio de arquivo inválido.");
  const ticketRef = db.doc(`uploads/${uploadId}`);
  const snap = await ticketRef.get();
  if (!snap.exists) fail("invalid", "O envio do arquivo expirou ou não foi encontrado. Envie o arquivo novamente.");
  const ticket = snap.data()!;
  if (ticket.uid !== actor.uid || ticket.purpose !== purpose) fail("forbidden", "Este envio de arquivo pertence a outra operação.");

  if ((ticket.status === "finalized" || ticket.status === "attached") && ticket.destDir === destDir && ticket.file) {
    return ticket.file as FileRef;
  }
  if (ticket.status !== "pending") fail("conflict", "Este arquivo já foi usado em outra operação. Envie-o novamente.");

  const staged = bucket().file(ticket.path);
  const [exists] = await staged.exists();
  if (!exists) fail("invalid", "O envio do arquivo não foi concluído. Envie o arquivo novamente.");
  const [meta] = await staged.getMetadata();
  const size = Number(meta.size);
  if (size !== ticket.size || size > ticket.maxBytes) fail("invalid", "O arquivo recebido não corresponde ao arquivo informado. Envie novamente.");

  const [head] = await staged.download({ start: 0, end: 4095 });
  const detected = sniffMime(head, ticket.contentType);
  const allowed = UPLOAD_RULES[purpose as UploadPurpose].kinds;
  const detectedKind = detected ? kindOfMime(detected) : null;
  if (!detected || !detectedKind || !allowed.includes(detectedKind) || kindOfMime(ticket.contentType) !== detectedKind) {
    await staged.delete({ ignoreNotFound: true });
    await ticketRef.update({ status: "rejected", rejectedAt: nowISO() });
    fail("invalid", `O conteúdo do arquivo não corresponde a um formato aceito (${acceptedLabel(purpose as UploadPurpose)}).`);
  }

  const sha256 = await sha256Of(staged);
  const destPath = `${destDir}/${uploadId}-${ticket.fileName}`;
  const dest = bucket().file(destPath);
  await staged.copy(dest, { contentType: detected, metadata: { uploadedBy: actor.uid, sha256, uploadId } } as never);
  // Remove qualquer token de download público herdado do envio pelo navegador.
  await dest.setMetadata({ contentType: detected, metadata: { firebaseStorageDownloadTokens: null, uploadedBy: actor.uid, sha256, uploadId } });
  await staged.delete({ ignoreNotFound: true });

  const file: FileRef = { name: ticket.fileName, size, mimeType: detected, path: destPath, sha256 };
  await ticketRef.update({ status: "finalized", destDir, file, finalizedAt: nowISO() });
  ctx.onAbort(async () => {
    await dest.delete({ ignoreNotFound: true });
    await ticketRef.update({ status: "discarded", discardedAt: nowISO() });
  });
  return file;
}

/** Marca o tíquete como anexado (na fase de escrita da transação da operação). */
export function markAttached(tx: Transaction, uploadId: string, resource: string) {
  tx.update(db.doc(`uploads/${uploadId}`), { status: "attached", attachedTo: resource, attachedAt: nowISO() });
}

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
 *     etapa de preparação: o servidor reserva o tíquete numa transação
 *     (`pending` → `finalizing`; um envio nunca é usado por duas operações),
 *     confere a existência e o tamanho do objeto, lê a assinatura binária do
 *     conteúdo (não a extensão), calcula o SHA-256, copia para o caminho
 *     definitivo SEM token de download público e apaga a cópia temporária.
 *     O nome guardado recebe a extensão do tipo REAL (ex.: "ata.html" com
 *     conteúdo de texto vira "ata.txt"). Os metadados só são gravados no
 *     Firestore se a transação da operação for confirmada; se ela (ou a própria
 *     preparação) falhar, o arquivo definitivo é apagado (compensação).
 *
 * Envios abandonados e arquivos órfãos são removidos pela rotina diária
 * `cleanupUploads` (ver modules/maintenance.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import { FieldValue, type DocumentData, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import type { FileRef } from "@/types";
import type { Actor } from "./actor";
import { bucket, db, nowISO, Timestamp, timestampInDays } from "./admin";
import type { PrepareContext } from "./dispatch";
import { fail } from "./errors";

type StorageFile = ReturnType<ReturnType<typeof bucket>["file"]>;

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

/** Extensão canônica de cada tipo aceito: o nome guardado sempre termina com a extensão do tipo REAL. */
export const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "text/plain": "txt",
  "text/csv": "csv",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
};

export function kindOfMime(mime: string): FileKind | null {
  for (const [kind, list] of Object.entries(MIME_BY_KIND) as [FileKind, string[]][]) if (list.includes(mime)) return kind;
  return null;
}

/** Limita o texto a `max` caracteres sem partir caracteres compostos por dois códigos (ex.: emoji). */
function clip(text: string, max: number) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/**
 * Nome seguro para o Storage: sem barras, caracteres de controle, de direção
 * de texto (que disfarçam a extensão) ou curingas; até 120 caracteres.
 */
export function safeFileName(name: string) {
  const clean = name
    .normalize("NFC")
    .replace(/[\\/#?[\]*\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(clean);
  const trimmed = chars.length > 120 ? chars.slice(0, 80).join("") + "…" + chars.slice(-39).join("") : clean;
  return trimmed || "arquivo";
}

/** Extensão no fim do nome: até 8 letras/números, com pelo menos uma letra ("Ata 15.10" não tem extensão). */
const EXTENSION_PATTERN = /\.([A-Za-z0-9]{1,8})$/;

function withoutTrailingDots(name: string) {
  return name.trim().replace(/[. ]+$/, "");
}

/** Extensão informada no nome (minúsculas), ignorando pontos e espaços finais; "" quando não há. */
export function extensionOf(fileName: string) {
  const ext = withoutTrailingDots(fileName).match(EXTENSION_PATTERN)?.[1] ?? "";
  return /[A-Za-z]/.test(ext) ? ext.toLowerCase() : "";
}

/**
 * Nome guardado e exibido: o nome enviado SEM a extensão informada, seguido da
 * extensão do tipo detectado pelo conteúdo (ex.: "Ata.html" com conteúdo de
 * texto vira "Ata.txt"). Determinístico: repetir a mesma requisição gera o
 * mesmo nome e o mesmo caminho.
 */
export function storedFileName(fileName: string, mime: string) {
  const ext = EXTENSION_BY_MIME[mime];
  if (!ext) fail("invalid", "Tipo de arquivo não aceito.");
  const name = withoutTrailingDots(safeFileName(fileName));
  const given = extensionOf(name);
  const base = withoutTrailingDots(given ? name.slice(0, -(given.length + 1)) : name);
  return `${clip(base, 100).trim() || "arquivo"}.${ext}`;
}

/**
 * Pacotes Office/ODF são ZIP: o conteúdo não diz se é Word, Excel ou
 * PowerPoint. Exige que a extensão do nome corresponda ao tipo declarado.
 */
export function officeNameMatches(fileName: string, mime: string) {
  return kindOfMime(mime) !== "office" || extensionOf(fileName) === EXTENSION_BY_MIME[mime];
}

/** Content-Disposition do objeto definitivo: sempre como anexo (download), nunca exibido como página. */
export function attachmentDisposition(name: string) {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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

const OFFICE_NAME_MISMATCH = "A extensão do arquivo não corresponde ao tipo do documento. Envie o arquivo original, sem renomear.";

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
  const fileName = safeFileName(input.fileName);
  if (!officeNameMatches(fileName, input.contentType)) fail("invalid", OFFICE_NAME_MISMATCH);
  const id = randomUUID().replace(/-/g, "");
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

async function sha256Of(file: StorageFile) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    file.createReadStream().on("data", (chunk) => hash.update(chunk)).on("end", () => resolve()).on("error", reject);
  });
  return hash.digest("hex");
}

/** Tolerância depois da validade do tíquete para concluir o anexo (envios grandes e lentos). */
export const FINALIZE_GRACE_MS = 30 * 60 * 1000;

const USED_ELSEWHERE = "Este arquivo já foi usado em outra operação. Envie-o novamente.";
const IN_PROGRESS = "Este arquivo já está sendo anexado em outra operação. Aguarde e confira o registro antes de enviar de novo.";
const EXPIRED = "O envio expirou. Envie o arquivo novamente.";

/** Tíquete vencido (validade + tolerância). Sem validade legível conta como vencido. */
export function ticketExpired(ticket: DocumentData, now = Date.now()) {
  const expires = (ticket.expiresAt as Timestamp | undefined)?.toMillis?.();
  return typeof expires !== "number" || expires + FINALIZE_GRACE_MS < now;
}

/**
 * Compensação: libera o tíquete reservado por esta operação e, só então, apaga
 * o arquivo definitivo. A cópia temporária só é apagada depois da confirmação;
 * enquanto ela existir, o tíquete volta a "pending" e a mesma operação pode ser
 * repetida (ex.: falha momentânea do Storage). Sem a cópia, o tíquete é
 * descartado. Um tíquete já anexado (ou recusado) não é tocado.
 */
async function discardClaim(ticketRef: DocumentReference, destDir: string, dest: StorageFile | null, staged: StorageFile) {
  const [stagedExists] = await staged.exists().catch(() => [false] as [boolean]);
  const released = await db.runTransaction(async (tx) => {
    const ticket = (await tx.get(ticketRef)).data();
    if (!ticket || ticket.destDir !== destDir || (ticket.status !== "finalizing" && ticket.status !== "finalized")) return false;
    tx.update(
      ticketRef,
      stagedExists
        ? { status: "pending", destDir: FieldValue.delete(), file: FieldValue.delete(), claimedAt: FieldValue.delete(), claimRequestId: FieldValue.delete(), finalizedAt: FieldValue.delete(), releasedAt: nowISO() }
        : { status: "discarded", discardedAt: nowISO() },
    );
    return true;
  });
  if (released && dest) await dest.delete({ ignoreNotFound: true });
}

/**
 * Confere e move um arquivo enviado para o caminho definitivo `destDir`.
 * Use na etapa `prepare` de uma mutação. Idempotente: repetir a mesma
 * requisição devolve o mesmo arquivo, sem copiar de novo.
 */
export async function finalizeUpload(actor: Actor, uploadId: string, purpose: UploadPurpose, destDir: string, ctx: PrepareContext): Promise<FileRef> {
  if (!/^[a-f0-9]{32}$/.test(uploadId)) fail("invalid", "Envio de arquivo inválido.");
  const ticketRef = db.doc(`uploads/${uploadId}`);

  // 1) Reserva o tíquete numa transação, ANTES de qualquer trabalho no Storage:
  //    duas operações simultâneas nunca usam o mesmo envio.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ticketRef);
    if (!snap.exists) fail("invalid", "O envio do arquivo expirou ou não foi encontrado. Envie o arquivo novamente.");
    const ticket = snap.data()!;
    if (ticket.uid !== actor.uid || ticket.purpose !== purpose) fail("forbidden", "Este envio de arquivo pertence a outra operação.");
    // Arquivo já anexado neste mesmo destino: devolve-o sem copiar de novo (a
    // operação ignora o arquivo repetido). Arquivo só conferido ("finalized"):
    // apenas a requisição que o reservou o reaproveita — outra requisição para o
    // mesmo destino não pega o arquivo de quem ainda pode desistir e apagá-lo.
    const sameRequest = !ticket.claimRequestId || ticket.claimRequestId === ctx.requestId;
    const sameDest = ticket.destDir === destDir && !!ticket.file;
    if (ticket.status === "attached" && sameDest) return { ticket, file: ticket.file as FileRef };
    if (ticket.status === "finalized" && sameDest && sameRequest) {
      // Depois do prazo, a limpeza diária pode descartar o arquivo: não é mais reaproveitado.
      if (ticketExpired(ticket)) fail("invalid", EXPIRED);
      return { ticket, file: ticket.file as FileRef };
    }
    if (ticket.status === "finalizing" || ticket.status === "finalized") fail("conflict", IN_PROGRESS);
    if (ticket.status !== "pending") fail("conflict", USED_ELSEWHERE);
    if (ticketExpired(ticket)) fail("invalid", EXPIRED);
    tx.update(ticketRef, { status: "finalizing", destDir, claimedAt: nowISO(), claimRequestId: ctx.requestId });
    return { ticket, file: null };
  });
  if (claim.file) return claim.file;
  const ticket = claim.ticket;

  // 2) Compensação registrada ANTES de copiar: se a operação falhar (inclusive
  //    na própria preparação), o tíquete é descartado e o arquivo definitivo apagado.
  let dest: StorageFile | null = null;
  const staged = bucket().file(ticket.path);
  ctx.onAbort(() => discardClaim(ticketRef, destDir, dest, staged));

  const [exists] = await staged.exists();
  if (!exists) fail("invalid", "O envio do arquivo não foi concluído. Envie o arquivo novamente.");
  const [meta] = await staged.getMetadata();
  const size = Number(meta.size);
  if (size !== ticket.size || size > ticket.maxBytes) fail("invalid", "O arquivo recebido não corresponde ao arquivo informado. Envie novamente.");

  const [head] = await staged.download({ start: 0, end: 4095 });
  const detected = sniffMime(head, ticket.contentType);
  const allowed = UPLOAD_RULES[purpose as UploadPurpose].kinds;
  const detectedKind = detected ? kindOfMime(detected) : null;
  if (
    !detected ||
    !detectedKind ||
    !allowed.includes(detectedKind) ||
    kindOfMime(ticket.contentType) !== detectedKind ||
    !officeNameMatches(ticket.fileName, detected)
  ) {
    await staged.delete({ ignoreNotFound: true });
    await ticketRef.update({ status: "rejected", rejectedAt: nowISO() });
    fail("invalid", `O conteúdo do arquivo não corresponde a um formato aceito (${acceptedLabel(purpose as UploadPurpose)}).`);
  }

  // 3) Nome com a extensão do tipo REAL (o nome enviado nunca define como o arquivo é aberto).
  const name = storedFileName(ticket.fileName, detected);
  const destPath = `${destDir}/${uploadId}-${name}`;
  dest = bucket().file(destPath);
  const sha256 = await sha256Of(staged);
  const contentDisposition = attachmentDisposition(name);
  await staged.copy(dest, { contentType: detected, contentDisposition, metadata: { uploadedBy: actor.uid, sha256, uploadId } });
  // Remove qualquer token de download público herdado do envio pelo navegador.
  await dest.setMetadata({ contentType: detected, contentDisposition, metadata: { firebaseStorageDownloadTokens: null, uploadedBy: actor.uid, sha256, uploadId } });
  // A cópia temporária só sai depois da confirmação (permite repetir a operação se ela falhar).
  ctx.afterCommit(async () => {
    await staged.delete({ ignoreNotFound: true });
  });

  const file: FileRef = { name, size, mimeType: detected, path: destPath, sha256 };
  await ticketRef.update({ status: "finalized", file, finalizedAt: nowISO() });
  return file;
}

/** Marca o tíquete como anexado (na fase de escrita da transação da operação). */
export function markAttached(tx: Transaction, uploadId: string, resource: string) {
  tx.update(db.doc(`uploads/${uploadId}`), { status: "attached", attachedTo: resource, attachedAt: nowISO() });
}

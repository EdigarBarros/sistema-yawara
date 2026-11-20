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
 *
 * Implantação gratuita com arquivos no banco (`FILE_STORAGE=database`): o
 * mesmo tíquete e a mesma conferência, mas o navegador envia o arquivo em
 * pedaços pelo servidor (`systemApi.uploadChunk`) e cada pedaço fica em
 * `fileChunks/{uploadId}_{n}` no Firestore. Ver o fim deste arquivo.
 */
import { createHash, randomUUID } from "node:crypto";
import { FieldValue, type DocumentData, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import type { Actor } from "./actor";
import { bucket, db, nowISO, Timestamp, timestampInDays } from "./admin";
import type { PrepareContext } from "./dispatch";
import { z } from "zod";
import { fail } from "./errors";
import { cancelDriveUpload, deleteDriveFile, driveFileInfo, putDriveChunk, readDriveRange, renameDriveFile, startDriveUpload } from "./drive";
import { intersects } from "@/lib/access-tokens";
import type { FileRef, Permission } from "@/types";

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

/** Regra de envio da instalação: no banco os limites são menores; no banco e no Drive, vídeo não é aceito. */
export function uploadRule(purpose: UploadPurpose) {
  if (storesInDrive()) return { ...UPLOAD_RULES[purpose], maxBytes: DRIVE_MAX_BYTES, kinds: DATABASE_LIMITS[purpose].kinds };
  return storesInDatabase() ? { ...UPLOAD_RULES[purpose], ...DATABASE_LIMITS[purpose] } : UPLOAD_RULES[purpose];
}

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
  const rule = uploadRule(input.purpose);
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
  const inDatabase = storesInDatabase();
  const inDrive = storesInDrive();
  if (inDatabase || inDrive) await discardMyStaleChunks(actor.uid);
  // Drive: a sessão de envio é aberta já com o tamanho exato; o endereço dela nunca sai do servidor.
  const sessionUri = inDrive ? await startDriveUpload(fileName, input.contentType, input.size, id) : null;
  await db.doc(`uploads/${id}`).create({
    ...(inDatabase ? { storage: "database", chunks: chunkCount(input.size) } : {}),
    ...(inDrive ? { storage: "drive", chunks: Math.max(1, Math.ceil(input.size / DRIVE_CHUNK_BYTES)), nextIndex: 0, sessionUri } : {}),
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
  return { uploadId: id, path, fileName, ...(inDatabase ? { chunkBytes: FILE_CHUNK_BYTES } : inDrive ? { chunkBytes: DRIVE_CHUNK_BYTES } : {}) };
}

export function acceptedLabel(purpose: UploadPurpose) {
  const names: Record<FileKind, string> = { pdf: "PDF", image: "imagens (PNG, JPG, WEBP, GIF)", office: "Word/Excel/PowerPoint/ODF", text: "TXT/CSV", video: "vídeos MP4/MOV" };
  return uploadRule(purpose).kinds.map((k) => names[k]).join(", ");
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
  if (ticket.storage === "database") return finalizeDatabaseUpload(uploadId, purpose, destDir, ctx, ticketRef, ticket);
  if (ticket.storage === "drive") return finalizeDriveUpload(uploadId, purpose, destDir, ctx, ticketRef, ticket);

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
  const detected = acceptedContent(head, ticket, purpose);
  if (!detected) {
    await staged.delete({ ignoreNotFound: true });
    await ticketRef.update({ status: "rejected", rejectedAt: nowISO() });
    fail("invalid", `O conteúdo do arquivo não corresponde a um formato aceito (${acceptedLabel(purpose)}).`);
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

/** Tipo real do conteúdo, se for aceito para a finalidade e coerente com o declarado; null quando recusado. */
function acceptedContent(head: Buffer, ticket: DocumentData, purpose: UploadPurpose): string | null {
  const detected = sniffMime(head, ticket.contentType);
  const detectedKind = detected ? kindOfMime(detected) : null;
  if (
    !detected ||
    !detectedKind ||
    !uploadRule(purpose).kinds.includes(detectedKind) ||
    kindOfMime(ticket.contentType) !== detectedKind ||
    !officeNameMatches(ticket.fileName, detected)
  ) {
    return null;
  }
  return detected;
}

/** Marca o tíquete como anexado (na fase de escrita da transação da operação). */
export function markAttached(tx: Transaction, uploadId: string, resource: string) {
  tx.update(db.doc(`uploads/${uploadId}`), { status: "attached", attachedTo: resource, attachedAt: nowISO() });
}

/* ------------------------------------------------------------------------
 * ARQUIVOS COMO LINK (implantação gratuita, sem Cloud Storage)
 * ------------------------------------------------------------------------
 * A pessoa informa o nome e o link do arquivo (Google Drive, OneDrive…). A
 * Central guarda só esses dados; quem controla o acesso ao arquivo é o serviço
 * onde ele está. Só links https são aceitos (nunca javascript:, data: etc.).
 */
export const LINK_MIME = "text/uri-list";

function isSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const fileLinkSchema = z
  .object({
    name: z
      .string({ error: "Informe o nome do arquivo." })
      .trim()
      .min(1, "Informe o nome do arquivo.")
      .max(200, "O nome do arquivo pode ter no máximo 200 caracteres."),
    url: z
      .string({ error: "Informe o link do arquivo." })
      .trim()
      .max(2000, "O link do arquivo é longo demais.")
      .refine(isSafeHttpsUrl, "Informe um link válido, começando com https:// (ex.: link de compartilhamento do Google Drive)."),
  })
  .strict();

export type FileLink = z.infer<typeof fileLinkSchema>;

/** Referência de arquivo guardada para um link. */
export function linkFileRef(link: FileLink): FileRef {
  return { name: safeFileName(link.name), size: 0, mimeType: LINK_MIME, url: new URL(link.url).toString() };
}

/**
 * Arquivo de uma operação: link (implantação gratuita) ou envio pelo Storage.
 * `null` quando nenhum dos dois foi informado.
 */
export async function resolveFile(
  actor: Actor,
  source: { uploadId?: string | null; link?: FileLink | null },
  purpose: UploadPurpose,
  destDir: string,
  ctx: PrepareContext,
): Promise<FileRef | null> {
  if (source.link) return linkFileRef(source.link);
  if (source.uploadId) return finalizeUpload(actor, source.uploadId, purpose, destDir, ctx);
  return null;
}

/** Mensagem para quando arquivo e link chegam juntos. */
export const ONE_FILE_SOURCE = "Informe o arquivo OU o link, não os dois.";

/* ------------------------------------------------------------------------
 * ARQUIVOS NO PRÓPRIO BANCO (implantação gratuita, sem Cloud Storage)
 * ------------------------------------------------------------------------
 * `FILE_STORAGE=database`. O arquivo é guardado em pedaços de 512 KB no
 * Firestore (`fileChunks/{uploadId}_{n}`, campo `data` binário), sem custo e
 * sem cartão, dentro da cota gratuita do banco (1 GB no total). Por isso os
 * limites são menores (DATABASE_LIMITS) e vídeo não é aceito.
 *
 *  - Envio: o navegador manda cada pedaço ao servidor (`systemApi.uploadChunk`),
 *    que confere o tíquete (dono, situação, validade) e o tamanho exato do
 *    pedaço numa transação. O navegador nunca grava no banco diretamente.
 *  - Conferência: igual ao Storage (assinatura binária, SHA-256, nome com a
 *    extensão do tipo real); os pedaços não são copiados, só passam a valer
 *    quando o tíquete vira "attached" na transação da operação.
 *  - Leitura: as regras do Firestore liberam cada pedaço só para quem pode ver
 *    o registro dono do arquivo (o mesmo critério das regras do Storage),
 *    lendo o destino gravado no tíquete.
 *  - Limpeza: sem rotina agendada no plano gratuito; ao pedir um novo envio,
 *    os envios vencidos da própria pessoa são apagados.
 */
export const FILE_CHUNK_BYTES = 512 * 1024;

const DATABASE_LIMITS: Record<UploadPurpose, { maxBytes: number; kinds: FileKind[] }> = {
  document: { maxBytes: 8 * MB, kinds: ["pdf", "image", "office", "text"] },
  saleReceipt: { maxBytes: 4 * MB, kinds: ["pdf", "image"] },
  financeReceipt: { maxBytes: 4 * MB, kinds: ["pdf", "image"] },
  marketingFile: { maxBytes: 8 * MB, kinds: ["pdf", "image", "office"] },
};

export function storesInDatabase() {
  return process.env.FILE_STORAGE === "database";
}

/**
 * `FILE_STORAGE=drive`: o navegador manda o arquivo em partes de 3 MiB pelo
 * servidor (`systemApi.uploadChunk`), que confere cada parte e a repassa na
 * hora para um envio retomável do Google Drive — nada fica no banco. A
 * primeira parte já tem o tipo real conferido; ao anexar, o servidor confere
 * tamanho e SHA-256 no próprio Drive. A leitura é pelo servidor (`readDriveFile`).
 */
export function storesInDrive() {
  return process.env.FILE_STORAGE === "drive";
}

/** Parte do envio no Drive: múltiplo de 256 KiB (exigência do Drive) e, em base64, abaixo do limite de 4,5 MB da hospedagem. */
export const DRIVE_CHUNK_BYTES = 3 * MB;

/** Limite por arquivo no Drive (o espaço total é o da conta da Atlética, 15 GB). */
export const DRIVE_MAX_BYTES = 500 * MB;

export function chunkCount(size: number) {
  return Math.max(1, Math.ceil(size / FILE_CHUNK_BYTES));
}

export function chunkId(uploadId: string, index: number) {
  return `${uploadId}_${index}`;
}

function chunkRefs(uploadId: string, total: number) {
  return Array.from({ length: total }, (_, i) => db.doc(`fileChunks/${chunkId(uploadId, i)}`));
}

export async function deleteChunks(uploadId: string, total: number) {
  const batch = db.batch();
  for (const ref of chunkRefs(uploadId, total)) batch.delete(ref);
  await batch.commit();
}

/** Grava um pedaço do arquivo de um tíquete pendente da própria pessoa. */
export async function writeUploadChunk(actor: Actor, input: { uploadId: string; index: number; data: string }) {
  if (storesInDrive()) return writeDriveChunk(actor, input);
  if (!storesInDatabase()) fail("unavailable", "O envio em pedaços não está ativo nesta instalação.");
  if (!/^[a-f0-9]{32}$/.test(input.uploadId)) fail("invalid", "Envio de arquivo inválido.");
  const bytes = Buffer.from(input.data, "base64");
  const ticketRef = db.doc(`uploads/${input.uploadId}`);
  await db.runTransaction(async (tx) => {
    const ticket = (await tx.get(ticketRef)).data();
    if (!ticket) fail("invalid", "O envio do arquivo expirou ou não foi encontrado. Envie o arquivo novamente.");
    if (ticket.uid !== actor.uid || ticket.storage !== "database") fail("forbidden", "Este envio de arquivo pertence a outra operação.");
    if (ticket.status !== "pending") fail("conflict", USED_ELSEWHERE);
    if (ticketExpired(ticket)) fail("invalid", EXPIRED);
    const total = Number(ticket.chunks);
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= total) fail("invalid", "Pedaço do arquivo fora do esperado.");
    const expected = input.index < total - 1 ? FILE_CHUNK_BYTES : ticket.size - FILE_CHUNK_BYTES * (total - 1);
    if (bytes.length !== expected) fail("invalid", "O arquivo recebido não corresponde ao arquivo informado. Envie novamente.");
    tx.set(db.doc(`fileChunks/${chunkId(input.uploadId, input.index)}`), { uploadId: input.uploadId, index: input.index, uid: actor.uid, data: bytes, createdAt: nowISO() });
  });
  return { received: input.index };
}

/** Compensação no banco: devolve o tíquete a "pending" (os pedaços continuam, a operação pode ser repetida). */
async function releaseDatabaseClaim(ticketRef: DocumentReference, destDir: string) {
  await db.runTransaction(async (tx) => {
    const ticket = (await tx.get(ticketRef)).data();
    if (!ticket || ticket.destDir !== destDir || (ticket.status !== "finalizing" && ticket.status !== "finalized")) return;
    tx.update(ticketRef, { status: "pending", destDir: FieldValue.delete(), file: FieldValue.delete(), claimedAt: FieldValue.delete(), claimRequestId: FieldValue.delete(), finalizedAt: FieldValue.delete(), releasedAt: nowISO() });
  });
}

async function finalizeDatabaseUpload(
  uploadId: string,
  purpose: UploadPurpose,
  destDir: string,
  ctx: PrepareContext,
  ticketRef: DocumentReference,
  ticket: DocumentData,
): Promise<FileRef> {
  ctx.onAbort(() => releaseDatabaseClaim(ticketRef, destDir));
  const total = Number(ticket.chunks);
  const snaps = await db.getAll(...chunkRefs(uploadId, total));
  if (snaps.some((snap) => !snap.exists)) fail("invalid", "O envio do arquivo não foi concluído. Envie o arquivo novamente.");
  const content = Buffer.concat(snaps.map((snap) => Buffer.from(snap.get("data") as Uint8Array)));
  if (content.length !== ticket.size || content.length > ticket.maxBytes) fail("invalid", "O arquivo recebido não corresponde ao arquivo informado. Envie novamente.");

  const detected = acceptedContent(content.subarray(0, 4096), ticket, purpose);
  if (!detected) {
    await deleteChunks(uploadId, total);
    await ticketRef.update({ status: "rejected", rejectedAt: nowISO() });
    fail("invalid", `O conteúdo do arquivo não corresponde a um formato aceito (${acceptedLabel(purpose)}).`);
  }
  const name = storedFileName(ticket.fileName, detected);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const file: FileRef = { name, size: content.length, mimeType: detected, path: `${destDir}/${uploadId}-${name}`, sha256, chunks: total };
  await ticketRef.update({ status: "finalized", file, finalizedAt: nowISO() });
  return file;
}

/** Pedaço lido por vez no Drive: em base64 cabe no limite de 4,5 MB por resposta da hospedagem. */
export const DRIVE_READ_BYTES = 3 * MB;

/**
 * Mesmo critério das regras do Firestore para os pedaços (`fileOwnerVisible`):
 * quem pode ver o registro dono do arquivo pode abrir o arquivo.
 */
async function canReadFileOf(actor: Actor, destDir: string) {
  const settings = (await db.doc("settings/system").get()).data();
  const moduleOn = (module: string) => settings?.modules?.[module] !== false;
  const visible = (module: string, data: DocumentData | undefined) =>
    !!data &&
    actor.can(`${module}.view` as Permission) &&
    moduleOn(module) &&
    (actor.can(`${module}.admin` as Permission) || intersects(actor.tokens, Array.isArray(data.readers) ? data.readers : []));
  const parts = destDir.split("/");
  if (parts[0] === "documents" && parts.length >= 2) return visible("documents", (await db.doc(`documents/${parts[1]}`).get()).data());
  if (parts[0] === "campaigns" && parts.length === 4 && parts[2] === "receipts") {
    if (!visible("campaigns", (await db.doc(`campaigns/${parts[1]}`).get()).data())) return false;
    if (actor.can("campaigns.admin")) return true;
    const buyer = (await db.doc(`campaigns/${parts[1]}/buyers/${parts[3]}`).get()).data();
    return intersects(actor.tokens, Array.isArray(buyer?.readers) ? buyer.readers : []);
  }
  if (parts[0] === "finance" && parts.length === 2) return actor.can("finance.view") && moduleOn("finance");
  if (parts[0] === "marketing" && parts.length === 2) return visible("marketing", (await db.doc(`contents/${parts[1]}`).get()).data());
  return false;
}

/** Lê um pedaço de um arquivo do Drive já anexado a um registro que a pessoa pode ver. */
export async function readDriveFile(actor: Actor, input: { uploadId: string; index: number }) {
  const ticket = (await db.doc(`uploads/${input.uploadId}`).get()).data();
  const file = ticket?.file as FileRef | undefined;
  // Mesma resposta para "não existe" e "sem acesso": não revela quais arquivos existem.
  if (!ticket || ticket.status !== "attached" || !file?.driveId || !(await canReadFileOf(actor, String(ticket.destDir)))) {
    fail("forbidden", "Seu perfil não tem acesso a este arquivo.");
  }
  const start = input.index * DRIVE_READ_BYTES;
  if (start >= file.size) fail("invalid", "Pedaço do arquivo fora do esperado.");
  const data = await readDriveRange(file.driveId, start, Math.min(start + DRIVE_READ_BYTES, file.size) - 1);
  return { data: data.toString("base64"), size: file.size };
}

/** Apaga os pedaços de envios vencidos e nunca anexados da própria pessoa (não há rotina agendada no plano gratuito). */
async function discardMyStaleChunks(uid: string) {
  const stale = await db.collection("uploads").where("uid", "==", uid).where("status", "==", "pending").limit(20).get();
  for (const doc of stale.docs) {
    const ticket = doc.data();
    if ((ticket.storage !== "database" && ticket.storage !== "drive") || !ticketExpired(ticket)) continue;
    const discarded = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(doc.ref)).data();
      if (!fresh || fresh.status !== "pending") return false;
      tx.update(doc.ref, { status: "discarded", discardedAt: nowISO() });
      return true;
    });
    if (!discarded) continue;
    if (ticket.storage === "database") await deleteChunks(doc.id, Number(ticket.chunks) || 1);
    else if (ticket.driveId) await deleteDriveFile(String(ticket.driveId)).catch(() => undefined);
    else if (ticket.sessionUri) await cancelDriveUpload(String(ticket.sessionUri));
  }
}

/* ------------------------------------------------------------------------
 * ENVIO EM PARTES PARA O GOOGLE DRIVE (FILE_STORAGE=drive)
 * ------------------------------------------------------------------------ */

const EXPECTED_ORDER = "Parte do arquivo fora de ordem. Envie o arquivo novamente.";

/**
 * Recebe uma parte, confere tíquete, ordem e tamanho, e a repassa ao Drive.
 * A parte só conta como recebida depois que o Drive confirma (o progresso no
 * navegador é real). Repetir uma parte já recebida não é erro.
 */
async function writeDriveChunk(actor: Actor, input: { uploadId: string; index: number; data: string }) {
  if (!/^[a-f0-9]{32}$/.test(input.uploadId)) fail("invalid", "Envio de arquivo inválido.");
  const bytes = Buffer.from(input.data, "base64");
  const ticketRef = db.doc(`uploads/${input.uploadId}`);
  const ticket = (await ticketRef.get()).data();
  if (!ticket) fail("invalid", "O envio do arquivo expirou ou não foi encontrado. Envie o arquivo novamente.");
  if (ticket.uid !== actor.uid || ticket.storage !== "drive") fail("forbidden", "Este envio de arquivo pertence a outra operação.");
  if (ticket.status !== "pending") fail("conflict", USED_ELSEWHERE);
  if (ticketExpired(ticket)) fail("invalid", EXPIRED);
  const total = Number(ticket.chunks);
  const next = Number(ticket.nextIndex ?? 0);
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= total) fail("invalid", "Pedaço do arquivo fora do esperado.");
  if (input.index < next) return { received: input.index };
  if (input.index > next) fail("invalid", EXPECTED_ORDER);
  const expected = input.index < total - 1 ? DRIVE_CHUNK_BYTES : ticket.size - DRIVE_CHUNK_BYTES * (total - 1);
  if (bytes.length !== expected) fail("invalid", "O arquivo recebido não corresponde ao arquivo informado. Envie novamente.");

  // Primeira parte: o tipo real é conferido antes de qualquer byte ir para o Drive.
  if (input.index === 0 && !acceptedContent(bytes.subarray(0, 4096), ticket, ticket.purpose as UploadPurpose)) {
    await ticketRef.update({ status: "rejected", rejectedAt: nowISO() });
    await cancelDriveUpload(String(ticket.sessionUri));
    fail("invalid", `O conteúdo do arquivo não corresponde a um formato aceito (${acceptedLabel(ticket.purpose as UploadPurpose)}).`);
  }

  const result = await putDriveChunk(String(ticket.sessionUri), bytes, input.index * DRIVE_CHUNK_BYTES, ticket.size);
  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ticketRef)).data();
    if (!fresh || fresh.status !== "pending" || Number(fresh.nextIndex ?? 0) !== input.index) return;
    tx.update(ticketRef, { nextIndex: input.index + 1, ...(result.done ? { driveId: result.id, sessionUri: FieldValue.delete() } : {}) });
  });
  return { received: input.index };
}

/** Confere no Drive o arquivo enviado em partes e devolve a referência para o registro. */
async function finalizeDriveUpload(
  uploadId: string,
  purpose: UploadPurpose,
  destDir: string,
  ctx: PrepareContext,
  ticketRef: DocumentReference,
  ticket: DocumentData,
): Promise<FileRef> {
  // Se a operação falhar, o envio volta a "pendente" e o arquivo continua no Drive para repetir a operação.
  ctx.onAbort(() => releaseDatabaseClaim(ticketRef, destDir));
  if (!ticket.driveId) fail("invalid", "O envio do arquivo não foi concluído. Envie o arquivo novamente.");
  const driveId = String(ticket.driveId);
  const info = await driveFileInfo(driveId);
  if (info.size !== ticket.size || info.size > ticket.maxBytes) fail("invalid", "O arquivo recebido não corresponde ao arquivo informado. Envie novamente.");
  const detected = acceptedContent(await readDriveRange(driveId, 0, Math.min(4096, info.size) - 1), ticket, purpose);
  if (!detected) {
    await deleteDriveFile(driveId);
    await ticketRef.update({ status: "rejected", rejectedAt: nowISO() });
    fail("invalid", `O conteúdo do arquivo não corresponde a um formato aceito (${acceptedLabel(purpose)}).`);
  }
  const name = storedFileName(ticket.fileName, detected);
  if (name !== ticket.fileName) await renameDriveFile(driveId, name);
  const file: FileRef = { name, size: info.size, mimeType: detected, path: `${destDir}/${uploadId}-${name}`, driveId, ...(info.sha256 ? { sha256: info.sha256 } : {}) };
  await ticketRef.update({ status: "finalized", file, finalizedAt: nowISO() });
  return file;
}

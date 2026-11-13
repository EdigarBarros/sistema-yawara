/**
 * ARQUIVOS NO GOOGLE DRIVE DA ATLÉTICA (implantação gratuita, FILE_STORAGE=drive)
 * ---------------------------------------------------------------------------
 * O servidor age em nome de UMA conta Google da Atlética, com o escopo
 * `drive.file` (só enxerga os arquivos que a própria Central criou).
 *
 * Conexão: em Configurações → Ambiente, quem tem `settings.admin` clica em
 * "Conectar Google Drive" e autoriza com a conta da Atlética. O retorno do
 * Google chega em /api/drive/callback, que guarda o refresh token e a pasta em
 * `serverSecrets/drive` (coleção que as regras do Firestore negam a todos os
 * navegadores). O ID e a chave do cliente OAuth ficam nas variáveis de
 * ambiente do servidor. Alternativa sem tela: GOOGLE_DRIVE_REFRESH_TOKEN e
 * GOOGLE_DRIVE_FOLDER_ID nas variáveis (gerados por `npm run drive:autorizar`)
 * têm prioridade sobre o banco.
 *
 * Os arquivos ficam numa pasta privada; quem pode abrir cada um é decidido
 * pela Central (ver files.ts), não pelo Drive.
 */
import { randomBytes } from "node:crypto";
import { db, nowISO, Timestamp } from "./admin";
import { AppError } from "./errors";
import { APP_BASE_URL, stringParam } from "./params";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FOLDER_NAME = "Central Yawara — arquivos";

const UNAVAILABLE = "O armazenamento de arquivos (Google Drive) não respondeu. Tente novamente em instantes.";
const NOT_CONNECTED = "O Google Drive da Central não está conectado. Peça a quem administra a Central para conectar em Configurações → Ambiente.";

/** Documento só do servidor (as regras do Firestore negam qualquer leitura pelo navegador). */
export const driveSecretRef = () => db.doc("serverSecrets/drive");
const stateRef = (state: string) => db.doc(`serverSecrets/driveOAuth_${state}`);

function oauthClient() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError("unavailable", "O cliente do Google Drive não está configurado na hospedagem (GOOGLE_DRIVE_CLIENT_ID e GOOGLE_DRIVE_CLIENT_SECRET).");
  }
  return { clientId, clientSecret };
}

/** Refresh token e pasta: das variáveis de ambiente (prioridade) ou da conexão feita pela tela. */
async function connection() {
  if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_FOLDER_ID) {
    return { refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN, folderId: process.env.GOOGLE_DRIVE_FOLDER_ID };
  }
  const saved = (await driveSecretRef().get()).data();
  if (!saved?.refreshToken || !saved?.folderId) throw new AppError("unavailable", NOT_CONNECTED);
  return { refreshToken: String(saved.refreshToken), folderId: String(saved.folderId) };
}

let cached: { refreshToken: string; token: string; expiresAt: number } | null = null;

async function postToken(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string } | null;
  return { ok: !!res?.ok && !!body?.access_token, body };
}

async function accessToken() {
  const { refreshToken } = await connection();
  if (cached && cached.refreshToken === refreshToken && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const { clientId, clientSecret } = oauthClient();
  const { ok, body } = await postToken({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  if (!ok) {
    // invalid_grant: autorização revogada ou vencida — basta conectar de novo em Configurações → Ambiente.
    if (body?.error === "invalid_grant") {
      throw new AppError("unavailable", "A autorização do Google Drive da Central expirou ou foi revogada. Conecte de novo em Configurações → Ambiente.");
    }
    throw new AppError("unavailable", UNAVAILABLE);
  }
  cached = { refreshToken, token: body!.access_token!, expiresAt: Date.now() + (body!.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function call(url: string, init: RequestInit = {}, token?: string) {
  const bearer = token ?? (await accessToken());
  const res = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${bearer}` } }).catch(() => null);
  if (!res) throw new AppError("unavailable", UNAVAILABLE);
  if (res.status === 404) throw new AppError("not_found", "O arquivo não foi encontrado no armazenamento.");
  if (!res.ok) throw new AppError("unavailable", UNAVAILABLE);
  return res;
}

/* ------------------------------- conexão pela tela ------------------------------- */

const STATE_TTL_MS = 10 * 60 * 1000;

/** Endereço de retorno cadastrado no cliente OAuth ("URIs de redirecionamento autorizados"). */
export function driveRedirectUri() {
  return `${stringParam(APP_BASE_URL, "http://localhost:3000").replace(/\/+$/, "")}/api/drive/callback`;
}

/** Endereço de autorização do Google; o `state` (uso único, 10 min) amarra o retorno a quem pediu. */
export async function driveAuthUrl(uid: string, redirectUri: string) {
  const { clientId } = oauthClient();
  const state = randomBytes(24).toString("hex");
  await stateRef(state).create({ uid, createdAt: nowISO(), expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS) });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state }).toString();
  return url.toString();
}

/** Consome o `state` (uma vez só) e devolve o uid de quem iniciou a conexão; null se inválido ou vencido. */
export async function consumeDriveState(state: string): Promise<string | null> {
  if (!/^[a-f0-9]{48}$/.test(state)) return null;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef(state));
    if (!snap.exists) return null;
    tx.delete(snap.ref);
    const data = snap.data()!;
    return (data.expiresAt as Timestamp).toMillis() > Date.now() ? String(data.uid) : null;
  });
}

/** Troca o código pelo refresh token, garante a pasta da Central e guarda a conexão. */
export async function completeDriveConnection(code: string, redirectUri: string, connectedBy: { uid: string; name: string }) {
  const { clientId, clientSecret } = oauthClient();
  const { ok, body } = await postToken({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!ok || !body?.refresh_token) throw new AppError("unavailable", "O Google recusou a autorização. Tente conectar de novo.");
  const token = body.access_token!;

  // Reaproveita a pasta já usada, se esta conta ainda enxerga ela; senão cria uma nova.
  const previous = (await driveSecretRef().get()).data()?.folderId as string | undefined;
  let folderId = previous;
  if (folderId) {
    folderId = await call(`${API}/${encodeURIComponent(folderId)}?fields=id,trashed`, {}, token)
      .then(async (r) => ((await r.json()) as { trashed?: boolean }).trashed ? undefined : previous)
      .catch((error: unknown) => {
        if (error instanceof AppError && error.code === "not_found") return undefined;
        throw error;
      });
  }
  if (!folderId) {
    const created = await call(`${API}?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    }, token);
    folderId = ((await created.json()) as { id?: string }).id;
    if (!folderId) throw new AppError("unavailable", UNAVAILABLE);
  }
  await driveSecretRef().set({ refreshToken: body.refresh_token, folderId, connectedAt: nowISO(), connectedBy: connectedBy.uid, connectedByName: connectedBy.name });
  cached = null;
  return { folderId };
}

/** Situação da conexão, sem nenhum segredo. */
export async function driveStatus() {
  const clientConfigured = !!process.env.GOOGLE_DRIVE_CLIENT_ID && !!process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_FOLDER_ID) {
    return { clientConfigured, connected: true, source: "env" as const, connectedAt: null, connectedByName: null };
  }
  const saved = (await driveSecretRef().get()).data();
  const connected = !!saved?.refreshToken && !!saved?.folderId;
  return {
    clientConfigured,
    connected,
    source: connected ? ("database" as const) : null,
    connectedAt: connected ? String(saved!.connectedAt ?? "") || null : null,
    connectedByName: connected ? String(saved!.connectedByName ?? "") || null : null,
  };
}

/* --------------------------------- arquivos --------------------------------- */

/**
 * Abre um envio retomável na pasta da Central e devolve o endereço da sessão
 * (guardado só no servidor, no tíquete). As partes chegam depois, em ordem.
 */
export async function startDriveUpload(name: string, mimeType: string, size: number, uploadId: string): Promise<string> {
  const { folderId } = await connection();
  const session = await call(`${UPLOAD}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mimeType, "x-upload-content-length": String(size) },
    body: JSON.stringify({ name, mimeType, parents: [folderId], appProperties: { uploadId } }),
  });
  const location = session.headers.get("location");
  if (!location) throw new AppError("unavailable", UNAVAILABLE);
  return location;
}

/**
 * Envia os bytes [start, start + length) de um total de `total`. O Drive responde
 * 308 enquanto faltam partes e devolve o id do arquivo na última. Partes devem
 * ter múltiplos de 256 KiB (exceto a última).
 */
export async function putDriveChunk(sessionUri: string, bytes: Buffer, start: number, total: number): Promise<{ done: false } | { done: true; id: string }> {
  const token = await accessToken();
  const end = start + bytes.length - 1;
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-range": `bytes ${start}-${end}/${total}` },
    body: new Uint8Array(bytes),
  }).catch(() => null);
  if (res?.status === 308) {
    // "Range: bytes=0-N" diz até onde o Drive guardou: precisa cobrir esta parte inteira.
    const saved = Number(res.headers.get("range")?.match(/-(\d+)$/)?.[1] ?? -1);
    if (saved < end) throw new AppError("unavailable", UNAVAILABLE);
    return { done: false };
  }
  if (res?.ok) {
    const { id } = (await res.json().catch(() => ({}))) as { id?: string };
    if (id) return { done: true, id };
  }
  // 404/410: sessão vencida (uma semana) ou cancelada — é preciso enviar de novo.
  if (res?.status === 404 || res?.status === 410) throw new AppError("invalid", "O envio expirou no armazenamento. Envie o arquivo novamente.");
  throw new AppError("unavailable", UNAVAILABLE);
}

/** Desiste de um envio retomável ainda incompleto (melhor esforço). */
export async function cancelDriveUpload(sessionUri: string) {
  await fetch(sessionUri, { method: "DELETE", headers: { authorization: `Bearer ${await accessToken()}` } }).catch(() => undefined);
}

/** Tamanho e resumo SHA-256 calculados pelo próprio Drive. */
export async function driveFileInfo(driveId: string): Promise<{ size: number; sha256: string | null }> {
  const res = await call(`${API}/${encodeURIComponent(driveId)}?fields=size,sha256Checksum`);
  const body = (await res.json()) as { size?: string; sha256Checksum?: string };
  return { size: Number(body.size ?? -1), sha256: body.sha256Checksum ?? null };
}

/** Troca o nome do arquivo no Drive (ex.: extensão do tipo real). */
export async function renameDriveFile(driveId: string, name: string) {
  await call(`${API}/${encodeURIComponent(driveId)}?fields=id`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
}

/** Lê os bytes [start, end] (inclusive) do arquivo. */
export async function readDriveRange(driveId: string, start: number, end: number): Promise<Buffer> {
  const res = await call(`${API}/${encodeURIComponent(driveId)}?alt=media`, { headers: { range: `bytes=${start}-${end}` } });
  return Buffer.from(await res.arrayBuffer());
}

/** Apaga o arquivo (compensação de uma operação que falhou). Já apagado não é erro. */
export async function deleteDriveFile(driveId: string) {
  await call(`${API}/${encodeURIComponent(driveId)}`, { method: "DELETE" }).catch((error: unknown) => {
    if (!(error instanceof AppError && error.code === "not_found")) throw error;
  });
}

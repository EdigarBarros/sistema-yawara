/**
 * ARQUIVOS NO GOOGLE DRIVE DA ATLÉTICA (implantação gratuita, FILE_STORAGE=drive)
 * ---------------------------------------------------------------------------
 * O servidor age em nome de UMA conta Google da Atlética, com o escopo
 * `drive.file` (só enxerga os arquivos que a própria Central criou). A
 * autorização é feita uma vez com `npm run drive:autorizar`, que gera o
 * refresh token guardado nas variáveis de ambiente do servidor — nunca no
 * navegador nem no repositório. Os arquivos ficam numa pasta privada; quem
 * pode abrir cada um é decidido pela Central (ver files.ts), não pelo Drive.
 */
import { AppError } from "./errors";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

const UNAVAILABLE = "O armazenamento de arquivos (Google Drive) não respondeu. Tente novamente em instantes.";

function config() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    throw new AppError("unavailable", "O Google Drive da Central não está configurado. Avise o suporte do sistema.");
  }
  return { clientId, clientSecret, refreshToken, folderId };
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken() {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const { clientId, clientSecret, refreshToken } = config();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  }).catch(() => null);
  if (!res?.ok) {
    // invalid_grant: autorização revogada ou vencida — precisa autorizar de novo (docs/backend/implantacao-gratuita.md).
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === "invalid_grant") {
      throw new AppError("unavailable", "A autorização do Google Drive da Central expirou ou foi revogada. Avise o suporte do sistema.");
    }
    throw new AppError("unavailable", UNAVAILABLE);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

async function call(url: string, init: RequestInit = {}) {
  const token = await accessToken();
  const res = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res) throw new AppError("unavailable", UNAVAILABLE);
  if (res.status === 404) throw new AppError("not_found", "O arquivo não foi encontrado no armazenamento.");
  if (!res.ok) throw new AppError("unavailable", UNAVAILABLE);
  return res;
}

/** Grava o arquivo na pasta da Central (envio retomável em uma só parte) e devolve o id no Drive. */
export async function uploadToDrive(name: string, mimeType: string, content: Buffer, uploadId: string): Promise<string> {
  const { folderId } = config();
  const session = await call(`${UPLOAD}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mimeType, "x-upload-content-length": String(content.length) },
    body: JSON.stringify({ name, mimeType, parents: [folderId], appProperties: { uploadId } }),
  });
  const location = session.headers.get("location");
  if (!location) throw new AppError("unavailable", UNAVAILABLE);
  const done = await call(location, { method: "PUT", headers: { "content-type": mimeType }, body: new Uint8Array(content) });
  const { id } = (await done.json()) as { id?: string };
  if (!id) throw new AppError("unavailable", UNAVAILABLE);
  return id;
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

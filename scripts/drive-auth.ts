/**
 * AUTORIZAÇÃO DO GOOGLE DRIVE DA ATLÉTICA (FILE_STORAGE=drive)
 * ---------------------------------------------------------------------------
 * Rode UMA vez, no seu computador, com a conta Google da Atlética à mão:
 *
 *   GOOGLE_DRIVE_CLIENT_ID=... GOOGLE_DRIVE_CLIENT_SECRET=... npm run drive:autorizar
 *
 * 1. Abre um endereço do Google para você entrar com a conta da Atlética e
 *    autorizar a Central (escopo `drive.file`: só os arquivos que a Central criar).
 * 2. Recebe a resposta neste computador (http://127.0.0.1:53682), troca pelo
 *    refresh token e cria a pasta privada "Central Yawara — arquivos".
 * 3. Mostra GOOGLE_DRIVE_REFRESH_TOKEN e GOOGLE_DRIVE_FOLDER_ID para você
 *    colar nas variáveis de ambiente da hospedagem.
 *
 * O refresh token dá acesso aos arquivos da Central: não envie por chat ou
 * e-mail, não grave no repositório. Passo a passo completo:
 * docs/backend/implantacao-gratuita.md §3.2.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Central Yawara — arquivos";

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Defina GOOGLE_DRIVE_CLIENT_ID e GOOGLE_DRIVE_CLIENT_SECRET (cliente OAuth do tipo \"App para computador\").");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  prompt: "consent",
  state,
}).toString();

/** Espera o Google redirecionar para este computador com o código de autorização. */
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT);
      const code = url.searchParams.get("code");
      const ok = !!code && url.searchParams.get("state") === state;
      res.writeHead(ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
      res.end(ok ? "Autorizado. Pode fechar esta aba e voltar ao terminal." : "Autorização recusada ou inválida. Volte ao terminal.");
      server.close();
      if (ok) resolve(code);
      else reject(new Error(url.searchParams.get("error") ?? "resposta inválida"));
    });
    server.listen(PORT, "127.0.0.1");
  });
}

async function main() {
  console.log("\n1) Abra este endereço, entre com a conta Google DA ATLÉTICA e autorize:\n");
  console.log(authUrl.toString(), "\n");
  const code = await waitForCode();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId!, client_secret: clientSecret!, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  });
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; error?: string };
  if (!tokenRes.ok || !tokens.access_token || !tokens.refresh_token) throw new Error(`o Google recusou a troca do código (${tokens.error ?? tokenRes.status})`);

  const folderRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = (await folderRes.json()) as { id?: string };
  if (!folderRes.ok || !folder.id) throw new Error(`não foi possível criar a pasta no Drive (${folderRes.status})`);

  console.log("2) Pronto. Cole nas variáveis de ambiente da hospedagem (NUNCA no repositório):\n");
  console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(`GOOGLE_DRIVE_FOLDER_ID=${folder.id}\n`);
  console.log(`A pasta "${FOLDER_NAME}" foi criada no Drive da Atlética. Não a apague nem a renomeie para outra conta.`);
}

main().catch((error: unknown) => {
  console.error("Falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});

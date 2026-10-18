/**
 * Cliente HTTP do Google Drive (core/drive.ts) com o `fetch` simulado:
 * renovação do token, envio retomável em duas etapas, leitura por intervalo
 * e mensagens quando a autorização da Atlética deixa de valer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = {
  GOOGLE_DRIVE_CLIENT_ID: "cliente-ficticio",
  GOOGLE_DRIVE_CLIENT_SECRET: "segredo-ficticio",
  GOOGLE_DRIVE_REFRESH_TOKEN: "refresh-ficticio",
  GOOGLE_DRIVE_FOLDER_ID: "pasta-ficticia",
};

type Call = { url: string; init: RequestInit };
let calls: Call[];

function reply(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers });
}

async function load(responses: ((call: Call) => Response)[]) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`chamada inesperada: ${url}`);
    return next(call);
  });
  vi.resetModules();
  return import("../src/core/drive");
}

const token = () => reply(200, { access_token: "acesso", expires_in: 3600 });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cliente do Google Drive", () => {
  it("envia em duas etapas para a pasta da Central e reaproveita o token", async () => {
    const drive = await load([
      token,
      () => reply(200, {}, { location: "https://upload.example/sessao" }),
      () => reply(200, { id: "arquivo-1" }),
      () => reply(206, new Uint8Array([1, 2, 3])),
    ]);
    const id = await drive.uploadToDrive("ata.pdf", "application/pdf", Buffer.from("%PDF-1.4"), "a".repeat(32));
    expect(id).toBe("arquivo-1");
    expect(String(calls[0].init.body)).toContain("grant_type=refresh_token");
    const meta = JSON.parse(String(calls[1].init.body));
    expect(meta).toMatchObject({ name: "ata.pdf", parents: ["pasta-ficticia"], appProperties: { uploadId: "a".repeat(32) } });
    expect(calls[2]).toMatchObject({ url: "https://upload.example/sessao", init: { method: "PUT" } });

    const bytes = await drive.readDriveRange("arquivo-1", 10, 12);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect((calls[3].init.headers as Record<string, string>).range).toBe("bytes=10-12");
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  it("autorização revogada vira mensagem clara; arquivo já apagado não é erro", async () => {
    const revoked = await load([() => reply(400, { error: "invalid_grant" })]);
    await expect(revoked.readDriveRange("x", 0, 1)).rejects.toThrow(/expirou ou foi revogada/);

    const drive = await load([token, () => reply(404)]);
    await expect(drive.deleteDriveFile("sumiu")).resolves.toBeUndefined();
  });

  it("sem configuração, recusa com mensagem para o suporte", async () => {
    vi.stubEnv("GOOGLE_DRIVE_REFRESH_TOKEN", "");
    const drive = await load([]);
    await expect(drive.readDriveRange("x", 0, 1)).rejects.toThrow(/não está configurado/);
  });
});

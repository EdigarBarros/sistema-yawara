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
  it("abre a sessão na pasta da Central, envia partes com Content-Range e reaproveita o token", async () => {
    const drive = await load([
      token,
      () => reply(200, {}, { location: "https://upload.example/sessao" }),
      () => reply(308, {}, { range: "bytes=0-3" }),
      () => reply(200, { id: "arquivo-1" }),
      () => reply(206, new Uint8Array([1, 2, 3])),
    ]);
    const uri = await drive.startDriveUpload("ata.pdf", "application/pdf", 8, "a".repeat(32));
    expect(uri).toBe("https://upload.example/sessao");
    expect(String(calls[0].init.body)).toContain("grant_type=refresh_token");
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ name: "ata.pdf", parents: ["pasta-ficticia"], appProperties: { uploadId: "a".repeat(32) } });
    expect((calls[1].init.headers as Record<string, string>)["x-upload-content-length"]).toBe("8");

    expect(await drive.putDriveChunk(uri, Buffer.from("%PDF"), 0, 8)).toEqual({ done: false });
    expect((calls[2].init.headers as Record<string, string>)["content-range"]).toBe("bytes 0-3/8");
    expect(await drive.putDriveChunk(uri, Buffer.from("-1.4"), 4, 8)).toEqual({ done: true, id: "arquivo-1" });
    expect((calls[3].init.headers as Record<string, string>)["content-range"]).toBe("bytes 4-7/8");

    const bytes = await drive.readDriveRange("arquivo-1", 10, 12);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect((calls[4].init.headers as Record<string, string>).range).toBe("bytes=10-12");
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  it("parte que o Drive não guardou inteira falha (para reenviar); sessão vencida pede novo envio", async () => {
    const short = await load([token, () => reply(308, {}, { range: "bytes=0-1" })]);
    await expect(short.putDriveChunk("https://upload.example/s", Buffer.from("%PDF"), 0, 8)).rejects.toThrow(/não respondeu/);
    const gone = await load([token, () => reply(404)]);
    await expect(gone.putDriveChunk("https://upload.example/s", Buffer.from("%PDF"), 0, 8)).rejects.toThrow(/expirou/);
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
    await expect(drive.readDriveRange("x", 0, 1)).rejects.toThrow(/não está conectado/);
  });
});

/**
 * Conexão com o Google Drive pela tela de Configurações: endereço de
 * autorização, retorno do Google (state de uso único, permissão conferida de
 * novo), conexão guardada só no servidor e situação sem segredos. O Google é
 * simulado (`fetch`); o resto roda nos emuladores.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveSecretRef } from "../src/core/drive";
import { finishDriveConnection, systemActions } from "../src/modules/system";
import { caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const system = caller("system", systemActions);

type Call = { url: string; init: RequestInit };
let calls: Call[];

/** Google simulado: troca do código, consulta e criação da pasta. Demais chamadas (emuladores) seguem normais. */
function fakeGoogle(options: { refuseCode?: boolean } = {}) {
  calls = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    if (!href.includes("googleapis.com")) return realFetch(url, init);
    calls.push({ url: href, init });
    if (href.includes("oauth2.googleapis.com/token")) {
      return options.refuseCode
        ? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
        : new Response(JSON.stringify({ access_token: "acesso", refresh_token: "refresh-da-atletica", expires_in: 3600 }));
    }
    if (init.method === "POST") return new Response(JSON.stringify({ id: "pasta-nova" }));
    return new Response(JSON.stringify({ id: "pasta-antiga", trashed: false }));
  });
}

async function connectUrl(uid: string) {
  const { url } = await system<{ url: string }>("driveConnectUrl", uid, {});
  return new URL(url);
}

beforeEach(async () => {
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "cliente-web-ficticio");
  vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "segredo-ficticio");
  vi.stubEnv("GOOGLE_DRIVE_REFRESH_TOKEN", "");
  vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "");
  vi.stubEnv("APP_BASE_URL", "https://central.example.org");
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await driveSecretRef().delete();
});

describe("conectar o Google Drive pela tela", () => {
  it("quem administra conecta: o token fica só no servidor e a situação não mostra segredos", async () => {
    const url = await connectUrl("pres");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("redirect_uri")).toBe("https://central.example.org/api/drive/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");

    fakeGoogle();
    expect(await finishDriveConnection({ code: "codigo", state: url.searchParams.get("state") })).toBe("ok");
    const saved = (await driveSecretRef().get()).data()!;
    expect(saved).toMatchObject({ refreshToken: "refresh-da-atletica", folderId: "pasta-nova", connectedBy: "pres" });
    expect(String(calls[0].init.body)).toContain("redirect_uri=https%3A%2F%2Fcentral.example.org%2Fapi%2Fdrive%2Fcallback");

    const status = await system<Record<string, unknown>>("driveStatus", "pres", {});
    expect(status).toMatchObject({ clientConfigured: true, connected: true, source: "database", connectedByName: "Presidente Teste" });
    expect(JSON.stringify(status)).not.toContain("refresh-da-atletica");
    const audit = await db.collection("auditLogs").where("action", "==", "settings.connectDrive").get();
    expect(audit.size).toBe(1);
  });

  it("reconectar reaproveita a pasta que a conta ainda enxerga", async () => {
    await driveSecretRef().set({ refreshToken: "antigo", folderId: "pasta-antiga" });
    const state = (await connectUrl("pres")).searchParams.get("state");
    fakeGoogle();
    expect(await finishDriveConnection({ code: "codigo", state })).toBe("ok");
    expect((await driveSecretRef().get()).data()).toMatchObject({ refreshToken: "refresh-da-atletica", folderId: "pasta-antiga" });
  });

  it("recusas: sem permissão, state repetido ou inventado, cancelado no Google e código recusado", async () => {
    await expectCode(system("driveConnectUrl", "sec", {}), "forbidden");
    await expectCode(system("driveStatus", "sec", {}), "forbidden");

    fakeGoogle();
    const state = (await connectUrl("pres")).searchParams.get("state");
    expect(await finishDriveConnection({ code: "codigo", state })).toBe("ok");
    expect(await finishDriveConnection({ code: "codigo", state })).toBe("invalid");
    expect(await finishDriveConnection({ code: "codigo", state: "a".repeat(48) })).toBe("invalid");
    expect(await finishDriveConnection({ code: "codigo", state: null })).toBe("invalid");

    await driveSecretRef().delete();
    const cancelled = (await connectUrl("pres")).searchParams.get("state");
    expect(await finishDriveConnection({ error: "access_denied", state: cancelled })).toBe("denied");

    fakeGoogle({ refuseCode: true });
    const refused = (await connectUrl("pres")).searchParams.get("state");
    expect(await finishDriveConnection({ code: "codigo", state: refused })).toBe("error");
    expect((await driveSecretRef().get()).exists).toBe(false);
  });

  it("perdeu a permissão entre o clique e o retorno do Google: não conecta", async () => {
    const state = (await connectUrl("pres")).searchParams.get("state");
    await db.doc("members/pres").update({ roleId: "secretario" });
    fakeGoogle();
    expect(await finishDriveConnection({ code: "codigo", state })).toBe("forbidden");
    expect((await driveSecretRef().get()).exists).toBe(false);
  });
});

/**
 * Ponte de sessão (modo Firebase): ativar ou desativar um módulo nas
 * Configurações chega às sessões abertas sem recarregar a página.
 *
 * O SDK do Firebase é substituído por observadores falsos, disparados à mão.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

type Listener = { path: string; next: (snap: unknown) => void; error: (e: unknown) => void; stop: Mock };
const state = vi.hoisted(() => ({
  authCallback: null as null | ((user: { uid: string } | null) => void),
  stopAuth: undefined as unknown as Mock,
  listeners: [] as Listener[],
  session: { userId: null as string | null, hydrated: false },
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string } | null) => void) => {
    state.authCallback = cb;
    return state.stopAuth;
  },
  signOut: vi.fn(async () => undefined),
}));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  onSnapshot: (ref: { path: string }, next: Listener["next"], error: Listener["error"]) => {
    const stop = vi.fn();
    state.listeners.push({ path: ref.path, next, error, stop });
    return stop;
  },
}));
vi.mock("@/services/firebase/app", () => ({ firebase: () => ({ auth: {}, db: {} }) }));
vi.mock("@/services/firebase/session", () => ({
  setAccessSnapshot: vi.fn(),
  useFirebaseSession: { getState: () => ({ endedReason: null }), setState: vi.fn() },
}));
vi.mock("@/stores/session", () => ({
  useSession: {
    getState: () => state.session,
    setState: (patch: Partial<typeof state.session>) => Object.assign(state.session, patch),
  },
}));

const { startFirebaseSessionBridge } = await import("./firebase-session");

const activeAccess = (version = 1) => ({ exists: () => true, data: () => ({ status: "active", version }) });
const listenersOn = (path: string) => state.listeners.filter((l) => l.path === path);

function setup() {
  const qc = { invalidateQueries: vi.fn(async () => undefined), clear: vi.fn() };
  const stop = startFirebaseSessionBridge(qc as unknown as QueryClient);
  return { qc, stop };
}

beforeEach(() => {
  state.authCallback = null;
  state.stopAuth = vi.fn();
  state.listeners.length = 0;
  state.session = { userId: null, hydrated: false };
});

describe("ponte de sessão: configurações em tempo real", () => {
  it("observa settings/system depois de confirmar a conta ativa e recarrega as configurações a cada mudança", () => {
    const { qc } = setup();
    state.authCallback!({ uid: "usr-livia" });
    // Antes de confirmar a conta ativa, as regras não deixam ler as configurações.
    expect(listenersOn("settings/system")).toHaveLength(0);
    listenersOn("userAccess/usr-livia")[0].next(activeAccess());
    expect(listenersOn("settings/system")).toHaveLength(1);

    qc.invalidateQueries.mockClear();
    // Outra pessoa desativou o Marketing: a consulta das configurações desta sessão é refeita.
    listenersOn("settings/system")[0].next({});
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["usr-livia", "settings"] });

    // Novos retratos de acesso não duplicam o observador.
    listenersOn("userAccess/usr-livia")[0].next(activeAccess(1));
    listenersOn("userAccess/usr-livia")[0].next(activeAccess(2));
    expect(listenersOn("settings/system")).toHaveLength(1);
  });

  it("erro ao observar as configurações não encerra a sessão nem quebra a tela", () => {
    const { qc } = setup();
    state.authCallback!({ uid: "usr-livia" });
    listenersOn("userAccess/usr-livia")[0].next(activeAccess());
    expect(() => listenersOn("settings/system")[0].error(new Error("permission-denied"))).not.toThrow();
    expect(qc.clear).not.toHaveBeenCalled();
  });

  it("ao sair, o observador das configurações é desligado (e religado no próximo login)", () => {
    setup();
    state.authCallback!({ uid: "usr-livia" });
    listenersOn("userAccess/usr-livia")[0].next(activeAccess());
    const [settings] = listenersOn("settings/system");
    state.authCallback!(null);
    expect(settings.stop).toHaveBeenCalledTimes(1);
    expect(listenersOn("userAccess/usr-livia")[0].stop).toHaveBeenCalled();

    state.authCallback!({ uid: "usr-rebeca" });
    listenersOn("userAccess/usr-rebeca")[0].next(activeAccess());
    expect(listenersOn("settings/system")).toHaveLength(2);
  });

  it("ao desmontar, desliga todos os observadores", () => {
    const { stop } = setup();
    state.authCallback!({ uid: "usr-livia" });
    listenersOn("userAccess/usr-livia")[0].next(activeAccess());
    stop();
    expect(state.stopAuth).toHaveBeenCalled();
    expect(listenersOn("userAccess/usr-livia")[0].stop).toHaveBeenCalled();
    expect(listenersOn("settings/system")[0].stop).toHaveBeenCalled();
  });
});

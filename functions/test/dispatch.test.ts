/**
 * Despachante das operações: idempotência com conferência dos dados,
 * auditoria de recusas e respostas negadas depois da confirmação.
 * Dados fictícios, criados só para o teste.
 */
import { randomUUID } from "node:crypto";
import type { CallableRequest } from "firebase-functions/https";
import { beforeEach, describe, expect, it } from "vitest";
import type { AtleticaEvent } from "@/types";
import { createApi, payloadFingerprint } from "../src/core/dispatch";
import { eventsActions } from "../src/modules/events";
import { auditFor, caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const events = caller("events", eventsActions);
/** A função chamável de verdade (o mesmo tratamento de erros e auditoria do ambiente publicado). */
const eventsApi = createApi("events", eventsActions);

function eventInput(over: Record<string, unknown> = {}) {
  return {
    name: "Integração de teste",
    description: "Evento fictício",
    type: "festa",
    date: "2026-11-20",
    time: "20:00",
    location: "Quadra coberta",
    departmentId: "eventos",
    responsibleIds: ["ass"],
    access: { scope: "all", roleIds: [], userIds: [] },
    ...over,
  };
}

/** Chama a função chamável como o SDK faria (sem HTTP). */
async function callApi(uid: string, action: string, payload: unknown, requestId = randomUUID()) {
  const request = { data: { action, payload, requestId }, auth: { uid, token: {} }, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<unknown>;
  return eventsApi.run(request);
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string; details?: Record<string, unknown> };
  }
  throw new Error("Esperava erro, mas a operação foi concluída.");
}

async function auditByRequest(requestId: string) {
  const snap = await db.collection("auditLogs").where("requestId", "==", requestId).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => String(a.outcome).localeCompare(String(b.outcome)));
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("idempotência confere os dados da requisição", () => {
  it("repetição idêntica devolve o mesmo resultado; os mesmos dados em outra ordem também", async () => {
    const rid = randomUUID();
    const a = await events<AtleticaEvent>("create", "evt", eventInput(), rid);
    const b = await events<AtleticaEvent>("create", "evt", eventInput(), rid);
    const reordered = Object.fromEntries(Object.entries(eventInput()).reverse());
    const c = await events<AtleticaEvent>("create", "evt", reordered, rid);
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect((await db.collection("events").get()).size).toBe(1);
    const stored = (await db.doc(`idempotency/evt__${rid}`).get()).data()!;
    expect(stored.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("mesmo identificador com outros dados: conflito claro, nada é refeito nem devolvido", async () => {
    const rid = randomUUID();
    const a = await events<AtleticaEvent>("create", "evt", eventInput(), rid);
    const e = await expectCode(events("create", "evt", eventInput({ name: "Outro evento" }), rid), "conflict");
    expect(e.message).toBe("Esta requisição já foi usada com outros dados.");
    expect((await db.collection("events").get()).size).toBe(1);
    expect((await db.doc(`events/${a.id}`).get()).data()!.name).toBe("Integração de teste");

    // Repetir uma edição antiga com outra carga não devolve o estado atual do registro.
    const uid = randomUUID();
    await events("update", "evt", { id: a.id, input: { location: "Ginásio" } }, uid);
    await events("update", "pres", { id: a.id, input: { name: "Evento renomeado", notes: "observação interna" } });
    const replay = await expectCode(events("update", "evt", { id: "qualquer", input: {} }, uid), "conflict");
    expect(replay.message).toBe("Esta requisição já foi usada com outros dados.");
    expect(replay.message).not.toContain("renomeado");
  });

  it("resumo estável: ordem das chaves e campos indefinidos não contam; o arquivo conta só como presença", () => {
    expect(payloadFingerprint({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(payloadFingerprint({ b: { d: "x", c: [1, 2] }, a: 1 }));
    expect(payloadFingerprint({ a: 1, b: undefined })).toBe(payloadFingerprint({ a: 1 }));
    expect(payloadFingerprint({ a: 1 })).not.toBe(payloadFingerprint({ a: 2 }));
    expect(payloadFingerprint({ b: { c: [1, 2] } })).not.toBe(payloadFingerprint({ b: { c: [2, 1] } }));
    // O navegador reenvia o arquivo (novo tíquete) ao repetir a requisição.
    const u1 = "a".repeat(32);
    const u2 = "b".repeat(32);
    expect(payloadFingerprint({ id: "x", uploadId: u1 })).toBe(payloadFingerprint({ id: "x", uploadId: u2 }));
    expect(payloadFingerprint({ id: "x", uploadId: u1 })).not.toBe(payloadFingerprint({ id: "x", uploadId: null }));
    expect(payloadFingerprint({ id: "x", uploadIds: [u1] })).toBe(payloadFingerprint({ id: "x", uploadIds: [u2] }));
    expect(payloadFingerprint({ id: "x", uploadIds: [u1] })).not.toBe(payloadFingerprint({ id: "x", uploadIds: [u1, u2] }));
  });
});

describe("auditoria de recusas pela função chamável", () => {
  it("F6: edição confirmada cuja resposta é negada (o autor saiu do público) não é auditada como recusa", async () => {
    // Criado pela presidência; evt edita por ter events.edit (não é criador, responsável nem administrador).
    const ev = await events<AtleticaEvent>("create", "pres", eventInput());
    const rid = randomUUID();
    const error = await errorOf(callApi("evt", "update", { id: ev.id, input: { access: { scope: "people", roleIds: [], userIds: ["fin"] } } }, rid));
    expect(error.code).toBe("permission-denied");
    expect(error.message).toBe("A operação foi concluída, mas este evento não está mais disponível para o seu perfil.");
    expect(error.details).toMatchObject({ code: "forbidden", committed: true });

    // A alteração foi gravada e auditada uma única vez, como sucesso.
    expect((await db.doc(`events/${ev.id}`).get()).data()!.access.scope).toBe("people");
    const logs = await auditByRequest(rid);
    expect(logs.map((l) => `${l.action}:${l.outcome}`)).toEqual(["events.update:success"]);

    // A repetição da mesma requisição também não vira "recusada".
    const again = await errorOf(callApi("evt", "update", { id: ev.id, input: { access: { scope: "people", roleIds: [], userIds: ["fin"] } } }, rid));
    expect(again.message).toBe("A operação foi concluída, mas este evento não está mais disponível para o seu perfil.");
    expect((await auditByRequest(rid)).map((l) => `${l.action}:${l.outcome}`)).toEqual(["events.update:success"]);
  });

  it("tentativa recusada por permissão: auditada como 'denied' com recurso genérico 'operation'", async () => {
    const ev = await events<AtleticaEvent>("create", "evt", eventInput());
    const rid = randomUUID();
    const error = await errorOf(callApi("mkt", "update", { id: ev.id, input: { name: "Invasão" } }, rid));
    expect(error.code).toBe("permission-denied");
    expect(error.details?.committed).toBeUndefined();
    const logs = await auditByRequest(rid);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "events.update", module: "events", outcome: "denied", resourceType: "operation", resourceId: null, actorId: "mkt" });
    expect((await auditFor(ev.id)).every((l) => l.outcome === "success")).toBe(true);
    expect((await db.doc(`events/${ev.id}`).get()).data()!.name).toBe("Integração de teste");
  });
});

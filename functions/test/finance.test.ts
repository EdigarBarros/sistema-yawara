import { beforeEach, describe, expect, it } from "vitest";
import type { AtleticaEvent, Campaign } from "@/types";
import { loadActorOutsideTx } from "../src/core/dispatch";
import { createUploadTicket } from "../src/core/files";
import { campaignsActions } from "../src/modules/campaigns";
import { eventsActions } from "../src/modules/events";
import { financeActions, newEntryId, type StoredEntry } from "../src/modules/finance";
import { auditFor, bucket, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const api = caller("finance", financeActions);
const events = caller("events", eventsActions);
const campaigns = caller("campaigns", campaignsActions);

/** Textos fictícios usados para conferir que não vão para a auditoria. */
const DESCRIPTION = "Ingressos do lote Zeta de teste";
const NOTES = "Observação interna Zeta";

/** PNG real de 1×1 pixel. */
const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
/** Outro PNG real (1×1, pixel de outra cor). */
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

function entryInput(over: Record<string, unknown> = {}) {
  return {
    type: "income",
    description: DESCRIPTION,
    categoryId: "rec-ingressos-de-eventos",
    amount: 12345,
    date: "2026-10-10",
    responsibleId: "fin",
    departmentId: "financeiro",
    status: "pending",
    notes: NOTES,
    ...over,
  };
}

function create(uid: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, requestId?: string) {
  return api<StoredEntry>("create", uid, { input: entryInput(over), ...extra }, requestId);
}

async function stored(id: string) {
  return (await db.doc(`financeEntries/${id}`).get()).data()!;
}

async function createEvent(uid: string, departmentId: string) {
  return events<AtleticaEvent>("create", uid, {
    name: "Evento de Teste",
    type: "festa",
    date: "2026-11-20",
    time: "20:00",
    location: "Quadra",
    departmentId,
    responsibleIds: [uid],
    access: { scope: "all", roleIds: [], userIds: [] },
  });
}

/** Envia um arquivo como faria o navegador (tíquete + objeto na área temporária). */
async function upload(uid: string, content: Buffer, fileName: string, contentType: string) {
  const actor = await loadActorOutsideTx(uid);
  const ticket = await createUploadTicket(actor, { purpose: "financeReceipt", fileName, size: content.length, contentType });
  await bucket().file(ticket.path).save(content, { contentType });
  return ticket.uploadId;
}

/** Token sem assinatura aceito pelo emulador (para testar as regras como o navegador). */
function mockIdToken(uid: string) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    iss: "https://securetoken.google.com/demo-yawara",
    aud: "demo-yawara",
    iat: now,
    exp: now + 3600,
    auth_time: now,
    sub: uid,
    user_id: uid,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

/** A mesma consulta do navegador (financeEntries por data, limite 2000), avaliada pelas regras. */
async function browserList(uid: string) {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-yawara/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mockIdToken(uid)}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "financeEntries" }], orderBy: [{ field: { fieldPath: "date" }, direction: "DESCENDING" }], limit: 2000 } }),
  });
  return res.status;
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
  await createMember("assfin", "Assessora Financeira Teste", "assessor-financeiro");
});

describe("registro de lançamentos", () => {
  it("o servidor gera id, código, autor, datas, histórico, índice e auditoria (sem textos livres)", async () => {
    const e = await create("fin", {}, {}, "req-criacao-0001");
    expect(e.id).toBe(newEntryId("fin", "req-criacao-0001"));
    expect(e.code).toBe("LAN-0001");
    expect(e.createdBy).toBe("fin");
    expect(e.status).toBe("pending");
    expect(e.amount).toBe(12345);
    expect(e.notes).toBe(NOTES);
    expect(e.history).toHaveLength(1);
    expect(e.history[0].action).toBe("created");
    expect(e.history[0].summary).toContain("Receita de R$");
    const data = await stored(e.id);
    expect(data).not.toHaveProperty("readers");
    expect(data.createdAt).toBe(data.updatedAt);
    const index = (await db.doc(`searchIndex/finance__${e.id}`).get()).data()!;
    expect(index.archived).toBe(false);
    expect(index.href).toBe(`/financeiro/lancamentos?id=${e.id}`);
    const logs = await auditFor(e.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("finance.create");
    expect(logs[0].details.amount).toBe(12345);
    expect(JSON.stringify(logs)).not.toContain("Zeta");
    const second = await create("fin");
    expect(second.code).toBe("LAN-0002");
  });

  it("campos desconhecidos e dados do servidor enviados pelo cliente são recusados", async () => {
    await expectCode(create("fin", { createdBy: "pres" }), "invalid");
    await expectCode(create("fin", { code: "LAN-9999" }), "invalid");
    await expectCode(api("create", "fin", { input: entryInput(), readers: ["all"] }), "invalid");
    expect((await db.collection("financeEntries").get()).size).toBe(0);
  });

  it("valor precisa ser inteiro em centavos e maior que zero", async () => {
    for (const amount of [0, -100, 10.5, "100", null, 1_000_000_001]) {
      await expectCode(create("fin", { amount }), "invalid");
    }
    expect((await db.collection("financeEntries").get()).size).toBe(0);
    expect((await create("fin", { amount: 1 })).amount).toBe(1);
  });

  it("descrição, data, categoria, departamento e responsável são conferidos", async () => {
    await expectCode(create("fin", { description: "ab" }), "invalid");
    await expectCode(create("fin", { date: "2026-02-30" }), "invalid");
    await expectCode(create("fin", { categoryId: "nao-existe" }), "invalid");
    await expectCode(create("fin", { departmentId: "nao-existe" }), "invalid");
    await expectCode(create("fin", { responsibleId: "ninguem" }), "invalid");
    await db.doc("members/ass").update({ status: "inactive" });
    const e = await expectCode(create("fin", { responsibleId: "ass" }), "invalid");
    expect(e.message).toContain("desativada");
  });

  it("a categoria precisa ser do mesmo tipo do lançamento", async () => {
    const e = await expectCode(create("fin", { type: "income", categoryId: "desp-alimentacao" }), "invalid");
    expect(e.message).toContain("não corresponde");
    await expectCode(create("fin", { type: "expense", categoryId: "rec-doacoes" }), "invalid");
    const ok = await create("fin", { type: "expense", categoryId: "desp-alimentacao" });
    expect(ok.type).toBe("expense");
    // Trocar o tipo na edição sem trocar a categoria também é recusado.
    await expectCode(api("update", "fin", { id: ok.id, input: { type: "income" } }), "invalid");
    const changed = await api<StoredEntry>("update", "fin", { id: ok.id, input: { type: "income", categoryId: "rec-doacoes" } });
    expect(changed.type).toBe("income");
  });

  it("evento e campanha vinculados precisam existir e estar visíveis para quem registra", async () => {
    await expectCode(create("fin", { eventId: "evento-inexistente" }), "invalid");
    await expectCode(create("fin", { campaignId: "campanha-inexistente" }), "invalid");
    const restricted = await events<AtleticaEvent>("create", "evt", {
      name: "Evento restrito",
      type: "festa",
      date: "2026-11-20",
      time: "20:00",
      location: "Quadra",
      departmentId: "eventos",
      responsibleIds: ["evt"],
      access: { scope: "department", departmentId: "eventos", roleIds: [], userIds: [] },
    });
    await expectCode(create("fin", { eventId: restricted.id }), "invalid");
    const ev = await createEvent("evt", "eventos");
    const c = await campaigns<Campaign>("create", "fin", {
      name: "Rifa de Teste",
      description: "",
      prize: "Kit",
      quantity: 50,
      unitPrice: 1000,
      access: { view: { scope: "all", roleIds: [], userIds: [] }, sell: { scope: "directors_advisors", roleIds: [], userIds: [] }, buyerData: { scope: "board", roleIds: [], userIds: [] } },
    });
    const e = await create("fin", { eventId: ev.id, campaignId: c.id, categoryId: "rec-rifas-e-campanhas" });
    expect(e.eventId).toBe(ev.id);
    expect(e.campaignId).toBe(c.id);
    // Vínculo vazio/nulo = sem vínculo.
    const cleared = await api<StoredEntry>("update", "fin", { id: e.id, input: { eventId: null, campaignId: "" } });
    expect(cleared.eventId).toBeUndefined();
    expect(cleared.campaignId).toBeUndefined();
    expect(await stored(e.id)).not.toHaveProperty("eventId");
  });

  it("módulo desativado nas configurações recusa operações", async () => {
    await db.doc("settings/system").update({ "modules.finance": false });
    await expectCode(create("fin"), "unavailable");
  });

  it("mesma requisição enviada duas vezes cria um único lançamento", async () => {
    const [a, b] = [await create("fin", {}, {}, "req-repetida-0001"), await create("fin", {}, {}, "req-repetida-0001")];
    expect(a.id).toBe(b.id);
    expect(a.code).toBe(b.code);
    expect((await db.collection("financeEntries").get()).size).toBe(1);
    expect((await db.doc("counters/LAN").get()).data()!.value).toBe(1);
    expect((await auditFor(a.id)).filter((l) => l.action === "finance.create")).toHaveLength(1);
  });
});

describe("matriz de permissões", () => {
  it("assessor(a) financeiro(a) registra pendente, mas não registra já realizado nem confirma ou cancela", async () => {
    const pending = await create("assfin");
    expect(pending.createdBy).toBe("assfin");
    const denied = await expectCode(create("assfin", { status: "settled" }), "forbidden");
    expect(denied.message).toContain("pendente");
    await expectCode(api("setStatus", "assfin", { id: pending.id, status: "settled" }), "forbidden");
    await expectCode(api("setStatus", "assfin", { id: pending.id, status: "cancelled", reason: "Duplicado" }), "forbidden");
    expect((await stored(pending.id)).status).toBe("pending");
  });

  it("quem tem finance.approve registra já como realizado", async () => {
    const e = await create("fin", { status: "settled" });
    expect(e.status).toBe("settled");
  });

  it("perfis sem finance.view não registram, não editam e não leem a coleção", async () => {
    await expectCode(create("evt"), "forbidden");
    await expectCode(create("sec"), "forbidden");
    const e = await create("fin");
    await expectCode(api("update", "evt", { id: e.id, input: { description: "Outra descrição" } }), "forbidden");
    await expectCode(api("setStatus", "evt", { id: e.id, status: "settled" }), "forbidden");
    expect(await browserList("evt")).toBe(403);
    expect(await browserList("mkt")).toBe(403);
    expect(await browserList("fin")).toBe(200);
    expect(await browserList("assfin")).toBe(200);
  });

  it("edição: canEditEntry (quem registrou enquanto pendente, ou finance.edit)", async () => {
    const mine = await create("assfin");
    const edited = await api<StoredEntry>("update", "assfin", { id: mine.id, input: { description: "Descrição corrigida" } });
    expect(edited.description).toBe("Descrição corrigida");
    const others = await create("fin");
    await expectCode(api("update", "assfin", { id: others.id, input: { description: "Tentativa" } }), "forbidden");
    await api("setStatus", "fin", { id: mine.id, status: "settled" });
    await expectCode(api("update", "assfin", { id: mine.id, input: { description: "Depois de confirmado" } }), "forbidden");
    // finance.edit edita lançamentos realizados de outras pessoas.
    expect((await api<StoredEntry>("update", "fin", { id: mine.id, input: { notes: null } })).notes).toBeUndefined();
  });

  it("a situação não muda pela edição", async () => {
    const e = await create("fin");
    const err = await expectCode(api("update", "fin", { id: e.id, input: { status: "settled" } }), "invalid");
    expect(err.message).toContain("confirmar/reabrir");
    // Mesma situação: aceito (o formulário reenvia os dados atuais).
    await api("update", "fin", { id: e.id, input: { status: "pending", description: "Mesma situação" } });
    expect((await stored(e.id)).status).toBe("pending");
  });
});

describe("situação: confirmar, cancelar e reabrir", () => {
  it("cancelar exige finance.archive e motivo; o motivo fica no histórico, não na auditoria", async () => {
    const e = await create("fin");
    await expectCode(api("setStatus", "assfin", { id: e.id, status: "cancelled", reason: "Lançamento duplicado" }), "forbidden");
    await expectCode(api("setStatus", "fin", { id: e.id, status: "cancelled" }), "invalid");
    await expectCode(api("setStatus", "fin", { id: e.id, status: "cancelled", reason: "  ab " }), "invalid");
    const cancelled = await api<StoredEntry>("setStatus", "fin", { id: e.id, status: "cancelled", reason: "Lançamento duplicado Zeta" });
    expect(cancelled.status).toBe("cancelled");
    const last = cancelled.history[cancelled.history.length - 1];
    expect(last.action).toBe("cancelled");
    expect(last.summary).toBe("Lançamento cancelado: Lançamento duplicado Zeta");
    expect((await db.doc(`searchIndex/finance__${e.id}`).get()).data()!.archived).toBe(true);
    const logs = (await auditFor(e.id)).filter((l) => l.action === "finance.setStatus");
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toMatchObject({ from: "pending", to: "cancelled" });
    expect(JSON.stringify(logs)).not.toContain("Zeta");
  });

  it("lançamento cancelado só reabre como pendente; não é editado nem recebe comprovante", async () => {
    const e = await create("fin", { status: "settled" });
    await api("setStatus", "fin", { id: e.id, status: "cancelled", reason: "Valor lançado errado" });
    const err = await expectCode(api("setStatus", "fin", { id: e.id, status: "settled" }), "conflict");
    expect(err.message).toContain("pendente");
    await expectCode(api("update", "fin", { id: e.id, input: { description: "Editar cancelado" } }), "forbidden");
    const uploadId = await upload("fin", PNG_A, "comprovante.png", "image/png");
    await expectCode(api("attachReceipt", "fin", { id: e.id, uploadId }), "conflict");
    const reopened = await api<StoredEntry>("setStatus", "fin", { id: e.id, status: "pending" });
    expect(reopened.status).toBe("pending");
    const settled = await api<StoredEntry>("setStatus", "fin", { id: e.id, status: "settled" });
    expect(settled.status).toBe("settled");
    expect(settled.history.map((h) => h.action)).toEqual(["created", "cancelled", "status", "payment"]);
  });

  it("confirmar e reabrir exigem finance.approve; repetir a mesma situação não altera nada", async () => {
    const e = await create("assfin");
    await expectCode(api("setStatus", "assfin", { id: e.id, status: "settled" }), "forbidden");
    await api("setStatus", "fin", { id: e.id, status: "settled" });
    const again = await api<StoredEntry>("setStatus", "fin", { id: e.id, status: "settled" });
    expect(again.history).toHaveLength(2);
    await expectCode(api("setStatus", "assfin", { id: e.id, status: "pending" }), "forbidden");
  });
});

describe("edição e auditoria", () => {
  it("alteração de valor registra valores anterior e novo (centavos) na auditoria e no histórico", async () => {
    const e = await create("fin");
    const updated = await api<StoredEntry>("update", "fin", { id: e.id, input: { amount: 20000, notes: "Nova observação Zeta" } });
    expect(updated.amount).toBe(20000);
    const last = updated.history[updated.history.length - 1];
    expect(last.summary).toMatch(/^Valor alterado de R\$\s?123,45 para R\$\s?200,00$/);
    const log = (await auditFor(e.id)).find((l) => l.action === "finance.update")!;
    expect(log.details).toMatchObject({ amountChanged: true, amountFrom: 12345, amountTo: 20000 });
    expect(log.details.fields).toContain("amount");
    expect(log.details.fields).toContain("notes");
    expect(JSON.stringify(log)).not.toContain("Zeta");
  });

  it("edições simultâneas no mesmo lançamento não perdem entradas do histórico", async () => {
    const e = await create("fin");
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => api("update", "fin", { id: e.id, input: { amount: 1000 * n, description: `Edição simultânea ${n}` } })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const data = await stored(e.id);
    expect(data.history).toHaveLength(5);
    expect(new Set(data.history.map((h: { id: string }) => h.id)).size).toBe(5);
    expect((await auditFor(e.id)).filter((l) => l.action === "finance.update")).toHaveLength(4);
  });
});

describe("comprovantes", () => {
  it("comprovante na criação: conteúdo conferido, movido para finance/{id} e anexado", async () => {
    const uploadId = await upload("assfin", PNG_A, "comprovante.png", "image/png");
    const e = await create("assfin", {}, { uploadId }, "req-com-comprovante-01");
    expect(e.id).toBe(newEntryId("assfin", "req-com-comprovante-01"));
    expect(e.receipt?.path).toBe(`finance/${e.id}/${uploadId}-comprovante.png`);
    expect(e.receipt?.mimeType).toBe("image/png");
    expect(e.receipt?.sha256).toMatch(/^[a-f0-9]{64}$/);
    const [exists] = await bucket().file(e.receipt!.path!).exists();
    expect(exists).toBe(true);
    expect((await db.doc(`uploads/${uploadId}`).get()).data()!.status).toBe("attached");
    expect(e.history.map((h) => h.action)).toEqual(["created", "attachment"]);
    // Reenvio da mesma requisição: mesmo lançamento, sem novo arquivo.
    const again = await create("assfin", {}, { uploadId }, "req-com-comprovante-01");
    expect(again.id).toBe(e.id);
    expect((await db.collection("financeEntries").get()).size).toBe(1);
  });

  it("conteúdo que não é PDF nem imagem é recusado e nada é gravado", async () => {
    const uploadId = await upload("fin", Buffer.from("isto é texto, não uma imagem\n"), "comprovante.png", "image/png");
    await expectCode(create("fin", {}, { uploadId }), "invalid");
    expect((await db.collection("financeEntries").get()).size).toBe(0);
  });

  it("substituir mantém o comprovante anterior (histórico, auditoria e arquivo preservados)", async () => {
    const e = await create("fin");
    const first = await upload("assfin", PNG_A, "primeiro.png", "image/png");
    const withReceipt = await api<StoredEntry>("attachReceipt", "assfin", { id: e.id, uploadId: first });
    expect(withReceipt.receipt?.name).toBe("primeiro.png");
    expect(withReceipt.receiptHistory).toBeUndefined();
    const second = await upload("fin", PNG_B, "segundo.png", "image/png");
    const replaced = await api<StoredEntry>("attachReceipt", "fin", { id: e.id, uploadId: second });
    expect(replaced.receipt?.path).toBe(`finance/${e.id}/${second}-segundo.png`);
    expect(replaced.receiptHistory?.map((f) => f.path)).toEqual([withReceipt.receipt!.path]);
    const [oldExists] = await bucket().file(withReceipt.receipt!.path!).exists();
    expect(oldExists).toBe(true);
    const last = replaced.history[replaced.history.length - 1];
    expect(last.summary).toBe("Comprovante substituído (anterior: primeiro.png)");
    const logs = (await auditFor(e.id)).filter((l) => l.action === "finance.attachReceipt");
    expect(logs).toHaveLength(2);
    const replacement = logs.find((l) => l.details.replaced === true)!;
    expect(replacement.details.previous_sha256).toBe(withReceipt.receipt!.sha256);
    expect(JSON.stringify(logs)).not.toContain("primeiro.png");
  });

  it("anexar exige finance.register ou finance.edit", async () => {
    const e = await create("fin");
    await createMember("fin-leitura", "Leitura Financeira Teste", "assessor-financeiro");
    await db.doc("roles/assessor-financeiro").update({ permissions: ["finance.view"] });
    // Tíquete criado diretamente (sem a conferência de prepareUpload) para testar a própria ação.
    const uploadId = await upload("fin-leitura", PNG_A, "comprovante.png", "image/png");
    await expectCode(api("attachReceipt", "fin-leitura", { id: e.id, uploadId }), "forbidden");
    await expectCode(api("attachReceipt", "mkt", { id: e.id, uploadId: await upload("mkt", PNG_A, "comprovante.png", "image/png") }), "forbidden");
    expect((await stored(e.id)).receipt).toBeUndefined();
    expect((await db.doc(`uploads/${uploadId}`).get()).data()!.status).toBe("pending");
  });
});

describe("lançamentos de um evento (listForEvent)", () => {
  it("diretoria do departamento do evento vê os lançamentos (sem observações, histórico e comprovantes)", async () => {
    const ev = await createEvent("evt", "eventos");
    const uploadId = await upload("fin", PNG_A, "comprovante.png", "image/png");
    await create("fin", { eventId: ev.id, date: "2026-10-01" }, { uploadId });
    await create("fin", { eventId: ev.id, type: "expense", categoryId: "desp-alimentacao", date: "2026-10-05" });
    await create("fin");
    const forBoard = await api<StoredEntry[]>("listForEvent", "evt", { eventId: ev.id });
    expect(forBoard.map((e) => e.date)).toEqual(["2026-10-05", "2026-10-01"]);
    for (const e of forBoard) {
      expect(e.notes).toBeUndefined();
      expect(e.receipt).toBeUndefined();
      expect(e.history).toEqual([]);
      expect(e.amount).toBe(12345);
    }
    const forFinance = await api<StoredEntry[]>("listForEvent", "fin", { eventId: ev.id });
    expect(forFinance).toHaveLength(2);
    expect(forFinance.every((e) => e.notes === NOTES)).toBe(true);
    expect(forFinance.find((e) => e.type === "income")!.receipt?.path).toContain(`finance/`);
    expect(await api<StoredEntry[]>("listForEvent", "pres", { eventId: ev.id })).toHaveLength(2);
  });

  it("diretoria de outro departamento e assessores sem finance.view são recusados", async () => {
    const ev = await createEvent("evt", "eventos");
    await create("fin", { eventId: ev.id });
    await expectCode(api("listForEvent", "mkt", { eventId: ev.id }), "forbidden");
    await expectCode(api("listForEvent", "ass", { eventId: ev.id }), "forbidden");
    await expectCode(api("listForEvent", "sec", { eventId: ev.id }), "forbidden");
    const ext = await createEvent("pres", "extensao");
    await expectCode(api("listForEvent", "evt", { eventId: ext.id }), "forbidden");
    expect(await api<StoredEntry[]>("listForEvent", "ext", { eventId: ext.id })).toEqual([]);
    await expectCode(api("listForEvent", "evt", { eventId: "nao-existe" }), "not_found");
    await expectCode(api("listForEvent", "evt", { eventId: "../financeEntries" }), "invalid");
  });

  it("módulo desativado recusa a consulta", async () => {
    const ev = await createEvent("evt", "eventos");
    await db.doc("settings/system").update({ "modules.finance": false });
    await expectCode(api("listForEvent", "evt", { eventId: ev.id }), "unavailable");
  });
});

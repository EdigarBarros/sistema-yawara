import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campaignStats, saleBuyerDoc, salePublicDoc } from "@/lib/firestore-model";
import { campaignReaders } from "@/lib/record-readers";
import type { Campaign, Sale } from "@/types";
import { isCommittedError, loadActorOutsideTx } from "../src/core/dispatch";
import { createUploadTicket } from "../src/core/files";
import { campaignsActions, presentSale } from "../src/modules/campaigns";
import { auditFor, bucket, caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const api = caller("campaigns", campaignsActions);

/** Nome e contato fictícios usados para conferir que não vazam (auditoria, parte pública). */
const BUYER_NAME = "Comprador Ficticio Zeta";
const BUYER_CONTACT = "(00) 90000-4321";

const aud = (scope: string, extra: Record<string, unknown> = {}) => ({ scope, roleIds: [], userIds: [], ...extra });
const ACCESS = { view: aud("all"), sell: aud("directors_advisors"), buyerData: aud("board") };

function newCampaign(uid = "pres", overrides: Record<string, unknown> = {}) {
  return api<Campaign>("create", uid, { name: "Rifa de Teste", description: "", prize: "Kit de teste", quantity: 50, unitPrice: 1000, access: ACCESS, ...overrides });
}

function register(uid: string, campaignId: string, numbers: number[], extra: Record<string, unknown> = {}, requestId?: string) {
  return api<Sale>(
    "registerSale",
    uid,
    { campaignId, numbers, buyerName: BUYER_NAME, buyerContact: BUYER_CONTACT, sellerId: "evt", status: "pending", paymentMethod: "pix", ...extra },
    requestId,
  );
}

const ref = (s: Pick<Sale, "campaignId" | "id">) => ({ campaignId: s.campaignId, saleId: s.id });

async function locksOf(campaignId: string) {
  const snap = await db.collection(`campaigns/${campaignId}/numbers`).get();
  return new Map(snap.docs.map((d) => [Number(d.id), d.data() as { saleId: string; status: string }]));
}

async function statsOf(campaignId: string) {
  return (await db.doc(`campaigns/${campaignId}`).get()).data()!.stats;
}

async function salesOf(campaignId: string) {
  const snap = await db.collection(`campaigns/${campaignId}/sales`).get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Sale);
}

/** Totais e travas precisam coincidir com o que as vendas gravadas dizem. */
async function expectConsistent(campaignId: string) {
  const campaign = (await db.doc(`campaigns/${campaignId}`).get()).data() as Campaign;
  const sales = await salesOf(campaignId);
  expect(await statsOf(campaignId)).toEqual(campaignStats(campaign, sales));
  const expected = new Map<number, { saleId: string; status: string }>();
  for (const s of sales) {
    if (s.status === "cancelled" && s.releasedAt) continue;
    for (const n of s.numbers) {
      expect(expected.has(n)).toBe(false); // nenhum número em duas vendas ativas
      expected.set(n, { saleId: s.id, status: s.status });
    }
  }
  expect(await locksOf(campaignId)).toEqual(expected);
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("criação e edição de campanhas", () => {
  it("cria com código, criador, público e índice calculados pelo servidor", async () => {
    const c = await newCampaign();
    expect(c.code).toMatch(/^RIFA-\d{4}-001$/);
    expect(c.createdBy).toBe("pres");
    expect(c.departmentId).toBe("presidencia");
    expect(c.status).toBe("active");
    const stored = (await db.doc(`campaigns/${c.id}`).get()).data()!;
    expect(stored.readers).toEqual(["all", "u:pres"]);
    expect(stored.stats).toEqual({ reserved: 0, pending: 0, paid: 0, cancelled: 0 });
    expect((await db.doc(`searchIndex/campaign__${c.id}`).get()).exists).toBe(true);
    expect((await auditFor(c.id)).some((a) => a.action === "campaigns.create")).toBe(true);
    const second = await newCampaign("fin");
    expect(second.code).toMatch(/^RIFA-\d{4}-002$/);
  });

  it("assessor(a) de eventos não pode criar campanhas", async () => {
    await expectCode(newCampaign("ass"), "forbidden");
    expect((await db.collection("campaigns").get()).size).toBe(0);
  });

  it("valida os dados e recusa campos enviados pelo navegador que o servidor calcula", async () => {
    await expectCode(newCampaign("pres", { quantity: 1.5 }), "invalid");
    await expectCode(newCampaign("pres", { unitPrice: 0 }), "invalid");
    await expectCode(newCampaign("pres", { readers: ["all"] }), "invalid");
    await expectCode(newCampaign("pres", { createdBy: "ass" }), "invalid");
    await expectCode(newCampaign("pres", { startDate: "2026-10-20", endDate: "2026-10-10" }), "invalid");
    const e = await expectCode(newCampaign("pres", { access: { ...ACCESS, sell: aud("roles") } }), "invalid");
    expect(e.message).toMatch(/pelo menos um cargo/);
    await expectCode(newCampaign("pres", { access: { ...ACCESS, buyerData: aud("all") } }), "invalid");
  });

  it("vincula um evento visível e recusa evento inexistente", async () => {
    await db.doc("events/evt-teste").set({ name: "Evento", access: aud("all"), departmentId: "eventos", createdBy: "pres", responsibleIds: [], readers: ["all"] });
    const c = await newCampaign("pres", { eventId: "evt-teste" });
    expect(c.eventId).toBe("evt-teste");
    await expectCode(newCampaign("pres", { eventId: "nao-existe" }), "invalid");
    const cleared = await api<Campaign>("update", "pres", { id: c.id, input: { eventId: null, drawDate: null } });
    expect(cleared.eventId).toBeUndefined();
  });

  it("quem não gerencia a campanha não edita; mudar o público dos compradores recalcula `readers` das vendas", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }) } });
    const sale = await register("ass", c.id, [1]);
    await expectCode(api("update", "ass", { id: c.id, input: { name: "Outro nome" } }), "forbidden");
    let buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer.readers).not.toContain("board");
    const updated = await api<Campaign>("update", "pres", { id: c.id, input: { access: { ...ACCESS, buyerData: aud("board") } } });
    expect(updated.history.some((h) => h.action === "shared")).toBe(true);
    buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer.readers).toContain("board");
    expect(buyer.name).toBe(BUYER_NAME);
  });
});

describe("registro de vendas", () => {
  it("registra uma venda: parte pública, comprador, trava e totais na mesma operação", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [7], { notes: "Entregar no treino" });
    expect(sale.numbers).toEqual([7]);
    expect(sale.registeredById).toBe("ass");
    expect(sale.buyer).toEqual({ name: BUYER_NAME, contact: BUYER_CONTACT });
    const pub = (await db.doc(`campaigns/${c.id}/sales/${sale.id}`).get()).data()!;
    expect(JSON.stringify(pub)).not.toContain(BUYER_NAME);
    expect(JSON.stringify(pub)).not.toContain(BUYER_CONTACT);
    expect(pub.notes).toBeUndefined();
    const buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer).toMatchObject({ name: BUYER_NAME, contact: BUYER_CONTACT, notes: "Entregar no treino", sellerId: "evt", registeredById: "ass" });
    expect(buyer.readers).toEqual(expect.arrayContaining(["board", "u:pres", "u:ass", "u:evt"]));
    expect((await db.doc(`campaigns/${c.id}/numbers/00007`).get()).data()).toEqual({ saleId: sale.id, status: "pending" });
    expect(await statsOf(c.id)).toEqual({ reserved: 0, pending: 1, paid: 0, cancelled: 0 });
  });

  it("vários números na mesma venda (repetidos são ignorados, ordem crescente)", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [10, 3, 1, 2, 2], { status: "reserved" });
    expect(sale.numbers).toEqual([1, 2, 3, 10]);
    expect(sale.paymentMethod).toBeUndefined();
    expect((await locksOf(c.id)).size).toBe(4);
    expect(await statsOf(c.id)).toEqual({ reserved: 4, pending: 0, paid: 0, cancelled: 0 });
    await expectConsistent(c.id);
  });

  it("número ocupado: a venda inteira é recusada (conflito), sem venda parcial", async () => {
    const c = await newCampaign();
    await register("ass", c.id, [5, 6]);
    const e = await expectCode(register("evt", c.id, [6, 7]), "conflict");
    expect(e.message).toContain("06");
    expect(e.details).toEqual({ numbers: [6] });
    expect((await db.doc(`campaigns/${c.id}/numbers/00007`).get()).exists).toBe(false);
    expect(await salesOf(c.id)).toHaveLength(1);
    await expectConsistent(c.id);
  });

  it("números fora da campanha ou mais de 100 por operação são recusados", async () => {
    const c = await newCampaign("pres", { quantity: 500 });
    await expectCode(register("ass", c.id, [0]), "invalid");
    await expectCode(register("ass", c.id, [501]), "invalid");
    await expectCode(register("ass", c.id, [1.5]), "invalid");
    const e = await expectCode(
      register(
        "ass",
        c.id,
        Array.from({ length: 101 }, (_, i) => i + 1),
      ),
      "invalid",
    );
    expect(e.message).toMatch(/no máximo 100 números/);
    expect(e.message).toMatch(/Divida/);
    const ok = await register("ass", c.id, Array.from({ length: 100 }, (_, i) => i + 1));
    expect(ok.numbers).toHaveLength(100);
    await expectConsistent(c.id);
  });

  it("10 registros simultâneos com números sobrepostos: cada número é vendido no máximo uma vez", async () => {
    const c = await newCampaign("pres", { quantity: 30 });
    const attempts = Array.from({ length: 10 }, (_, i) => [i + 1, i + 2, i + 3]);
    const results = await Promise.allSettled(attempts.map((numbers) => register("ass", c.id, numbers)));
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    for (const r of results) if (r.status === "rejected") expect((r.reason as { code: string }).code).toBe("conflict");
    expect(ok.length).toBeGreaterThan(0);
    // Trincas sobrepostas [i, i+1, i+2]: no máximo 4 podem coexistir (ex.: 1, 4, 7, 10).
    expect(ok.length).toBeLessThanOrEqual(4);
    const sold = ok.flatMap((s) => s.numbers);
    expect(new Set(sold).size).toBe(sold.length);
    const locks = await locksOf(c.id);
    expect(locks.size).toBe(sold.length);
    for (const s of ok) for (const n of s.numbers) expect(locks.get(n)?.saleId).toBe(s.id);
    expect(await salesOf(c.id)).toHaveLength(ok.length);
    expect((await statsOf(c.id)).pending).toBe(sold.length);
    await expectConsistent(c.id);
  });

  it("repetir a mesma requisição (mesmo requestId) cria UMA venda", async () => {
    const c = await newCampaign();
    const a = await register("ass", c.id, [9], {}, "req-venda-idempotente-01");
    const b = await register("ass", c.id, [9], {}, "req-venda-idempotente-01");
    expect(b.id).toBe(a.id);
    expect(await salesOf(c.id)).toHaveLength(1);
    expect(await statsOf(c.id)).toEqual({ reserved: 0, pending: 1, paid: 0, cancelled: 0 });
  });

  it("venda já paga exige permissão de confirmar recebimentos e forma de pagamento", async () => {
    const c = await newCampaign();
    await expectCode(register("evt", c.id, [1], { status: "paid" }), "forbidden");
    await expectCode(register("fin", c.id, [1], { status: "paid", paymentMethod: undefined }), "invalid");
    const sale = await register("fin", c.id, [1], { status: "paid", paymentMethod: "cash" });
    expect(sale.status).toBe("paid");
    expect(sale.confirmedById).toBe("fin");
    expect((await db.doc(`campaigns/${c.id}/numbers/00001`).get()).data()!.status).toBe("paid");
  });

  it("público de vendas: quem não está no público de venda não registra", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, sell: aud("directors") } });
    await expectCode(register("ass", c.id, [1]), "forbidden");
    await register("evt", c.id, [1]);
  });

  it("campanha encerrada recusa novas vendas, mas reservas e pendentes continuam gerenciáveis", async () => {
    const c = await newCampaign();
    const pending = await register("ass", c.id, [1]);
    const reserved = await register("ass", c.id, [2], { status: "reserved" });
    const closed = await api<Campaign>("close", "evt", { id: c.id });
    expect(closed.status).toBe("closed");
    expect(closed.closedBy).toBe("evt");
    await expectCode(api("close", "evt", { id: c.id }), "conflict");
    await expectCode(register("ass", c.id, [3]), "conflict");
    const converted = await api<Sale>("setSaleStatus", "ass", { ...ref(reserved), status: "pending" });
    expect(converted.status).toBe("pending");
    const paid = await api<Sale>("confirmPayment", "fin", { ...ref(pending), paymentMethod: "pix" });
    expect(paid.status).toBe("paid");
    await api<Sale>("cancelSale", "ass", { ...ref(converted), reason: "Comprador desistiu" });
    await expectCode(api("reopen", "ass", { id: c.id }), "forbidden");
    const reopened = await api<Campaign>("reopen", "pres", { id: c.id });
    expect(reopened.status).toBe("active");
    expect(reopened.closedAt).toBeUndefined();
    await register("ass", c.id, [3]);
    await expectConsistent(c.id);
  });
});

describe("pagamentos, cancelamento e liberação", () => {
  it("confirmar pagamento exige campaigns.approve; confirmar duas vezes é conflito", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [4]);
    await expectCode(api("confirmPayment", "evt", { ...ref(sale), paymentMethod: "pix" }), "forbidden");
    await expectCode(api("confirmPayment", "ass", { ...ref(sale), paymentMethod: "pix" }), "forbidden");
    const paid = await api<Sale>("confirmPayment", "fin", { ...ref(sale), paymentMethod: "transfer" });
    expect(paid).toMatchObject({ status: "paid", paymentMethod: "transfer", confirmedById: "fin" });
    await expectCode(api("confirmPayment", "fin", { ...ref(sale), paymentMethod: "pix" }), "conflict");
    expect((await db.doc(`campaigns/${c.id}/numbers/00004`).get()).data()).toEqual({ saleId: sale.id, status: "paid" });
    await expectConsistent(c.id);
  });

  it("transições inválidas são recusadas", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [1]);
    await expectCode(api("revertPayment", "fin", { ...ref(sale), reason: "Engano" }), "conflict");
    await expectCode(api("releaseSale", "evt", ref(sale)), "conflict");
    await api("confirmPayment", "fin", { ...ref(sale), paymentMethod: "pix" });
    await expectCode(api("setSaleStatus", "ass", { ...ref(sale), status: "reserved" }), "conflict");
    await expectCode(api("cancelSale", "ass", { ...ref(sale), reason: "Desistiu" }), "forbidden");
    await expectCode(api("revertPayment", "evt", { ...ref(sale), reason: "Engano" }), "forbidden");
    await expectCode(api("revertPayment", "fin", { ...ref(sale), reason: "x" }), "invalid");
    const reverted = await api<Sale>("revertPayment", "fin", { ...ref(sale), reason: "Confirmado no número errado" });
    expect(reverted.status).toBe("pending");
    expect(reverted.paidAt).toBeUndefined();
    const cancelled = await api<Sale>("cancelSale", "ass", { ...ref(sale), reason: "Desistiu" });
    await expectCode(api("confirmPayment", "fin", { ...ref(cancelled), paymentMethod: "pix" }), "conflict");
    await expectCode(api("cancelSale", "fin", { ...ref(cancelled), reason: "De novo" }), "conflict");
    await expectCode(api("setSaleStatus", "ass", { ...ref(cancelled), status: "pending" }), "conflict");
    await expectCode(api("updateSale", "ass", { ...ref(cancelled), input: { notes: "x" } }), "conflict");
    await expectConsistent(c.id);
  });

  it("cancelar e liberar devolve os números; o registro cancelado é mantido", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [11, 12]);
    const cancelled = await api<Sale>("cancelSale", "ass", { ...ref(sale), reason: "Comprador desistiu" });
    expect(cancelled.status).toBe("cancelled");
    expect((await locksOf(c.id)).get(11)).toEqual({ saleId: sale.id, status: "cancelled" });
    expect(await statsOf(c.id)).toEqual({ reserved: 0, pending: 0, paid: 0, cancelled: 2 });
    await expectCode(register("evt", c.id, [12]), "conflict");
    await expectCode(api("releaseSale", "ass", ref(sale)), "forbidden");
    const released = await api<Sale>("releaseSale", "evt", ref(sale));
    expect(released.releasedAt).toBeTruthy();
    expect(released.status).toBe("cancelled");
    expect((await locksOf(c.id)).size).toBe(0);
    expect(await statsOf(c.id)).toEqual({ reserved: 0, pending: 0, paid: 0, cancelled: 0 });
    await expectCode(api("releaseSale", "evt", ref(sale)), "conflict");
    const again = await register("evt", c.id, [11, 12]);
    expect(again.id).not.toBe(sale.id);
    expect(await salesOf(c.id)).toHaveLength(2);
    await expectConsistent(c.id);
  });

  it("totais corretos depois de uma sequência de operações; recount só para administradores", async () => {
    const c = await newCampaign();
    const a = await register("ass", c.id, [1, 2], { status: "reserved" });
    const b = await register("ass", c.id, [3]);
    const d = await register("fin", c.id, [4, 5], { status: "paid" });
    const e = await register("evt", c.id, [6, 7, 8]);
    await api("setSaleStatus", "ass", { ...ref(a), status: "pending" });
    await api("confirmPayment", "fin", { ...ref(b), paymentMethod: "pix" });
    await api("revertPayment", "fin", { ...ref(d), reason: "Valor não caiu na conta" });
    await api("cancelSale", "evt", { ...ref(e), reason: "Desistência" });
    await api("releaseSale", "evt", ref(e));
    await api("cancelSale", "fin", { ...ref(b), reason: "Estorno solicitado" });
    // a: pendente (2) · b: cancelada não liberada (1) · d: pendente (2) · e: liberada (0)
    expect(await statsOf(c.id)).toEqual({ reserved: 0, pending: 4, paid: 0, cancelled: 1 });
    await expectConsistent(c.id);

    await db.doc(`campaigns/${c.id}`).update({ stats: { reserved: 99, pending: 0, paid: 0, cancelled: 0 } });
    await expectCode(api("recount", "fin", { id: c.id }), "forbidden");
    const fixed = await api<{ changed: boolean; after: unknown }>("recount", "pres", { id: c.id });
    expect(fixed.changed).toBe(true);
    expect(await statsOf(c.id)).toEqual({ reserved: 0, pending: 4, paid: 0, cancelled: 1 });
  });

  it("comprovante enviado: conferido, movido para a pasta da venda e guardado só nos dados do comprador", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [20]);
    const content = Buffer.from("%PDF-1.4\n% comprovante de teste\n");
    const fin = await loadActorOutsideTx("fin");
    const ticket = await createUploadTicket(fin, { purpose: "saleReceipt", fileName: "comprovante.pdf", size: content.length, contentType: "application/pdf" });
    await bucket().file(ticket.path).save(content, { contentType: "application/pdf" });
    const paid = await api<Sale>("confirmPayment", "fin", { ...ref(sale), paymentMethod: "pix", uploadId: ticket.uploadId });
    expect(paid.receipt?.path).toMatch(new RegExp(`^campaigns/${c.id}/receipts/${sale.id}/${ticket.uploadId}-comprovante\\.pdf$`));
    expect(paid.receipt?.sha256).toHaveLength(64);
    const [exists] = await bucket().file(paid.receipt!.path!).exists();
    expect(exists).toBe(true);
    expect((await db.doc(`uploads/${ticket.uploadId}`).get()).data()!.status).toBe("attached");
    const pub = (await db.doc(`campaigns/${c.id}/sales/${sale.id}`).get()).data()!;
    expect(pub.receipt).toBeUndefined();
    expect((await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!.receipt.path).toBe(paid.receipt!.path);
  });
});

describe("privacidade dos compradores", () => {
  it("quem vê a campanha mas não está no público dos compradores recebe buyer = null", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }) } });
    const sale = await register("ass", c.id, [1], { notes: "Observação interna" });
    const buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer.readers).toEqual(["u:ass", "u:evt", "u:pres"]);

    // A resposta da própria operação (present) omite o comprador para o Financeiro.
    const paid = await api<Sale>("confirmPayment", "fin", { ...ref(sale), paymentMethod: "pix" });
    expect(paid.status).toBe("paid");
    expect(paid.buyer).toBeNull();
    expect(paid.notes).toBeUndefined();

    const mkt = await loadActorOutsideTx("mkt");
    const forMkt = await presentSale(mkt, ref(sale));
    expect(forMkt.buyer).toBeNull();
    expect(forMkt.numbers).toEqual([1]);

    const listMkt = await api<Sale[]>("listSales", "mkt", { campaignId: c.id });
    expect(listMkt[0].buyer).toBeNull();
    const listPres = await api<Sale[]>("listSales", "pres", { campaignId: c.id });
    expect(listPres[0].buyer?.name).toBe(BUYER_NAME);
    expect(listPres[0].notes).toBe("Observação interna");
    const listAss = await api<Sale[]>("listSales", "ass", { campaignId: c.id });
    expect(listAss[0].buyer?.name).toBe(BUYER_NAME);

    // Sem acesso aos dados pessoais, também não altera nome, contato ou observações.
    await expectCode(api("updateSale", "fin", { ...ref(sale), input: { buyerName: "Outro Nome" } }), "forbidden");
  });

  it("trocar o responsável pela venda recalcula quem vê o comprador", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }) } });
    const sale = await register("evt", c.id, [3], { sellerId: "evt" });
    await expectCode(api("updateSale", "evt", { ...ref(sale), input: { sellerId: "nao-existe" } }), "invalid");
    const updated = await api<Sale>("updateSale", "evt", { ...ref(sale), input: { sellerId: "ass" } });
    expect(updated.sellerId).toBe("ass");
    const buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer.readers).toEqual(["u:ass", "u:evt", "u:pres"]);
    expect(buyer.sellerId).toBe("ass");
    expect(updated.history.at(-1)?.summary).toBe("Alterado: responsável pela venda");
  });

  it("módulo desativado nas configurações recusa as operações", async () => {
    const c = await newCampaign();
    await db.doc("settings/system").update({ "modules.campaigns": false });
    await expectCode(newCampaign(), "unavailable");
    await expectCode(register("ass", c.id, [1]), "unavailable");
  });

  it("módulo desativado também recusa a consulta das vendas e o recálculo dos totais", async () => {
    const c = await newCampaign();
    await register("ass", c.id, [1, 2]);
    expect((await api<Sale[]>("listSales", "pres", { campaignId: c.id }))[0].buyer?.name).toBe(BUYER_NAME);
    await db.doc("settings/system").update({ "modules.campaigns": false });
    const e = await expectCode(api("listSales", "pres", { campaignId: c.id }), "unavailable");
    expect(e.message).toBe("Este módulo está desativado nas configurações.");
    expect(JSON.stringify(e)).not.toContain(BUYER_NAME);
    await expectCode(api("recount", "pres", { id: c.id }), "unavailable");
    expect((await auditFor(c.id)).map((l) => l.action)).not.toContain("campaigns.recount");
    // Reativado, volta a atender normalmente.
    await db.doc("settings/system").update({ "modules.campaigns": true });
    expect(await api<Sale[]>("listSales", "pres", { campaignId: c.id })).toHaveLength(1);
    await api("recount", "pres", { id: c.id });
  });

  it("campanha restrita: quem não está no público não vê a campanha nem as vendas", async () => {
    const c = await newCampaign("pres", { access: { view: aud("roles", { roleIds: ["presidente", "diretor-financeiro"] }), sell: aud("directors"), buyerData: aud("board") } });
    await expectCode(api("listSales", "mkt", { campaignId: c.id }), "forbidden");
    await expectCode(register("evt", c.id, [1]), "forbidden");
  });

  it("a auditoria registra as operações sem nome nem contato do comprador", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [1, 2]);
    await api("updateSale", "ass", { ...ref(sale), input: { buyerName: "Outro Comprador Ficticio", buyerContact: "(00) 91111-2222" } });
    await api("confirmPayment", "fin", { ...ref(sale), paymentMethod: "pix" });
    await api("cancelSale", "fin", { ...ref(sale), reason: "Estorno" });
    await api("releaseSale", "evt", ref(sale));
    const logs = (await db.collection("auditLogs").where("module", "==", "campaigns").get()).docs.map((d) => d.data());
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(["campaigns.create", "campaigns.registerSale", "campaigns.updateSale", "campaigns.confirmPayment", "campaigns.cancelSale", "campaigns.releaseSale"]),
    );
    const text = JSON.stringify(logs);
    for (const secret of [BUYER_NAME, BUYER_CONTACT, "Outro Comprador Ficticio", "(00) 91111-2222"]) expect(text).not.toContain(secret);
    const saleLogs = await auditFor(sale.id);
    expect(saleLogs.find((l) => l.action === "campaigns.registerSale")?.details).toMatchObject({ campaignId: c.id, numbers: "01–02", count: 2 });
  });
});

describe("correções de segurança: responsável, motivos, respostas repetidas e forma de pagamento", () => {
  it("quem edita vendas mas não vê o comprador não se torna responsável pela venda (nem obtém os dados pessoais)", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }) } });
    const sale = await register("ass", c.id, [1], { sellerId: "ass", notes: "Observação privada" });
    const before = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(before.readers).not.toContain("u:evt");
    // evt (diretor de Eventos) tem campaigns.edit, mas não está no público dos compradores.
    expect((await api<Sale[]>("listSales", "evt", { campaignId: c.id }))[0].buyer).toBeNull();
    const e = await expectCode(api("updateSale", "evt", { ...ref(sale), input: { sellerId: "evt" } }), "forbidden");
    expect(e.message).not.toContain(BUYER_NAME);
    const after = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(after.readers).toEqual(before.readers);
    expect(after.sellerId).toBe("ass");
    expect((await db.doc(`campaigns/${c.id}/sales/${sale.id}`).get()).data()!.sellerId).toBe("ass");
    expect((await api<Sale[]>("listSales", "evt", { campaignId: c.id }))[0].buyer).toBeNull();
    // Sem trocar o responsável, a edição permitida continua funcionando (sem expor o comprador).
    const edited = await api<Sale>("updateSale", "evt", { ...ref(sale), input: { sellerId: "ass", paymentMethod: "cash" } });
    expect(edited.paymentMethod).toBe("cash");
    expect(edited.buyer).toBeNull();
  });

  it("o novo responsável precisa estar ativo e poder vender nesta campanha", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, sell: aud("people", { userIds: ["ass"] }) } });
    const sale = await register("pres", c.id, [2], { sellerId: "ass" });
    // evt está ativo, mas não está no público de vendas desta campanha.
    const e = await expectCode(api("updateSale", "pres", { ...ref(sale), input: { sellerId: "evt" } }), "invalid");
    expect(e.message).toMatch(/possa registrar vendas nesta campanha/);
    await db.doc("members/sec").update({ status: "inactive" });
    await expectCode(api("updateSale", "pres", { ...ref(sale), input: { sellerId: "sec" } }), "invalid");
    expect((await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!.sellerId).toBe("ass");
    // O criador da campanha pode vender nela.
    const ok = await api<Sale>("updateSale", "pres", { ...ref(sale), input: { sellerId: "pres" } });
    expect(ok.sellerId).toBe("pres");
  });

  it("motivos de cancelamento e de pagamento desfeito ficam só nos dados restritos", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }) } });
    const sale = await register("ass", c.id, [3], { sellerId: "ass" });
    const revertReason = `${BUYER_NAME} pediu estorno, ligar ${BUYER_CONTACT}`;
    const cancelReason = `${BUYER_NAME} desistiu, ligar ${BUYER_CONTACT}`;
    await api("confirmPayment", "fin", { ...ref(sale), paymentMethod: "pix" });
    const reverted = await api<Sale>("revertPayment", "fin", { ...ref(sale), reason: revertReason });
    // fin confirma recebimentos, mas não está no público dos compradores: a resposta não traz o motivo.
    expect(reverted.revertReason).toBeUndefined();
    expect(reverted.history.at(-1)?.summary).toBe("Confirmação de pagamento desfeita (motivo nos dados restritos)");
    const cancelled = await api<Sale>("cancelSale", "fin", { ...ref(sale), reason: cancelReason });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBeUndefined();
    expect(cancelled.history.at(-1)?.summary).toBe("Venda cancelada (motivo nos dados restritos)");
    await api("releaseSale", "evt", ref(sale));

    const pub = JSON.stringify((await db.doc(`campaigns/${c.id}/sales/${sale.id}`).get()).data());
    for (const secret of [BUYER_NAME, BUYER_CONTACT, "desistiu", "estorno"]) expect(pub).not.toContain(secret);
    const buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer.cancelReason).toBe(cancelReason);
    expect(buyer.revertReason).toBe(revertReason);
    const audit = JSON.stringify(await auditFor(sale.id));
    for (const secret of [BUYER_NAME, BUYER_CONTACT]) expect(audit).not.toContain(secret);

    const forMkt = (await api<Sale[]>("listSales", "mkt", { campaignId: c.id }))[0];
    expect(forMkt.cancelReason).toBeUndefined();
    expect(forMkt.revertReason).toBeUndefined();
    expect(JSON.stringify(forMkt)).not.toContain(BUYER_CONTACT);
    const forPres = (await api<Sale[]>("listSales", "pres", { campaignId: c.id }))[0];
    expect(forPres.cancelReason).toBe(cancelReason);
    expect(forPres.revertReason).toBe(revertReason);
    // Quem vendeu também vê (está no público dos dados do comprador).
    expect((await api<Sale[]>("listSales", "ass", { campaignId: c.id }))[0].cancelReason).toBe(cancelReason);
  });

  it("repetir um requestId depois de perder o acesso não devolve a campanha nem a venda atuais", async () => {
    const c = await newCampaign("pres");
    const sale = await register("ass", c.id, [4], { sellerId: "ass" }, "replay-venda-0000001");
    await api<Campaign>("update", "evt", { id: c.id, input: { description: "Ajuste" } }, "replay-campanha-0000001");
    // A presidência restringe a campanha e muda os dados.
    await api("update", "pres", {
      id: c.id,
      input: { name: "Rifa sigilosa", notes: "observacao interna", access: { ...ACCESS, view: aud("roles", { roleIds: ["presidente", "diretor-financeiro"] }) } },
    });
    await expectCode(api("update", "evt", { id: c.id, input: { description: "Outra" } }), "forbidden");
    // Repetição legítima (mesmo requestId e mesmos dados): a operação já foi confirmada, só a resposta é recusada.
    const e1 = await expectCode(api("update", "evt", { id: c.id, input: { description: "Ajuste" } }, "replay-campanha-0000001"), "forbidden");
    expect(e1.message).toBe("A operação foi concluída, mas esta campanha não está mais disponível para o seu perfil.");
    expect(isCommittedError(e1)).toBe(true);
    expect(JSON.stringify(e1)).not.toContain("sigilosa");
    expect(JSON.stringify(e1)).not.toContain("observacao interna");
    const e2 = await expectCode(register("ass", c.id, [4], { sellerId: "ass" }, "replay-venda-0000001"), "forbidden");
    expect(e2.message).toBe("A operação foi concluída, mas esta campanha não está mais disponível para o seu perfil.");
    expect(isCommittedError(e2)).toBe(true);
    expect(JSON.stringify(e2)).not.toContain(BUYER_NAME);
    // A repetição não registrou nada de novo.
    expect((await db.collection(`campaigns/${c.id}/sales`).get()).docs.map((d) => d.id)).toEqual([sale.id]);
    // Quem continua vendo a campanha recebe a resposta (atual) normalmente na repetição.
    const again = await api<Campaign>("update", "pres", { id: c.id, input: { prize: "Kit novo" } }, "replay-campanha-0000002");
    const replay = await api<Campaign>("update", "pres", { id: c.id, input: { prize: "Kit novo" } }, "replay-campanha-0000002");
    expect(replay.id).toBe(again.id);
    expect(replay.prize).toBe("Kit novo");
    expect(replay.name).toBe("Rifa sigilosa");
  });

  it("forma de pagamento de venda já paga: só quem confirma recebimentos altera", async () => {
    const c = await newCampaign();
    const sale = await register("ass", c.id, [5], { sellerId: "ass", paymentMethod: "pix" });
    // Antes da confirmação, quem registrou ajusta normalmente.
    expect((await api<Sale>("updateSale", "ass", { ...ref(sale), input: { paymentMethod: "transfer" } })).paymentMethod).toBe("transfer");
    await api("confirmPayment", "fin", { ...ref(sale), paymentMethod: "pix" });
    const e = await expectCode(api("updateSale", "ass", { ...ref(sale), input: { paymentMethod: "cash" } }), "forbidden");
    expect(e.message).toMatch(/forma de pagamento de uma venda já paga/);
    const stored = (await db.doc(`campaigns/${c.id}/sales/${sale.id}`).get()).data()!;
    expect(stored).toMatchObject({ status: "paid", paymentMethod: "pix", confirmedById: "fin" });
    // Mesma forma (sem mudança) e outros campos continuam permitidos.
    await api("updateSale", "ass", { ...ref(sale), input: { paymentMethod: "pix", notes: "Entregue" } });
    const byApprover = await api<Sale>("updateSale", "fin", { ...ref(sale), input: { paymentMethod: "cash" } });
    expect(byApprover.paymentMethod).toBe("cash");
  });
});

describe("público dos compradores acompanha o público da campanha", () => {
  it("cada comprador guarda a cópia de quem vê a campanha; mudar só “quem vê” regrava essa cópia", async () => {
    const c = await newCampaign("pres", { access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }) } });
    const sale = await register("ass", c.id, [6], { sellerId: "ass" });
    let buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer.viewReaders).toEqual(["all", "u:pres"]);
    const readersBefore = buyer.readers;
    await api("update", "pres", { id: c.id, input: { access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }), view: aud("roles", { roleIds: ["diretor-financeiro"] }) } } });
    buyer = (await db.doc(`campaigns/${c.id}/buyers/${sale.id}`).get()).data()!;
    expect(buyer.viewReaders).toEqual(["r:diretor-financeiro", "u:pres"]);
    expect(buyer.readers).toEqual(readersBefore);
  });

  it("mais de 400 vendas: o restante é sincronizado a partir do estado atual e a pendência fica gravada até concluir", async () => {
    const c = await newCampaign("pres", { quantity: 500, access: { ...ACCESS, buyerData: aud("people", { userIds: ["pres"] }) } });
    const campaign = (await db.doc(`campaigns/${c.id}`).get()).data() as Campaign;
    const full: Campaign = { ...campaign, id: c.id };
    const TOTAL = 401;
    for (let start = 0; start < TOTAL; start += 200) {
      const batch = db.batch();
      for (let i = start; i < Math.min(TOTAL, start + 200); i++) {
        const sale: Sale = {
          id: `s${String(i).padStart(4, "0")}`,
          campaignId: c.id,
          numbers: [i + 1],
          buyer: { name: BUYER_NAME, contact: BUYER_CONTACT },
          sellerId: "evt",
          registeredById: "pres",
          createdAt: "2026-10-14T12:00:00.000Z",
          updatedAt: "2026-10-14T12:00:00.000Z",
          status: "pending",
          history: [],
        };
        batch.set(db.doc(`campaigns/${c.id}/sales/${sale.id}`), salePublicDoc(sale));
        batch.set(db.doc(`campaigns/${c.id}/buyers/${sale.id}`), saleBuyerDoc(full, sale));
      }
      await batch.commit();
    }
    const buyers = async () => (await db.collection(`campaigns/${c.id}/buyers`).get()).docs.map((d) => ({ id: d.id, ...(d.data() as { readers: string[]; viewReaders: string[]; sellerId: string }) }));

    // 1) A sincronização posterior falha (ex.: instância interrompida): a pendência fica gravada.
    const original = db.runTransaction.bind(db);
    let calls = 0;
    const spy = vi.spyOn(db, "runTransaction").mockImplementation(((fn: never, opts?: never) => {
      calls += 1;
      return calls === 1 ? original(fn, opts) : Promise.reject(new Error("falha simulada"));
    }) as unknown as typeof db.runTransaction);
    const response = await api<Campaign>("update", "pres", { id: c.id, input: { access: { ...ACCESS, buyerData: aud("board") } } });
    spy.mockRestore();
    // A marca interna nunca vai para o navegador.
    expect(Object.keys(response)).not.toContain("buyersSyncPending");
    expect(Object.keys(response)).not.toContain("buyersSyncToken");
    let stored = (await db.doc(`campaigns/${c.id}`).get()).data()!;
    expect(stored.buyersSyncPending).toBe(true);
    let list = await buyers();
    const stale = list.filter((b) => !b.readers.includes("board"));
    expect(stale).toHaveLength(TOTAL - 400);

    // 2) Enquanto isso, a venda pendente mudou de responsável (estado atual ≠ estado da transação original).
    await db.doc(`campaigns/${c.id}/buyers/${stale[0].id}`).update({ sellerId: "ass" });
    await db.doc(`campaigns/${c.id}/sales/${stale[0].id}`).update({ sellerId: "ass" });

    // 3) A próxima edição da campanha encontra a pendência e conclui a sincronização.
    await api("update", "pres", { id: c.id, input: { description: "Atualizada" } });
    stored = (await db.doc(`campaigns/${c.id}`).get()).data()!;
    expect(stored.buyersSyncPending).toBeUndefined();
    expect(stored.buyersSyncToken).toBeUndefined();
    list = await buyers();
    expect(list.every((b) => b.readers.includes("board"))).toBe(true);
    const moved = list.find((b) => b.id === stale[0].id)!;
    // Público calculado com o responsável ATUAL: o novo entra e o anterior sai.
    expect(moved.readers).toContain("u:ass");
    expect(moved.readers).not.toContain("u:evt");

    // 4) Mudança de “quem vê” sem falhas: todos os compradores recebem a nova cópia e a pendência some.
    await api("update", "pres", { id: c.id, input: { access: { ...ACCESS, buyerData: aud("board"), view: aud("board") } } });
    stored = (await db.doc(`campaigns/${c.id}`).get()).data()!;
    expect(stored.buyersSyncPending).toBeUndefined();
    const expected = campaignReaders({ ...full, access: { ...full.access, view: aud("board") as Campaign["access"]["view"] } });
    list = await buyers();
    expect(list.every((b) => JSON.stringify(b.viewReaders) === JSON.stringify(expected))).toBe(true);
  });
});

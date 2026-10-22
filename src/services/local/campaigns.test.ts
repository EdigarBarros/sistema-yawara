import { beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "@/data/demo/seed";
import { USR } from "@/data/demo/organization";
import { CMP } from "@/data/demo/campaigns";
import { buildSlots } from "@/lib/raffle";
import { setDBForTests, getDB } from "./db";
import { disableLatencyForTests, setActorForTests } from "./context";
import { localCampaigns as campaigns } from "./campaigns";
import { localSearch as search } from "./system";

disableLatencyForTests();

const access = {
  view: { scope: "all" as const, roleIds: [], userIds: [] },
  sell: { scope: "directors_advisors" as const, roleIds: [], userIds: [] },
  buyerData: { scope: "board" as const, roleIds: [], userIds: [] },
};

function firstAvailable(campaignId: string, count = 1) {
  const db = getDB();
  const c = db.campaigns.find((x) => x.id === campaignId)!;
  return buildSlots(c, db.sales.filter((s) => s.campaignId === campaignId))
    .filter((s) => s.status === "available")
    .slice(0, count)
    .map((s) => s.number);
}

beforeEach(() => {
  setDBForTests(buildSeed(new Date("2026-10-14T15:00:00-03:00")));
  setActorForTests(USR.rebeca);
});

describe("criação de rifa", () => {
  it("preenche criador, código e datas automaticamente", async () => {
    const c = await campaigns.create({ name: "Rifa Teste", description: "", prize: "Prêmio teste", quantity: 120, unitPrice: 500, access });
    expect(c.createdBy).toBe(USR.rebeca);
    expect(c.code).toMatch(/^RIFA-\d{4}-\d{3}$/);
    expect(c.createdAt).toBeTruthy();
    expect(c.status).toBe("active");
  });

  it("valida quantidade inteira e valor positivo", async () => {
    await expect(campaigns.create({ name: "Rifa", description: "", prize: "Prêmio", quantity: 1.5, unitPrice: 500, access })).rejects.toThrow(/inteiro/);
    await expect(campaigns.create({ name: "Rifa", description: "", prize: "Prêmio", quantity: 10, unitPrice: 0, access })).rejects.toThrow(/maior que zero/);
  });

  it("bloqueia perfis sem permissão de criar", async () => {
    setActorForTests(USR.pedro);
    await expect(campaigns.create({ name: "Rifa X", description: "", prize: "Prêmio", quantity: 10, unitPrice: 100, access })).rejects.toThrow(/não pode criar/);
  });
});

describe("registro de vendas", () => {
  it("registra vários números e impede vender o mesmo número duas vezes", async () => {
    const nums = firstAvailable(CMP.kit, 3);
    const sale = await campaigns.registerSale(CMP.kit, { numbers: nums, buyerName: "Comprador", buyerContact: "(00) 90000-1234", sellerId: USR.pedro, status: "pending", paymentMethod: "pix" });
    expect(sale.numbers).toEqual(nums);
    await expect(
      campaigns.registerSale(CMP.kit, { numbers: [nums[1]], buyerName: "Outro", buyerContact: "(00) 90000-9999", sellerId: USR.pedro, status: "pending" }),
    ).rejects.toThrow(/já não estão disponíveis/);
  });

  it("não aceita vendas em campanha encerrada", async () => {
    await expect(
      campaigns.registerSale(CMP.boasVindas, { numbers: [1], buyerName: "A", buyerContact: "(00) 90000-0000", sellerId: USR.rebeca, status: "pending" }),
    ).rejects.toThrow(/encerrada/);
  });

  it("exige permissão de aprovação para registrar já como pago", async () => {
    setActorForTests(USR.pedro);
    const [n] = firstAvailable(CMP.kit);
    await expect(
      campaigns.registerSale(CMP.kit, { numbers: [n], buyerName: "Comprador", buyerContact: "(00) 90000-1234", sellerId: USR.pedro, status: "paid", paymentMethod: "pix" }),
    ).rejects.toThrow(/já como paga/);
  });

  it("aceita venda sem contato (vendas antigas), mas recusa contato inválido", async () => {
    const [a, b] = firstAvailable(CMP.kit, 2);
    const sale = await campaigns.registerSale(CMP.kit, { numbers: [a], buyerName: "Comprador antigo", buyerContact: "", sellerId: USR.pedro, status: "pending" });
    expect(sale.buyer).toEqual({ name: "Comprador antigo", contact: "" });
    await expect(campaigns.registerSale(CMP.kit, { numbers: [b], buyerName: "Outro", buyerContact: "12", sellerId: USR.pedro, status: "pending" })).rejects.toThrow(/contato válido/);
  });

  it("falha sem gravar nada quando a validação falha", async () => {
    const before = JSON.stringify(getDB().sales);
    const [n] = firstAvailable(CMP.kit);
    await expect(
      campaigns.registerSale(CMP.kit, { numbers: [n], buyerName: "", buyerContact: "", sellerId: USR.pedro, status: "pending" }),
    ).rejects.toThrow();
    expect(JSON.stringify(getDB().sales)).toBe(before);
  });
});

describe("pagamento, cancelamento e liberação", () => {
  it("segue o fluxo pendente → pago → cancelado → liberado, mantendo o registro", async () => {
    const [n] = firstAvailable(CMP.kit);
    const sale = await campaigns.registerSale(CMP.kit, { numbers: [n], buyerName: "Comprador", buyerContact: "(00) 90000-1234", sellerId: USR.pedro, status: "pending", paymentMethod: "pix" });
    const paid = await campaigns.confirmPayment(sale.id, { paymentMethod: "pix" });
    expect(paid.status).toBe("paid");
    expect(paid.confirmedById).toBe(USR.rebeca);
    const cancelled = await campaigns.cancelSale(sale.id, "Comprador desistiu");
    expect(cancelled.status).toBe("cancelled");
    // ainda bloqueado até ser liberado
    await expect(
      campaigns.registerSale(CMP.kit, { numbers: [n], buyerName: "Novo", buyerContact: "(00) 90000-5555", sellerId: USR.pedro, status: "pending" }),
    ).rejects.toThrow();
    const released = await campaigns.releaseSale(sale.id);
    expect(released.releasedAt).toBeTruthy();
    expect(released.history.map((h) => h.action)).toEqual(["sale", "payment", "cancelled", "released"]);
    const again = await campaigns.registerSale(CMP.kit, { numbers: [n], buyerName: "Novo", buyerContact: "(00) 90000-5555", sellerId: USR.pedro, status: "pending" });
    expect(again.numbers).toEqual([n]);
    expect(getDB().sales.some((s) => s.id === sale.id)).toBe(true);
  });
});

describe("permissões simuladas", () => {
  it("esconde campanhas restritas de quem não está no público", async () => {
    setActorForTests(USR.livia);
    const visible = await campaigns.list();
    expect(visible.some((c) => c.id === CMP.vip)).toBe(false);
    await expect(campaigns.get(CMP.vip)).rejects.toThrow(/não está disponível/);
    const results = await search.search("Ingresso VIP");
    expect(results.some((r) => r.id === CMP.vip)).toBe(false);
  });

  it("oculta dados do comprador para quem não pode consultá-los", async () => {
    setActorForTests(USR.julia); // assessora de Marketing
    const sales = await campaigns.listSales(CMP.kit);
    const others = sales.filter((s) => s.registeredById !== USR.julia && s.sellerId !== USR.julia);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((s) => s.buyer === null)).toBe(true);
  });

  it("mostra dados do comprador para a diretoria", async () => {
    setActorForTests(USR.helena);
    const sales = await campaigns.listSales(CMP.kit);
    expect(sales.every((s) => s.buyer !== null)).toBe(true);
  });
});

/**
 * Regras de venda que o modo demonstração precisa aplicar como o servidor
 * (functions/src/modules/campaigns.ts): troca de responsável, motivos em texto
 * livre restritos e forma de pagamento de venda já paga.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "@/data/demo/seed";
import { USR } from "@/data/demo/organization";
import { CMP } from "@/data/demo/campaigns";
import { buildSlots } from "@/lib/raffle";
import { getDB, setDBForTests } from "@/services/local/db";
import { disableLatencyForTests, setActorForTests } from "@/services/local/context";
import { localCampaigns as campaigns } from "@/services/local/campaigns";

disableLatencyForTests();

const BUYER = "Comprador Ficticio Omega";
const CONTACT = "(00) 90000-7777";

function firstAvailable(campaignId: string) {
  const db = getDB();
  const c = db.campaigns.find((x) => x.id === campaignId)!;
  return buildSlots(c, db.sales.filter((s) => s.campaignId === campaignId)).find((s) => s.status === "available")!.number;
}

function stored(saleId: string) {
  return getDB().sales.find((s) => s.id === saleId)!;
}

beforeEach(() => {
  setDBForTests(buildSeed(new Date("2026-10-14T15:00:00-03:00")));
  setActorForTests(USR.rebeca);
});

describe("troca do responsável pela venda", () => {
  it("quem edita vendas mas não vê o comprador não se torna responsável (nem passa a ver os dados)", async () => {
    // Moletom: dados dos compradores só para Marketing, Financeiro e Presidência; Bruno (Eventos) tem campaigns.edit.
    setActorForTests(USR.bruno);
    const sales = await campaigns.listSales(CMP.moletom);
    const target = sales.find((s) => s.status !== "cancelled" && s.sellerId !== USR.bruno && s.registeredById !== USR.bruno)!;
    expect(target.buyer).toBeNull();
    const sellerBefore = stored(target.id).sellerId;
    await expect(campaigns.updateSale(target.id, { sellerId: USR.bruno })).rejects.toThrow(/transferir esta venda/);
    expect(stored(target.id).sellerId).toBe(sellerBefore);
    expect((await campaigns.listSales(CMP.moletom)).find((s) => s.id === target.id)!.buyer).toBeNull();
  });

  it("o novo responsável precisa estar ativo e poder vender nesta campanha", async () => {
    const audience = (scope: "all" | "board" | "people", userIds: string[] = []) => ({ scope, roleIds: [], userIds });
    const c = await campaigns.create({
      name: "Rifa Teste Responsável",
      description: "",
      prize: "Prêmio teste",
      quantity: 20,
      unitPrice: 500,
      access: { view: audience("all"), sell: audience("people", [USR.pedro]), buyerData: audience("board") },
    });
    const sale = await campaigns.registerSale(c.id, { numbers: [1], buyerName: BUYER, buyerContact: CONTACT, sellerId: USR.pedro, status: "pending", paymentMethod: "pix" });
    await expect(campaigns.updateSale(sale.id, { sellerId: USR.bruno })).rejects.toThrow(/possa registrar vendas nesta campanha/);
    await expect(campaigns.updateSale(sale.id, { sellerId: USR.sofia })).rejects.toThrow(/esteja ativo/);
    expect(stored(sale.id).sellerId).toBe(USR.pedro);
    // Quem criou a campanha pode vender nela.
    expect((await campaigns.updateSale(sale.id, { sellerId: USR.rebeca })).sellerId).toBe(USR.rebeca);
  });
});

describe("motivos em texto livre", () => {
  it("motivo do cancelamento e do pagamento desfeito só aparecem para quem vê o comprador", async () => {
    const n = firstAvailable(CMP.kit);
    const sale = await campaigns.registerSale(CMP.kit, { numbers: [n], buyerName: BUYER, buyerContact: CONTACT, sellerId: USR.pedro, status: "pending", paymentMethod: "pix" });
    await campaigns.confirmPayment(sale.id, { paymentMethod: "pix" });
    const reverted = await campaigns.revertPayment(sale.id, `${BUYER} pediu estorno, ligar ${CONTACT}`);
    expect(reverted.revertReason).toContain("pediu estorno");
    expect(reverted.history.at(-1)?.summary).toBe("Confirmação de pagamento desfeita (motivo nos dados restritos)");
    const cancelled = await campaigns.cancelSale(sale.id, `${BUYER} desistiu, ligar ${CONTACT}`);
    expect(cancelled.cancelReason).toContain("desistiu");
    expect(cancelled.history.at(-1)?.summary).toBe("Venda cancelada (motivo nos dados restritos)");

    // Júlia (assessora de Marketing) vê a campanha, mas não os dados dos compradores (público: diretoria).
    setActorForTests(USR.julia);
    const forJulia = (await campaigns.listSales(CMP.kit)).find((s) => s.id === sale.id)!;
    expect(forJulia.buyer).toBeNull();
    expect(forJulia.cancelReason).toBeUndefined();
    expect(forJulia.revertReason).toBeUndefined();
    expect(JSON.stringify(forJulia)).not.toContain(BUYER);
    expect(JSON.stringify(forJulia)).not.toContain(CONTACT);

    // Quem vendeu continua vendo os motivos.
    setActorForTests(USR.pedro);
    const forPedro = (await campaigns.listSales(CMP.kit)).find((s) => s.id === sale.id)!;
    expect(forPedro.cancelReason).toContain("desistiu");
    expect(forPedro.revertReason).toContain("pediu estorno");
  });
});

describe("forma de pagamento de venda já paga", () => {
  it("só quem confirma recebimentos altera", async () => {
    setActorForTests(USR.pedro);
    const n = firstAvailable(CMP.kit);
    const sale = await campaigns.registerSale(CMP.kit, { numbers: [n], buyerName: BUYER, buyerContact: CONTACT, sellerId: USR.pedro, status: "pending", paymentMethod: "pix" });
    // Antes da confirmação, quem registrou ajusta normalmente.
    expect((await campaigns.updateSale(sale.id, { paymentMethod: "transfer" })).paymentMethod).toBe("transfer");
    setActorForTests(USR.caio);
    await campaigns.confirmPayment(sale.id, { paymentMethod: "pix" });
    setActorForTests(USR.pedro);
    await expect(campaigns.updateSale(sale.id, { paymentMethod: "cash" })).rejects.toThrow(/venda já paga/);
    expect(stored(sale.id)).toMatchObject({ status: "paid", paymentMethod: "pix", confirmedById: USR.caio });
    setActorForTests(USR.caio);
    expect((await campaigns.updateSale(sale.id, { paymentMethod: "cash" })).paymentMethod).toBe("cash");
  });
});

describe("módulo desativado nas configurações", () => {
  it("como no servidor, recusa a consulta das vendas e as operações (nada de dados dos compradores)", async () => {
    const sale = (await campaigns.listSales(CMP.kit)).find((s) => s.status !== "cancelled" && s.buyer)!;
    expect(sale.buyer).not.toBeNull();
    getDB().settings.modules.campaigns = false;
    for (const call of [
      () => campaigns.listSales(CMP.kit),
      () => campaigns.listAllSales(),
      () => campaigns.get(CMP.kit),
      () => campaigns.update(CMP.kit, { prize: "Outro prêmio" }),
      () => campaigns.registerSale(CMP.kit, { numbers: [firstAvailable(CMP.kit)], buyerName: BUYER, buyerContact: CONTACT, sellerId: USR.rebeca, status: "pending", paymentMethod: "pix" }),
      () => campaigns.updateSale(sale.id, { notes: "Ajuste" }),
      () => campaigns.cancelSale(sale.id, "Teste"),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "unavailable", message: "Este módulo está desativado nas configurações." });
    }
    expect(stored(sale.id).notes).not.toBe("Ajuste");
    getDB().settings.modules.campaigns = true;
    expect((await campaigns.listSales(CMP.kit)).length).toBeGreaterThan(0);
  });
});

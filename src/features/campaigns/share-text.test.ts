import { describe, expect, it } from "vitest";
import type { Campaign, NumberSlot, Sale } from "@/types";
import { chargeText, freeNumbersText, saleConfirmationText } from "./share-text";

const campaign = { name: "Rifa do Kit", prize: "Kit completo", unitPrice: 500, quantity: 100, drawDate: "2026-11-20" } as Campaign;
const slots = [
  { number: 3, status: "available" },
  { number: 1, status: "paid" },
  { number: 12, status: "available" },
] as NumberSlot[];

describe("mensagens da rifa", () => {
  it("lista só os números livres, sem dados de compradores", () => {
    const text = freeNumbersText(campaign, slots);
    expect(text).toContain("Números disponíveis (2)");
    expect(text).toContain("003, 012");
    expect(text).not.toContain("001");
    expect(text).toContain("R$");
  });

  it("avisa quando tudo foi vendido", () => {
    expect(freeNumbersText(campaign, [{ number: 1, status: "paid" } as NumberSlot])).toContain("Todos os números já foram vendidos");
  });

  it("cobrança cita os números, o valor e o primeiro nome", () => {
    const sale = { numbers: [12, 7], buyer: { name: "Maria Souza", contact: "" } } as unknown as Sale;
    const text = chargeText(campaign, sale);
    expect(text).toContain("Oi, Maria!");
    expect(text).toContain("dos números *007, 012*");
    expect(text).toMatch(/R\$\s?10,00/);
  });

  it("confirmação muda conforme a situação do pagamento", () => {
    expect(saleConfirmationText(campaign, { numbers: [5], status: "paid", buyer: { name: "Ana", contact: "" } })).toContain("Pagamento recebido");
    expect(saleConfirmationText(campaign, { numbers: [5], status: "pending", buyer: null })).toContain("falta o pagamento");
  });
});

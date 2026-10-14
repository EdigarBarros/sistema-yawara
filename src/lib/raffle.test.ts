import { describe, expect, it } from "vitest";
import type { Sale } from "@/types";
import { buildSlots, formatNumberRanges, padNumber, parseNumberList, summarize, unavailableNumbers } from "./raffle";

function sale(partial: Partial<Sale> & Pick<Sale, "numbers" | "status">): Sale {
  return {
    id: Math.random().toString(36),
    campaignId: "c1",
    buyer: { name: "Teste", contact: "(00) 90000-0000" },
    sellerId: "u1",
    registeredById: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    history: [],
    ...partial,
  };
}

describe("padNumber", () => {
  it("usa a quantidade de dígitos do total", () => {
    expect(padNumber(7, 300)).toBe("007");
    expect(padNumber(300, 300)).toBe("300");
    expect(padNumber(5, 50)).toBe("05");
    expect(padNumber(42, 1000)).toBe("0042");
  });
});

describe("buildSlots / summarize", () => {
  const campaign = { quantity: 10, unitPrice: 1000 };
  const sales = [
    sale({ numbers: [1, 2], status: "paid" }),
    sale({ numbers: [3], status: "pending" }),
    sale({ numbers: [4], status: "reserved" }),
    sale({ numbers: [5], status: "cancelled" }),
    sale({ numbers: [6], status: "cancelled", releasedAt: "2026-01-02T00:00:00.000Z" }),
  ];

  it("gera um item por número, de 1 até a quantidade", () => {
    const slots = buildSlots(campaign, sales);
    expect(slots).toHaveLength(10);
    expect(slots[0]).toMatchObject({ number: 1, status: "paid" });
    expect(slots[2].status).toBe("pending");
    expect(slots[3].status).toBe("reserved");
    expect(slots[4].status).toBe("cancelled");
    expect(slots[5].status).toBe("available"); // cancelado e liberado
    expect(slots[9].status).toBe("available");
  });

  it("separa vendido (pendente + pago) de pago", () => {
    const s = summarize(campaign, sales);
    expect(s).toMatchObject({ total: 10, paid: 2, pending: 1, reserved: 1, cancelled: 1, available: 5, sold: 3 });
    expect(s.receivedCents).toBe(2000);
    expect(s.receivableCents).toBe(1000);
  });

  it("identifica números indisponíveis, inclusive fora do intervalo", () => {
    expect(unavailableNumbers(campaign, sales, [1, 4, 5, 6, 7, 11, 0])).toEqual([1, 4, 5, 11, 0]);
  });
});

describe("parseNumberList", () => {
  it("aceita números, intervalos e separadores variados", () => {
    expect(parseNumberList("7, 12-15 30;2")).toEqual({ numbers: [2, 7, 12, 13, 14, 15, 30], invalid: [] });
  });
  it("aponta trechos inválidos", () => {
    expect(parseNumberList("3, abc, 9-2").invalid).toEqual(["abc", "9-2"]);
  });
});

describe("formatNumberRanges", () => {
  it("agrupa sequências", () => {
    expect(formatNumberRanges([1, 2, 3, 7, 9, 10], 300)).toBe("001–003, 007, 009–010");
  });
});

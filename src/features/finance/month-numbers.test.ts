import { describe, expect, it } from "vitest";
import type { FinanceEntry } from "@/types";
import { coinTowers, formatDelta, formatMoneyDiff, monthNumbers, shiftMonth } from "./month-numbers";

const TODAY = "2026-11-20";
let n = 0;
const entry = (partial: Partial<FinanceEntry>) => ({ id: `e${++n}`, type: "income", status: "settled", amount: 10_000, date: "2026-11-05", ...partial }) as FinanceEntry;

describe("números do mês do financeiro", () => {
  it("separa o mês atual do anterior e calcula a variação", () => {
    const r = monthNumbers(
      [
        entry({ amount: 30_000 }),
        entry({ type: "expense", amount: 5_000 }),
        entry({ date: "2026-10-10", amount: 20_000 }),
        entry({ date: "2026-10-12", type: "expense", amount: 10_000 }),
      ],
      TODAY,
    );
    expect(r.current).toMatchObject({ key: "2026-11", income: 30_000, expense: 5_000, balance: 25_000 });
    expect(r.previous).toMatchObject({ key: "2026-10", income: 20_000, expense: 10_000, balance: 10_000 });
    expect(r.delta.income).toBeCloseTo(0.5);
    expect(r.delta.expense).toBeCloseTo(-0.5);
    expect(r.cash).toBe(35_000);
  });

  it("ignora cancelados e pendentes em entrou/saiu; conta vencidos", () => {
    const r = monthNumbers(
      [
        entry({ status: "cancelled", amount: 99_000 }),
        entry({ status: "pending", amount: 7_000, date: "2026-11-01" }),
        entry({ status: "pending", type: "expense", amount: 3_000, date: "2026-12-01" }),
      ],
      TODAY,
    );
    expect(r.current.income).toBe(0);
    expect(r.receivable).toBe(7_000);
    expect(r.payable).toBe(3_000);
    expect(r.overdue).toEqual({ count: 1, amount: 7_000 });
  });

  it("variação nula quando o mês anterior não teve movimento", () => {
    const r = monthNumbers([entry({})], TODAY);
    expect(r.delta.income).toBeNull();
    expect(formatDelta(r.delta.income, r.previous)).toBe("sem movimento em out/26");
    expect(formatDelta(0.123, r.previous)).toBe("+12% que out/26");
    expect(formatDelta(-0.5, r.previous)).toBe("−50% que out/26");
    expect(formatDelta(0, r.previous)).toBe("igual a out/26");
    expect(formatMoneyDiff(-131_600, r.previous)).toMatch(/^R\$\s?1,3 mil a menos que out\/26$|a menos que out\/26$/);
    expect(formatMoneyDiff(0, r.previous)).toBe("igual a out/26");
  });

  it("torres: 6 meses seguidos, inclusive os vazios, virando o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    const t = coinTowers([entry({ date: "2026-07-03", amount: 1_000 })], "2026-11-20");
    expect(t.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(t[1].income).toBe(1_000);
    expect(t[0].income).toBe(0);
  });
});

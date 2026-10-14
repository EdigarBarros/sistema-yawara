import type { FinanceEntry, FinanceSummary } from "@/types";

/** Indicadores calculados a partir dos lançamentos (cancelados não entram). */
export function summarizeFinance(entries: FinanceEntry[]): FinanceSummary {
  let income = 0;
  let expense = 0;
  let receivable = 0;
  let payable = 0;
  for (const e of entries) {
    if (e.status === "cancelled") continue;
    if (e.type === "income") {
      if (e.status === "settled") income += e.amount;
      else receivable += e.amount;
    } else {
      if (e.status === "settled") expense += e.amount;
      else payable += e.amount;
    }
  }
  return { income, expense, balance: income - expense, receivable, payable };
}

export interface MonthBucket {
  key: string; // yyyy-mm
  year: number;
  month: number; // 0-11
  income: number;
  expense: number;
}

/** Agrupa por mês (só lançamentos realizados) — usado no gráfico simples. */
export function byMonth(entries: FinanceEntry[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();
  for (const e of entries) {
    if (e.status !== "settled") continue;
    const key = e.date.slice(0, 7);
    const [y, m] = key.split("-").map(Number);
    const bucket = map.get(key) ?? { key, year: y, month: m - 1, income: 0, expense: 0 };
    if (e.type === "income") bucket.income += e.amount;
    else bucket.expense += e.amount;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

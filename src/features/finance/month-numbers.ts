/**
 * Números do mês e torres de moedas da tela do(a) Diretor(a) Financeiro(a).
 * Funções puras (testadas em month-numbers.test.ts). Só lançamentos realizados
 * entram em "entrou/saiu"; cancelados nunca entram.
 */
import type { Cents, DateOnly, FinanceEntry } from "@/types";
import { formatMoneyCompact, formatShortMonth } from "@/lib/format";
import { summarizeFinance } from "./utils";

export interface MonthMoney {
  key: string; // yyyy-mm
  year: number;
  month: number; // 0-11
  income: Cents;
  expense: Cents;
  balance: Cents;
}

export interface MonthNumbers {
  current: MonthMoney;
  previous: MonthMoney;
  /** Variação em relação ao mês anterior (fração: 0.12 = +12%). `null` quando o mês anterior foi zero. */
  delta: { income: number | null; expense: number | null; balance: number | null };
  /** Caixa: tudo que já entrou menos tudo que já saiu. */
  cash: Cents;
  receivable: Cents;
  payable: Cents;
  /** Pendentes com data já passada (a receber ou a pagar). */
  overdue: { count: number; amount: Cents };
}

/** Mês "yyyy-mm" deslocado `offset` meses. */
export function shiftMonth(key: string, offset: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyMonth(key: string): MonthMoney {
  const [y, m] = key.split("-").map(Number);
  return { key, year: y, month: m - 1, income: 0, expense: 0, balance: 0 };
}

/** Entradas e saídas realizadas por mês, para os meses pedidos (meses sem movimento ficam com zero). */
export function monthsMoney(entries: FinanceEntry[], keys: string[]): MonthMoney[] {
  const map = new Map(keys.map((k) => [k, emptyMonth(k)]));
  for (const e of entries) {
    if (e.status !== "settled") continue;
    const bucket = map.get(e.date.slice(0, 7));
    if (!bucket) continue;
    if (e.type === "income") bucket.income += e.amount;
    else bucket.expense += e.amount;
  }
  return keys.map((k) => {
    const b = map.get(k)!;
    return { ...b, balance: b.income - b.expense };
  });
}

function change(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return (now - before) / Math.abs(before);
}

export function monthNumbers(entries: FinanceEntry[], today: DateOnly): MonthNumbers {
  const key = today.slice(0, 7);
  const [previous, current] = monthsMoney(entries, [shiftMonth(key, -1), key]);
  const summary = summarizeFinance(entries);
  const overdue = entries.filter((e) => e.status === "pending" && e.date < today);
  return {
    current,
    previous,
    delta: {
      income: change(current.income, previous.income),
      expense: change(current.expense, previous.expense),
      balance: change(current.balance, previous.balance),
    },
    cash: summary.balance,
    receivable: summary.receivable,
    payable: summary.payable,
    overdue: { count: overdue.length, amount: overdue.reduce((n, e) => n + e.amount, 0) },
  };
}

/** Últimos `months` meses do calendário (o atual por último), para as torres de moedas. */
export function coinTowers(entries: FinanceEntry[], today: DateOnly, months = 6): MonthMoney[] {
  const key = today.slice(0, 7);
  const keys = Array.from({ length: months }, (_, i) => shiftMonth(key, i - (months - 1)));
  return monthsMoney(entries, keys);
}

/** Rótulo curto do mês: "out/26". */
export function monthLabel(m: Pick<MonthMoney, "year" | "month">) {
  return `${formatShortMonth(m.year, m.month)}/${String(m.year).slice(2)}`;
}

/** "+12% que set/26", "igual a set/26", "sem comparação". */
export function formatDelta(delta: number | null, previous: Pick<MonthMoney, "year" | "month">) {
  const label = monthLabel(previous);
  if (delta === null) return `sem movimento em ${label}`;
  const pct = Math.round(delta * 100);
  if (pct === 0) return `igual a ${label}`;
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% que ${label}`;
}

/** Diferença em reais contra o mês anterior: "R$ 1.316 a menos que out/26". */
export function formatMoneyDiff(diff: Cents, previous: Pick<MonthMoney, "year" | "month">) {
  const label = monthLabel(previous);
  if (diff === 0) return `igual a ${label}`;
  return `${formatMoneyCompact(Math.abs(diff))} a ${diff > 0 ? "mais" : "menos"} que ${label}`;
}

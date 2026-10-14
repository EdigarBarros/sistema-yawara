/**
 * Regras da grade de números das rifas (funções puras, testadas em raffle.test.ts).
 *
 * Um número pertence no máximo a UMA venda ativa. Venda ativa = qualquer venda
 * que não foi cancelada, ou que foi cancelada mas ainda não teve os números
 * liberados. No backend, essa garantia será reforçada com transações.
 */
import type { CampaignSummary, NumberSlot, NumberStatus, RaffleCampaign, Sale } from "@/types";

export function isSaleActive(sale: Sale) {
  return sale.status !== "cancelled" || !sale.releasedAt;
}

export function statusOfSale(sale: Sale): NumberStatus {
  return sale.status;
}

export function digitsFor(total: number) {
  return Math.max(2, String(total).length);
}

/** 7 de 300 → "007" */
export function padNumber(n: number, total: number) {
  return String(n).padStart(digitsFor(total), "0");
}

/** Mapa número → venda ativa. */
export function activeSalesByNumber(sales: Sale[]) {
  const map = new Map<number, Sale>();
  for (const sale of sales) {
    if (!isSaleActive(sale)) continue;
    for (const n of sale.numbers) map.set(n, sale);
  }
  return map;
}

export function buildSlots(campaign: Pick<RaffleCampaign, "quantity">, sales: Sale[]): NumberSlot[] {
  const byNumber = activeSalesByNumber(sales);
  const slots: NumberSlot[] = [];
  for (let n = 1; n <= campaign.quantity; n++) {
    const sale = byNumber.get(n);
    slots.push(sale ? { number: n, status: statusOfSale(sale), sale } : { number: n, status: "available" });
  }
  return slots;
}

export function summarize(campaign: Pick<RaffleCampaign, "quantity" | "unitPrice">, sales: Sale[]): CampaignSummary {
  const counts: Record<NumberStatus, number> = { available: 0, reserved: 0, pending: 0, paid: 0, cancelled: 0 };
  const byNumber = activeSalesByNumber(sales);
  for (let n = 1; n <= campaign.quantity; n++) {
    const sale = byNumber.get(n);
    counts[sale ? statusOfSale(sale) : "available"]++;
  }
  return {
    total: campaign.quantity,
    ...counts,
    sold: counts.pending + counts.paid,
    receivedCents: counts.paid * campaign.unitPrice,
    receivableCents: counts.pending * campaign.unitPrice,
  };
}

/** Números da lista que não podem ser vendidos agora (fora do intervalo ou ocupados). */
export function unavailableNumbers(campaign: Pick<RaffleCampaign, "quantity">, sales: Sale[], numbers: number[]) {
  const byNumber = activeSalesByNumber(sales);
  return numbers.filter((n) => !Number.isInteger(n) || n < 1 || n > campaign.quantity || byNumber.has(n));
}

/**
 * Interpreta a digitação de números: "7, 12-15 30" → [7,12,13,14,15,30].
 * Retorna também os trechos inválidos para exibir mensagem clara.
 */
export function parseNumberList(input: string) {
  const numbers: number[] = [];
  const invalid: string[] = [];
  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const range = token.match(/^(\d+)[-–](\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b < a || b - a > 500) {
        invalid.push(token);
        continue;
      }
      for (let n = a; n <= b; n++) numbers.push(n);
    } else if (/^\d+$/.test(token)) {
      numbers.push(Number(token));
    } else {
      invalid.push(token);
    }
  }
  return { numbers: Array.from(new Set(numbers)).sort((x, y) => x - y), invalid };
}

/** "1,2,3,7" → "001–003, 007" */
export function formatNumberRanges(numbers: number[], total: number) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    if (start !== undefined) {
      parts.push(start === prev ? padNumber(start, total) : `${padNumber(start, total)}–${padNumber(prev, total)}`);
    }
    start = n;
    prev = n;
  }
  return parts.join(", ");
}

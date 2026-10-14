/**
 * Histórico exibido em cada registro.
 *
 * É uma visão resumida para a interface (as últimas entradas). O registro
 * oficial e completo das operações é a coleção `auditLogs`, gravada na mesma
 * transação.
 */
import { randomUUID } from "node:crypto";
import type { HistoryAction, HistoryEntry } from "@/types";

/** Máximo de entradas mantidas no próprio registro (a primeira — criação — é sempre preservada). */
export const HISTORY_LIMIT = 150;

export function historyEntry(actorId: string, action: HistoryAction, summary: string, at: string): HistoryEntry {
  return { id: `hst_${randomUUID()}`, at, actorId, action, summary };
}

export function appendHistory(list: HistoryEntry[] | undefined, ...entries: HistoryEntry[]): HistoryEntry[] {
  const next = [...(list ?? []), ...entries];
  if (next.length <= HISTORY_LIMIT) return next;
  return [next[0], ...next.slice(next.length - (HISTORY_LIMIT - 1))];
}

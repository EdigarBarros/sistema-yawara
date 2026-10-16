/**
 * Códigos legíveis e sequenciais (RIFA-2026-011, EVT-2026-019, LAN-0031...).
 *
 * O contador é lido na transação e a gravação é agendada para o fim dela
 * (ctx.defer), respeitando a regra "todas as leituras antes das escritas".
 * Transações concorrentes no mesmo contador são serializadas pelo Firestore,
 * então dois registros nunca recebem o mesmo código.
 */
import type { Transaction } from "firebase-admin/firestore";
import { toDateOnly } from "@/lib/format";
import { db } from "./admin";
import type { RunContext } from "./dispatch";

export type CodePrefix = "RIFA" | "EVT" | "REU" | "LAN" | "MKT" | "ENS" | "DOC";

export async function nextCode(tx: Transaction, ctx: RunContext, prefix: CodePrefix): Promise<string> {
  // Ano no fuso da instituição (America/Sao_Paulo), não em UTC: 31/12 à noite ainda é o ano corrente.
  const year = toDateOnly(new Date(ctx.now)).slice(0, 4);
  const yearly = prefix !== "LAN";
  const ref = db.doc(`counters/${yearly ? `${prefix}-${year}` : prefix}`);
  const snap = await tx.get(ref);
  const value = ((snap.exists ? (snap.data()!.value as number) : 0) ?? 0) + 1;
  ctx.defer((t) => t.set(ref, { value, updatedAt: ctx.now }));
  return yearly ? `${prefix}-${year}-${String(value).padStart(3, "0")}` : `${prefix}-${String(value).padStart(4, "0")}`;
}

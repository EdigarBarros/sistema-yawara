/**
 * AUDITORIA
 * ---------------------------------------------------------------------------
 * Registros gravados somente pelo servidor, com identidade verificada e
 * horário do servidor. As regras do Firestore impedem qualquer gravação pelo
 * navegador; a leitura exige `audit.view`.
 *
 * Nunca registre senhas, tokens, conteúdo de arquivos ou dados pessoais além
 * do necessário (ex.: o nome de um comprador não entra na auditoria — apenas o
 * identificador da venda).
 */
import type { Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import type { AuditLogEntry, AuditOutcome, ModuleKey } from "@/types";
import { db, nowISO, timestampInDays } from "./admin";
import { AUDIT_RETENTION_DAYS, intParam } from "./params";

export interface AuditInput {
  action: string;
  module: ModuleKey | "auth";
  resourceType: string;
  resourceId: string | null;
  summary: string;
  details?: Record<string, string | number | boolean | null>;
  outcome?: AuditOutcome;
}

interface AuditActor {
  uid: string | null;
  name: string;
}

function entryData(actor: AuditActor, input: AuditInput, requestId: string | undefined, at: string): Omit<AuditLogEntry, "id"> & { expireAt: FirebaseFirestore.Timestamp } {
  return {
    at,
    actorId: actor.uid,
    actorName: actor.name,
    action: input.action,
    module: input.module,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome ?? "success",
    summary: input.summary.slice(0, 500),
    details: input.details,
    requestId,
    expireAt: timestampInDays(intParam(AUDIT_RETENTION_DAYS, 1825)),
  };
}

/** Grava a auditoria na mesma transação da operação (chame na fase de escrita). */
export function auditInTx(tx: Transaction, actor: AuditActor, input: AuditInput, requestId?: string, at = nowISO()) {
  tx.create(db.collection("auditLogs").doc(), entryData(actor, input, requestId, at));
}

/** Grava fora de transação (tentativas recusadas, eventos de sessão). Melhor esforço: falhas só vão para o log. */
export async function auditDirect(actor: AuditActor, input: AuditInput, requestId?: string) {
  try {
    await db.collection("auditLogs").add(entryData(actor, input, requestId, nowISO()));
  } catch (error) {
    logger.error("Falha ao gravar auditoria", { action: input.action, error: (error as Error).message });
  }
}

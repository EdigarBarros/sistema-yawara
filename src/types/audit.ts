import type { ID, ISODateTime } from "./common";
import type { ModuleKey } from "./organization";

export type AuditOutcome = "success" | "denied" | "failed";

/**
 * Registro de auditoria. Gravado somente pelo servidor (Cloud Functions), com
 * identidade verificada e horário do servidor. Não pode ser alterado nem
 * apagado pelos usuários.
 */
export interface AuditLogEntry {
  id: ID;
  at: ISODateTime;
  actorId: ID | null;
  /** Nome do autor no momento da operação (o cadastro pode mudar depois). */
  actorName: string;
  /** Operação no formato modulo.acao (ex.: campaigns.registerSale). */
  action: string;
  module: ModuleKey | "auth";
  resourceType: string;
  resourceId: ID | null;
  outcome: AuditOutcome;
  /** Descrição legível, sem dados pessoais desnecessários. */
  summary: string;
  details?: Record<string, string | number | boolean | null>;
  requestId?: string;
}

export interface AuditQuery {
  module?: ModuleKey | "auth";
  actorId?: ID;
  resourceId?: ID;
  outcome?: AuditOutcome;
  /** Cursor de paginação (id do último registro da página anterior). */
  after?: ID;
  pageSize?: number;
}

export interface AuditPage {
  entries: AuditLogEntry[];
  nextCursor: ID | null;
}

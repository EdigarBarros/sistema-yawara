/** Identificador de registro. No backend futuro, corresponde ao ID do documento no Firestore. */
export type ID = string;
/** Data e horário em ISO 8601 (ex.: 2026-10-14T15:32:00.000Z). */
export type ISODateTime = string;
/** Data sem horário, no formato yyyy-mm-dd. */
export type DateOnly = string;
/** Horário no formato HH:mm. */
export type TimeOnly = string;
/** Valores monetários sempre em centavos, para evitar erros de arredondamento. */
export type Cents = number;

export type HistoryAction =
  | "created"
  | "updated"
  | "status"
  | "shared"
  | "archived"
  | "restored"
  | "sale"
  | "payment"
  | "cancelled"
  | "released"
  | "closed"
  | "reopened"
  | "version"
  | "duplicated"
  | "attachment";

/** Entrada do histórico visual. Representativo nesta etapa; a auditoria real virá do backend. */
export interface HistoryEntry {
  id: ID;
  at: ISODateTime;
  actorId: ID;
  action: HistoryAction;
  summary: string;
}

/**
 * Público de um registro (quem pode ver, registrar, consultar dados etc.).
 * Os escopos disponíveis variam por contexto; ver `AUDIENCE_SCOPE_LABELS`.
 */
export type AudienceScope =
  | "department"
  | "board"
  | "directors"
  | "directors_advisors"
  | "all"
  | "roles"
  | "people";

export interface Audience {
  scope: AudienceScope;
  /** Usado quando scope = "department". */
  departmentId?: ID;
  /** Usado quando scope = "roles". */
  roleIds: ID[];
  /** Usado quando scope = "people". */
  userIds: ID[];
}

/**
 * Referência a um arquivo. Nesta etapa o conteúdo fica apenas na memória do
 * navegador (`blobId`); no backend futuro será um caminho do Firebase Storage.
 */
export interface FileRef {
  name: string;
  size: number;
  mimeType: string;
  /** Demonstração: presente quando o arquivo foi escolhido nesta sessão do navegador. */
  blobId?: string;
  /** Firebase: caminho do objeto no Cloud Storage (nunca uma URL pública). */
  path?: string;
  /**
   * Implantação gratuita com arquivos no banco: quantidade de pedaços em
   * `fileChunks/{uploadId}_{n}` (o uploadId é o início do nome no `path`).
   */
  chunks?: number;
  /** Firebase: resumo SHA-256 do conteúdo, calculado pelo servidor. */
  sha256?: string;
  /**
   * Implantação gratuita (sem Cloud Storage): link do arquivo informado pela
   * pessoa (https). Nesse caso `size` é 0 e `mimeType` é "text/uri-list".
   */
  url?: string;
}

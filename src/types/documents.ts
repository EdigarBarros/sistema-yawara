import type { Audience, FileRef, HistoryEntry, ID, ISODateTime } from "./common";

export interface DocumentCategory {
  id: ID;
  name: string;
  description?: string;
}

export type DocumentStatus = "current" | "draft" | "archived";

export interface DocumentVersion {
  version: number;
  /** `null` nos exemplos demonstrativos que não têm arquivo anexado. */
  file: FileRef | null;
  uploadedBy: ID;
  uploadedAt: ISODateTime;
  note?: string;
}

export interface DocumentLinks {
  eventId?: ID;
  meetingId?: ID;
  projectId?: ID;
}

export interface InstitutionalDocument {
  id: ID;
  name: string;
  description: string;
  categoryId: ID;
  departmentId: ID;
  access: Audience;
  status: DocumentStatus;
  /** Versões em ordem crescente. A última é a vigente; as anteriores nunca são apagadas. */
  versions: DocumentVersion[];
  links: DocumentLinks;
  /** Registro de exemplo criado pela demonstração (não é documento oficial). */
  sample: boolean;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}

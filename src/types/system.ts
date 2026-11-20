import type { Audience, ID, ISODateTime } from "./common";
import type { ModuleKey } from "./organization";

export type NotificationKind =
  | "document_shared"
  | "event_updated"
  | "campaign_closed"
  | "campaign_shared"
  | "meeting_registered"
  | "content_approved"
  | "report_shared";

/** Notificação interna demonstrativa. Nenhum e-mail ou mensagem externa é enviado. */
export interface AppNotification {
  id: ID;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: ISODateTime;
  audience: Audience;
  /** Quem gerou a notificação (não recebe a própria notificação). */
  actorId?: ID;
  readBy: ID[];
}

export interface InstitutionSettings {
  legalName: string;
  shortName: string;
  systemName: string;
  course: string;
  institution: string;
  city: string;
  email: string;
  instagram: string;
  motto: string;
}

export type ModuleToggles = Record<ModuleKey, boolean>;

export interface SystemSettings {
  institution: InstitutionSettings;
  modules: ModuleToggles;
}

export type SearchResultKind =
  | "campaign"
  | "event"
  | "document"
  | "meeting"
  | "finance"
  | "project"
  | "content"
  | "team";

export interface SearchResult {
  id: ID;
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  href: string;
  at?: ISODateTime;
}

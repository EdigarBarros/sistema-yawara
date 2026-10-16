import type { Audience, DateOnly, HistoryEntry, ID, ISODateTime, TimeOnly } from "./common";
import type { ScheduleItem } from "./events";

export type ActivityType =
  | "palestra"
  | "workshop"
  | "roda_conversa"
  | "minicurso"
  | "projeto_extensao"
  | "grupo_estudos"
  | "outro";

export type ProjectStatus = "planning" | "open" | "done" | "cancelled";

export type CertificateStatus = "not_started" | "in_progress" | "issued";

export interface Speaker {
  id: ID;
  name: string;
  affiliation: string;
  topic?: string;
}

export interface Attendee {
  id: ID;
  name: string;
  present: boolean;
}

export interface ExtensionProject {
  id: ID;
  code: string;
  name: string;
  description: string;
  objective: string;
  activityType: ActivityType;
  responsibleId: ID;
  date: DateOnly;
  time?: TimeOnly;
  location: string;
  speakers: Speaker[];
  schedule: ScheduleItem[];
  /**
   * Lista de presença (dados pessoais). Com o Firebase, só vem preenchida para
   * quem pode editar o projeto; para os demais perfis vem vazia e
   * `attendeesRestricted` = true.
   */
  attendees: Attendee[];
  /** Quantidade de inscritos — disponível mesmo quando a lista é restrita. */
  attendeeCount?: number;
  attendeesRestricted?: boolean;
  certificateStatus: CertificateStatus;
  certificateHours?: number;
  report?: string;
  documentIds: ID[];
  /** Vínculo com um evento existente, em vez de duplicá-lo. */
  eventId?: ID;
  status: ProjectStatus;
  access: Audience;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}

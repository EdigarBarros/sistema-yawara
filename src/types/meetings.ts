import type { Audience, DateOnly, HistoryEntry, ID, ISODateTime, TimeOnly } from "./common";

export type MeetingStatus = "draft" | "pending_approval" | "approved" | "archived";

export type MeetingMode = "presencial" | "online" | "hibrida";

export interface MeetingAction {
  id: ID;
  description: string;
  responsibleId?: ID;
  dueDate?: DateOnly;
}

export interface Meeting {
  id: ID;
  code: string;
  title: string;
  date: DateOnly;
  startTime: TimeOnly;
  endTime?: TimeOnly;
  mode: MeetingMode;
  location: string;
  participantIds: ID[];
  /** Participantes externos (convidados sem conta na Central). Apenas nomes. */
  guests?: string[];
  /** Evento relacionado, quando a reunião trata de um evento. */
  eventId?: ID;
  agenda: string[];
  summary: string;
  decisions: string[];
  actions: MeetingAction[];
  documentIds: ID[];
  access: Audience;
  status: MeetingStatus;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}

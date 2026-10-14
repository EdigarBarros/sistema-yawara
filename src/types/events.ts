import type { Audience, Cents, DateOnly, HistoryEntry, ID, ISODateTime, TimeOnly } from "./common";

export type EventType =
  | "festa"
  | "esportivo"
  | "academico"
  | "integracao"
  | "arrecadacao"
  | "projeto"
  | "outro";

export type EventStatus = "planning" | "confirmed" | "done" | "cancelled";

export type TaskStatus = "todo" | "doing" | "blocked" | "done";

export interface EventTask {
  id: ID;
  title: string;
  description?: string;
  responsibleId?: ID;
  departmentId: ID;
  dueDate?: DateOnly;
  status: TaskStatus;
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ScheduleItem {
  id: ID;
  time: TimeOnly;
  title: string;
  description?: string;
}

export interface Supplier {
  id: ID;
  name: string;
  service: string;
  contact?: string;
  status: "quoted" | "hired" | "declined";
}

export interface AtleticaEvent {
  id: ID;
  code: string;
  name: string;
  description: string;
  objective: string;
  type: EventType;
  date: DateOnly;
  time: TimeOnly;
  location: string;
  departmentId: ID;
  responsibleIds: ID[];
  notes?: string;
  access: Audience;
  status: EventStatus;
  /** Orçamento previsto (planejamento). Não é copiado na duplicação. */
  budget?: Cents;
  schedule: ScheduleItem[];
  tasks: EventTask[];
  suppliers: Supplier[];
  duplicatedFromId?: ID;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}

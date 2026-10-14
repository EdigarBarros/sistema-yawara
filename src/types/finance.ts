import type { Audience, Cents, DateOnly, FileRef, HistoryEntry, ID, ISODateTime } from "./common";
import type { PaymentMethod } from "./campaigns";

export type EntryType = "income" | "expense";

/** pending = a receber / a pagar · settled = recebido / pago · cancelled = cancelado. */
export type EntryStatus = "pending" | "settled" | "cancelled";

export interface FinanceCategory {
  id: ID;
  name: string;
  type: EntryType;
}

export interface FinanceEntry {
  id: ID;
  code: string;
  type: EntryType;
  description: string;
  categoryId: ID;
  amount: Cents;
  date: DateOnly;
  responsibleId: ID;
  departmentId: ID;
  eventId?: ID;
  campaignId?: ID;
  paymentMethod?: PaymentMethod;
  status: EntryStatus;
  receipt?: FileRef;
  notes?: string;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}

export interface FinanceSummary {
  income: Cents;
  expense: Cents;
  balance: Cents;
  receivable: Cents;
  payable: Cents;
}

export interface SharedReportInput {
  title: string;
  description: string;
  access: Audience;
}

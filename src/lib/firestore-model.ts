/**
 * MODELO DE DADOS NO FIRESTORE
 * ---------------------------------------------------------------------------
 * Converte os tipos do aplicativo nos documentos gravados (e de volta).
 * Usado pelas Cloud Functions (únicas que gravam), pelo seed dos emuladores
 * e pelos testes — assim o formato é um só.
 *
 * Convenções (ver docs/backend/modelo-de-dados.md):
 *  - O id do documento é o id do registro (não é repetido dentro dele).
 *  - Datas de negócio: texto ISO 8601 (UTC) gerado pelo servidor.
 *  - `readers`: marcadores de público (src/lib/record-readers.ts).
 *  - Dados pessoais ficam em documentos separados, com público próprio:
 *    comprador de uma venda → campaigns/{id}/buyers/{saleId};
 *    lista de presença → projects/{id}/private/attendance.
 */
import type {
  AtleticaEvent,
  Attendee,
  Campaign,
  CampaignSummary,
  ContentItem,
  ExtensionProject,
  FileRef,
  FinanceEntry,
  InstitutionalDocument,
  Meeting,
  Sale,
} from "@/types";
import { isSaleActive, summarize } from "./raffle";
import { buyerReaders, campaignReaders, contentReaders, documentReaders, eventReaders, meetingReaders, projectEditors, projectReaders } from "./record-readers";

export const COLLECTIONS = {
  campaigns: "campaigns",
  events: "events",
  documents: "documents",
  meetings: "meetings",
  financeEntries: "financeEntries",
  contents: "contents",
  projects: "projects",
} as const;

type WithoutId<T> = Omit<T, "id">;

function withoutId<T extends { id: string }>(record: T): WithoutId<T> {
  const { id: _id, ...rest } = record;
  void _id;
  return rest;
}

/* ------------------------------- campanhas ------------------------------ */

/** Contagem de números por situação, mantida pelo servidor a cada operação. */
export type CampaignStats = Pick<CampaignSummary, "reserved" | "pending" | "paid" | "cancelled">;

export function campaignStats(campaign: Pick<Campaign, "quantity" | "unitPrice">, sales: Sale[]): CampaignStats {
  const s = summarize(campaign, sales);
  return { reserved: s.reserved, pending: s.pending, paid: s.paid, cancelled: s.cancelled };
}

export type CampaignDoc = WithoutId<Campaign> & { readers: string[]; stats: CampaignStats };

export function campaignDoc(c: Campaign, stats: CampaignStats): CampaignDoc {
  return { ...withoutId(c), readers: campaignReaders(c), stats };
}

/** Parte pública da venda (sem nome, contato, observações ou comprovante). */
export type SalePublicDoc = Omit<Sale, "id" | "buyer" | "notes" | "receipt">;

/** Dados pessoais e internos da venda, com público próprio (`readers`). */
export interface SaleBuyerDoc {
  name: string;
  contact: string;
  notes?: string;
  receipt?: FileRef;
  sellerId: string;
  registeredById: string;
  readers: string[];
}

export function salePublicDoc(sale: Sale): SalePublicDoc {
  const { id: _id, buyer: _b, notes: _n, receipt: _r, ...rest } = sale;
  void _id;
  void _b;
  void _n;
  void _r;
  return rest;
}

export function saleBuyerDoc(campaign: Campaign, sale: Sale): SaleBuyerDoc {
  return {
    name: sale.buyer?.name ?? "",
    contact: sale.buyer?.contact ?? "",
    notes: sale.notes,
    receipt: sale.receipt,
    sellerId: sale.sellerId,
    registeredById: sale.registeredById,
    readers: buyerReaders(campaign, sale),
  };
}

/** Junta as duas partes. `buyer` = null quando o perfil não pode ver os dados pessoais. */
export function saleFromDocs(id: string, pub: SalePublicDoc, buyer: SaleBuyerDoc | null): Sale {
  return {
    ...pub,
    id,
    buyer: buyer ? { name: buyer.name, contact: buyer.contact } : null,
    notes: buyer?.notes,
    receipt: buyer?.receipt,
  };
}

/** Id do documento-trava de um número (único dentro da campanha). */
export function numberDocId(n: number) {
  return String(n).padStart(5, "0");
}

/** Trava de número: existe enquanto o número pertence a uma venda ativa. */
export interface NumberLockDoc {
  saleId: string;
  status: Sale["status"];
}

export function numberLocks(sale: Sale): { id: string; data: NumberLockDoc }[] {
  if (!isSaleActive(sale)) return [];
  return sale.numbers.map((n) => ({ id: numberDocId(n), data: { saleId: sale.id, status: sale.status } }));
}

/* -------------------------------- eventos ------------------------------- */

export type EventDoc = WithoutId<AtleticaEvent> & { readers: string[] };

export function eventDoc(e: AtleticaEvent): EventDoc {
  return { ...withoutId(e), readers: eventReaders(e) };
}

/* ------------------------------ documentos ------------------------------ */

export type DocumentDoc = WithoutId<InstitutionalDocument> & { readers: string[] };

export function documentDoc(d: InstitutionalDocument): DocumentDoc {
  return { ...withoutId(d), readers: documentReaders(d) };
}

/* ------------------------------- reuniões ------------------------------- */

export type MeetingDoc = WithoutId<Meeting> & { readers: string[] };

export function meetingDoc(m: Meeting): MeetingDoc {
  return { ...withoutId(m), readers: meetingReaders(m) };
}

/* ------------------------------ financeiro ------------------------------ */

/** Lançamentos não têm público por registro: o acesso é pela permissão `finance.view`. */
export type FinanceEntryDoc = WithoutId<FinanceEntry> & { receiptHistory?: FileRef[] };

export function financeEntryDoc(f: FinanceEntry): FinanceEntryDoc {
  return withoutId(f);
}

/* ------------------------------- marketing ------------------------------ */

export type ContentDoc = WithoutId<ContentItem> & { readers: string[] };

export function contentDoc(c: ContentItem): ContentDoc {
  return { ...withoutId(c), readers: contentReaders(c) };
}

/* --------------------------- ensino e extensão -------------------------- */

export type ProjectDoc = Omit<WithoutId<ExtensionProject>, "attendees" | "attendeesRestricted"> & { readers: string[]; attendeeCount: number };

export interface AttendanceDoc {
  attendees: Attendee[];
  /** Criador e responsável (além de quem tem extension.edit/admin). */
  editors: string[];
}

export function projectDocs(p: ExtensionProject): { project: ProjectDoc; attendance: AttendanceDoc } {
  const { attendees, attendeesRestricted: _r, ...rest } = withoutId(p);
  void _r;
  return {
    project: { ...rest, attendeeCount: attendees.length, readers: projectReaders(p) },
    attendance: { attendees, editors: projectEditors(p) },
  };
}

/** `attendance` = null quando o perfil não pode ver a lista de presença. */
export function projectFromDocs(id: string, project: Omit<ProjectDoc, "readers">, attendance: Pick<AttendanceDoc, "attendees"> | null): ExtensionProject {
  return {
    ...project,
    id,
    attendees: attendance?.attendees ?? [],
    attendeeCount: project.attendeeCount,
    attendeesRestricted: !attendance,
  };
}

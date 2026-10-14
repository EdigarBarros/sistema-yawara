import type { Audience, Cents, DateOnly, FileRef, HistoryEntry, ID, ISODateTime } from "./common";

/**
 * Modalidades de campanha. Nesta etapa apenas "raffle" (rifa) está implementada;
 * a união discriminada permite adicionar "bingo" sem quebrar as telas existentes.
 */
export type CampaignKind = "raffle";

export type CampaignStatus = "active" | "closed";

export interface CampaignAccess {
  /** Quem pode visualizar a campanha. */
  view: Audience;
  /** Quem pode registrar vendas. */
  sell: Audience;
  /** Quem pode consultar nome e contato dos compradores. */
  buyerData: Audience;
}

interface CampaignBase {
  id: ID;
  kind: CampaignKind;
  code: string;
  name: string;
  description: string;
  prize: string;
  status: CampaignStatus;
  departmentId: ID;
  access: CampaignAccess;
  /** Evento relacionado (opcional). */
  eventId?: ID;
  notes?: string;
  startDate?: DateOnly;
  endDate?: DateOnly;
  drawDate?: DateOnly;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedBy: ID;
  updatedAt: ISODateTime;
  closedAt?: ISODateTime;
  closedBy?: ID;
  history: HistoryEntry[];
}

export interface RaffleCampaign extends CampaignBase {
  kind: "raffle";
  /** Quantidade de números; a grade é gerada de 1 até este valor. */
  quantity: number;
  unitPrice: Cents;
}

export type Campaign = RaffleCampaign;

/** Situação de uma venda (aplica-se a todos os números da venda). */
export type SaleStatus = "reserved" | "pending" | "paid" | "cancelled";

export type PaymentMethod = "pix" | "cash" | "card" | "transfer" | "other";

export interface Buyer {
  name: string;
  contact: string;
}

export interface Sale {
  id: ID;
  campaignId: ID;
  numbers: number[];
  /** `null` quando o perfil atual não pode consultar os dados pessoais do comprador. */
  buyer: Buyer | null;
  sellerId: ID;
  registeredById: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  status: SaleStatus;
  paymentMethod?: PaymentMethod;
  paidAt?: ISODateTime;
  confirmedById?: ID;
  receipt?: FileRef;
  notes?: string;
  cancelledAt?: ISODateTime;
  cancelledById?: ID;
  cancelReason?: string;
  /** Quando preenchido, os números da venda cancelada voltaram a ficar disponíveis. */
  releasedAt?: ISODateTime;
  releasedById?: ID;
  history: HistoryEntry[];
}

/** Situação exibida para cada número da grade. */
export type NumberStatus = "available" | "reserved" | "pending" | "paid" | "cancelled";

export interface NumberSlot {
  number: number;
  status: NumberStatus;
  sale?: Sale;
}

export interface CampaignSummary {
  total: number;
  available: number;
  reserved: number;
  pending: number;
  paid: number;
  cancelled: number;
  /** Vendidos = pendentes + pagos. Reservas não contam como venda. */
  sold: number;
  receivedCents: Cents;
  receivableCents: Cents;
}

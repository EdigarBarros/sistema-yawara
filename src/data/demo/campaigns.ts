import type { ID, PaymentMethod, RaffleCampaign, Sale, SaleStatus } from "@/types";
import { audience, h, type Clock, type Rng } from "./helpers";
import { DEP, ROLE, USR } from "./organization";

/** Nomes inventados para compradores. Combinações aleatórias, sem relação com pessoas reais. */
const FIRST = ["Alice", "Bernardo", "Camila", "Daniel", "Eduarda", "Felipe", "Giovana", "Heitor", "Isadora", "João", "Kátia", "Leonardo", "Manuela", "Nicolas", "Olívia", "Rafael", "Sara", "Thiago", "Valentina", "Yasmin", "Arthur", "Beatriz", "Clara", "Enzo", "Lara", "Miguel", "Laura", "Vitor"];
const LAST = ["Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Freitas", "Gomes", "Henriques", "Lacerda", "Macedo", "Nogueira", "Pacheco", "Queiroz", "Ribeiro", "Siqueira", "Tavares", "Vasconcelos", "Xavier"];

export const CMP = {
  kit: "cmp-kit-interatletica",
  chocolate: "cmp-cesta-chocolates",
  vip: "cmp-ingresso-vip",
  boasVindas: "cmp-boas-vindas",
  moletom: "cmp-moletom",
} as const;

function fakeContact(rng: Rng) {
  // DDD 00 não existe: deixa claro que o contato é fictício.
  return `(00) 9${rng.int(1000, 9999)}-${rng.int(1000, 9999)}`;
}

interface SaleGenOptions {
  campaignId: ID;
  quantity: number;
  /** Fração aproximada dos números ocupados (0–1). */
  fill: number;
  /** Probabilidades acumuladas para pago / pendente / reservado / cancelado. */
  mix: { paid: number; pending: number; reserved: number; cancelled: number };
  sellers: ID[];
  confirmers: ID[];
  startDay: number;
  endDay: number;
}

let saleSeq = 0;

function generateSales(rng: Rng, clock: Clock, opts: SaleGenOptions): Sale[] {
  const sales: Sale[] = [];
  const target = Math.round(opts.quantity * opts.fill);
  const taken = new Set<number>();
  let attempts = 0;
  while (taken.size < target && attempts < opts.quantity * 10) {
    attempts++;
    const size = rng.pick([1, 1, 1, 2, 2, 3, 4]);
    const start = rng.int(1, opts.quantity);
    const numbers: number[] = [];
    for (let n = start; n < start + size && n <= opts.quantity; n++) {
      if (taken.has(n)) break;
      numbers.push(n);
    }
    if (numbers.length === 0) continue;
    numbers.forEach((n) => taken.add(n));

    const r = rng.next();
    const { paid, pending, reserved } = opts.mix;
    const status: SaleStatus = r < paid ? "paid" : r < paid + pending ? "pending" : r < paid + pending + reserved ? "reserved" : "cancelled";
    const day = rng.int(opts.startDay, opts.endDay);
    const createdAt = clock.at(day, rng.int(9, 21), rng.int(0, 59));
    const sellerId = rng.pick(opts.sellers);
    const registeredById = rng.next() < 0.8 ? sellerId : rng.pick(opts.sellers);
    const method: PaymentMethod = rng.pick(["pix", "pix", "pix", "cash", "transfer"] as const);
    const buyerName = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    saleSeq += 1;
    const id = `sale-seed-${saleSeq}`;
    const history = [h(createdAt, registeredById, status === "reserved" ? "status" : "sale", status === "reserved" ? "Reserva registrada" : "Venda registrada")];
    const sale: Sale = {
      id,
      campaignId: opts.campaignId,
      numbers,
      buyer: { name: buyerName, contact: fakeContact(rng) },
      sellerId,
      registeredById,
      createdAt,
      updatedAt: createdAt,
      status,
      paymentMethod: status === "paid" || status === "pending" ? method : undefined,
      history,
    };
    if (status === "paid") {
      const paidAt = clock.at(Math.min(day + rng.int(0, 2), 0), rng.int(9, 21), rng.int(0, 59));
      const confirmer = rng.pick(opts.confirmers);
      sale.paidAt = paidAt;
      sale.confirmedById = confirmer;
      sale.updatedAt = paidAt;
      history.push(h(paidAt, confirmer, "payment", `Pagamento confirmado (${method === "cash" ? "dinheiro" : method === "transfer" ? "transferência" : "Pix"})`));
    }
    if (status === "cancelled") {
      const cancelledAt = clock.at(Math.min(day + 1, 0), 18, 10);
      sale.status = "cancelled";
      sale.paymentMethod = undefined;
      sale.cancelledAt = cancelledAt;
      sale.cancelledById = opts.confirmers[0];
      sale.cancelReason = "Comprador desistiu antes do pagamento";
      sale.updatedAt = cancelledAt;
      history.push(h(cancelledAt, opts.confirmers[0], "cancelled", "Venda cancelada: comprador desistiu antes do pagamento"));
    }
    sales.push(sale);
  }
  return sales;
}

export function buildCampaigns(clock: Clock): RaffleCampaign[] {
  const base = {
    kind: "raffle" as const,
    notes: undefined,
  };
  return [
    {
      ...base,
      id: CMP.kit,
      code: "RIFA-2026-007",
      name: "Rifa do Kit Interatlética",
      description: "Arrecadação para custear a inscrição e o transporte da delegação nos Jogos Interatléticas.",
      prize: "Kit Interatlética completo: camisa, short, meião e caneca oficial",
      status: "active",
      departmentId: DEP.presidencia,
      quantity: 300,
      unitPrice: 1000,
      startDate: clock.date(-20),
      endDate: clock.date(40),
      drawDate: clock.date(45),
      access: { view: audience.all(), sell: audience.directorsAdvisors(), buyerData: audience.board() },
      createdBy: USR.rebeca,
      createdAt: clock.at(-20, 15, 32),
      updatedBy: USR.rebeca,
      updatedAt: clock.at(-18, 10, 5),
      history: [
        h(clock.at(-20, 15, 32), USR.rebeca, "created", "Campanha criada com 300 números a R$ 10,00"),
        h(clock.at(-18, 10, 5), USR.rebeca, "shared", "Vendas liberadas para diretores e assessores"),
      ],
    },
    {
      ...base,
      id: CMP.chocolate,
      code: "RIFA-2026-008",
      name: "Rifa Cesta de Chocolates",
      description: "Ação da Semana do Psicólogo para arrecadar fundos para o coffee break das palestras.",
      prize: "Cesta com chocolates artesanais e caneca da Atlética",
      status: "active",
      departmentId: DEP.eventos,
      quantity: 200,
      unitPrice: 500,
      startDate: clock.date(-10),
      endDate: clock.date(4),
      drawDate: clock.date(5),
      access: { view: audience.all(), sell: audience.all(), buyerData: audience.roles(ROLE.eventos, ROLE.financeiro, ROLE.presidente) },
      createdBy: USR.bruno,
      createdAt: clock.at(-10, 11, 20),
      updatedBy: USR.bruno,
      updatedAt: clock.at(-10, 11, 20),
      history: [h(clock.at(-10, 11, 20), USR.bruno, "created", "Campanha criada com 200 números a R$ 5,00")],
    },
    {
      ...base,
      id: CMP.vip,
      code: "RIFA-2026-009",
      name: "Rifa do Ingresso VIP — Calourada",
      description: "Campanha interna da diretoria para antecipar o caixa da Calourada.",
      prize: "Dois ingressos VIP para a Calourada 2026.2",
      status: "active",
      departmentId: DEP.financeiro,
      quantity: 150,
      unitPrice: 1500,
      startDate: clock.date(-6),
      endDate: clock.date(10),
      drawDate: clock.date(11),
      notes: "Campanha restrita: visível apenas para presidência, financeiro e eventos.",
      access: {
        view: audience.roles(ROLE.presidente, ROLE.vice, ROLE.financeiro, ROLE.eventos),
        sell: audience.directors(),
        buyerData: audience.people(USR.caio),
      },
      createdBy: USR.caio,
      createdAt: clock.at(-6, 9, 45),
      updatedBy: USR.caio,
      updatedAt: clock.at(-6, 9, 45),
      history: [h(clock.at(-6, 9, 45), USR.caio, "created", "Campanha criada com 150 números a R$ 15,00")],
    },
    {
      ...base,
      id: CMP.boasVindas,
      code: "RIFA-2026-004",
      name: "Rifa de Boas-vindas 2026.1",
      description: "Rifa de recepção aos calouros do primeiro semestre.",
      prize: "Caneca, bandana e adesivos oficiais",
      status: "closed",
      departmentId: DEP.eventos,
      quantity: 100,
      unitPrice: 1000,
      startDate: clock.date(-120),
      endDate: clock.date(-90),
      drawDate: clock.date(-88),
      access: { view: audience.all(), sell: audience.directorsAdvisors(), buyerData: audience.board() },
      createdBy: USR.bruno,
      createdAt: clock.at(-120, 14, 0),
      updatedBy: USR.rebeca,
      updatedAt: clock.at(-89, 18, 30),
      closedAt: clock.at(-89, 18, 30),
      closedBy: USR.rebeca,
      history: [
        h(clock.at(-120, 14, 0), USR.bruno, "created", "Campanha criada com 100 números a R$ 10,00"),
        h(clock.at(-89, 18, 30), USR.rebeca, "closed", "Campanha encerrada para novas vendas"),
      ],
    },
    {
      ...base,
      id: CMP.moletom,
      code: "RIFA-2026-010",
      name: "Rifa do Moletom Oficial",
      description: "Divulgação da nova coleção: o prêmio é o primeiro moletom da coleção.",
      prize: "Moletom oficial Yawara (tamanho à escolha)",
      status: "active",
      departmentId: DEP.marketing,
      quantity: 250,
      unitPrice: 800,
      startDate: clock.date(-3),
      endDate: clock.date(30),
      drawDate: clock.date(32),
      access: { view: audience.all(), sell: audience.directorsAdvisors(), buyerData: audience.roles(ROLE.marketing, ROLE.financeiro, ROLE.presidente) },
      createdBy: USR.livia,
      createdAt: clock.at(-3, 16, 10),
      updatedBy: USR.livia,
      updatedAt: clock.at(-3, 16, 10),
      history: [h(clock.at(-3, 16, 10), USR.livia, "created", "Campanha criada com 250 números a R$ 8,00")],
    },
  ];
}

export function buildSales(rng: Rng, clock: Clock): Sale[] {
  const sellersAll = [USR.pedro, USR.lucas, USR.julia, USR.davi, USR.bruno, USR.livia, USR.caio, USR.rebeca, USR.anabia];
  return [
    ...generateSales(rng, clock, {
      campaignId: CMP.kit, quantity: 300, fill: 0.62,
      mix: { paid: 0.78, pending: 0.15, reserved: 0.04, cancelled: 0.03 },
      sellers: sellersAll, confirmers: [USR.caio, USR.davi], startDay: -18, endDay: 0,
    }),
    ...generateSales(rng, clock, {
      campaignId: CMP.chocolate, quantity: 200, fill: 0.48,
      mix: { paid: 0.6, pending: 0.28, reserved: 0.08, cancelled: 0.04 },
      sellers: [USR.bruno, USR.pedro, USR.lucas, USR.helena, USR.marina], confirmers: [USR.caio, USR.bruno], startDay: -9, endDay: 0,
    }),
    ...generateSales(rng, clock, {
      campaignId: CMP.vip, quantity: 150, fill: 0.35,
      mix: { paid: 0.55, pending: 0.4, reserved: 0.05, cancelled: 0 },
      sellers: [USR.caio, USR.bruno, USR.rebeca], confirmers: [USR.caio], startDay: -5, endDay: 0,
    }),
    ...generateSales(rng, clock, {
      campaignId: CMP.boasVindas, quantity: 100, fill: 1,
      mix: { paid: 1, pending: 0, reserved: 0, cancelled: 0 },
      sellers: [USR.bruno, USR.pedro, USR.lucas, USR.julia], confirmers: [USR.caio], startDay: -118, endDay: -91,
    }),
    ...generateSales(rng, clock, {
      campaignId: CMP.moletom, quantity: 250, fill: 0.12,
      mix: { paid: 0.5, pending: 0.35, reserved: 0.15, cancelled: 0 },
      sellers: [USR.livia, USR.julia, USR.pedro], confirmers: [USR.caio], startDay: -3, endDay: 0,
    }),
  ];
}

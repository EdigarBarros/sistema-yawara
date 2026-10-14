import type { EntryStatus, EntryType, FinanceCategory, FinanceEntry, PaymentMethod } from "@/types";
import { h, type Clock } from "./helpers";
import { DEP, USR } from "./organization";
import { EVT } from "./events";
import { CMP } from "./campaigns";

export const FCAT = {
  rifas: "fcat-rifas",
  ingressos: "fcat-ingressos",
  patrocinio: "fcat-patrocinio",
  produtos: "fcat-produtos",
  doacoes: "fcat-doacoes",
  outrasReceitas: "fcat-outras-receitas",
  locacao: "fcat-locacao",
  materiais: "fcat-materiais",
  impressao: "fcat-impressao",
  alimentacao: "fcat-alimentacao",
  transporte: "fcat-transporte",
  servicos: "fcat-servicos",
  taxas: "fcat-taxas",
  outrasDespesas: "fcat-outras-despesas",
} as const;

export function buildFinanceCategories(): FinanceCategory[] {
  return [
    { id: FCAT.rifas, name: "Rifas e campanhas", type: "income" },
    { id: FCAT.ingressos, name: "Ingressos de eventos", type: "income" },
    { id: FCAT.patrocinio, name: "Patrocínios e parcerias", type: "income" },
    { id: FCAT.produtos, name: "Venda de produtos", type: "income" },
    { id: FCAT.doacoes, name: "Doações", type: "income" },
    { id: FCAT.outrasReceitas, name: "Outras receitas", type: "income" },
    { id: FCAT.locacao, name: "Locação de espaço", type: "expense" },
    { id: FCAT.materiais, name: "Materiais e insumos", type: "expense" },
    { id: FCAT.impressao, name: "Impressão e brindes", type: "expense" },
    { id: FCAT.alimentacao, name: "Alimentação", type: "expense" },
    { id: FCAT.transporte, name: "Transporte", type: "expense" },
    { id: FCAT.servicos, name: "Serviços de terceiros", type: "expense" },
    { id: FCAT.taxas, name: "Taxas e tarifas", type: "expense" },
    { id: FCAT.outrasDespesas, name: "Outras despesas", type: "expense" },
  ];
}

interface Row {
  type: EntryType;
  description: string;
  categoryId: string;
  amount: number; // em reais
  day: number;
  status: EntryStatus;
  departmentId: string;
  responsibleId: string;
  method?: PaymentMethod;
  eventId?: string;
  campaignId?: string;
  receipt?: boolean;
  notes?: string;
}

export function buildFinanceEntries(clock: Clock): FinanceEntry[] {
  const rows: Row[] = [
    { type: "income", description: "Arrecadação — Rifa de Boas-vindas 2026.1", categoryId: FCAT.rifas, amount: 980, day: -88, status: "settled", departmentId: DEP.eventos, responsibleId: USR.caio, method: "pix", campaignId: CMP.boasVindas, receipt: true },
    { type: "income", description: "Ingressos — Arraiá da Psico", categoryId: FCAT.ingressos, amount: 3200, day: -109, status: "settled", departmentId: DEP.eventos, responsibleId: USR.caio, method: "pix", eventId: EVT.junina, receipt: true },
    { type: "expense", description: "Decoração e fogos de artifício — Arraiá", categoryId: FCAT.materiais, amount: 860, day: -112, status: "settled", departmentId: DEP.eventos, responsibleId: USR.bruno, method: "pix", eventId: EVT.junina, receipt: true },
    { type: "expense", description: "Sonorização — Arraiá", categoryId: FCAT.servicos, amount: 700, day: -110, status: "settled", departmentId: DEP.eventos, responsibleId: USR.bruno, method: "transfer", eventId: EVT.junina },
    { type: "income", description: "Patrocínio — parceiro de exemplo (1ª parcela)", categoryId: FCAT.patrocinio, amount: 1500, day: -75, status: "settled", departmentId: DEP.financeiro, responsibleId: USR.caio, method: "transfer", receipt: true },
    { type: "expense", description: "Confecção de camisetas da diretoria", categoryId: FCAT.impressao, amount: 1180, day: -70, status: "settled", departmentId: DEP.marketing, responsibleId: USR.livia, method: "pix", receipt: true },
    { type: "income", description: "Venda de canecas e bandanas", categoryId: FCAT.produtos, amount: 640, day: -55, status: "settled", departmentId: DEP.marketing, responsibleId: USR.davi, method: "cash" },
    { type: "expense", description: "Tarifa bancária mensal", categoryId: FCAT.taxas, amount: 29.9, day: -45, status: "settled", departmentId: DEP.financeiro, responsibleId: USR.davi, method: "other" },
    { type: "income", description: "Bazar Solidário — vendas", categoryId: FCAT.doacoes, amount: 1240, day: -20, status: "settled", departmentId: DEP.eventos, responsibleId: USR.davi, method: "cash", eventId: EVT.bazar, receipt: true },
    { type: "expense", description: "Sacolas e etiquetas — Bazar", categoryId: FCAT.materiais, amount: 95.5, day: -22, status: "settled", departmentId: DEP.eventos, responsibleId: USR.lucas, method: "pix", eventId: EVT.bazar },
    { type: "expense", description: "Repasse à instituição parceira — Bazar", categoryId: FCAT.outrasDespesas, amount: 400, day: -18, status: "settled", departmentId: DEP.financeiro, responsibleId: USR.caio, method: "transfer", eventId: EVT.bazar, notes: "Repasse combinado de parte da renda (exemplo)." },
    { type: "expense", description: "Tarifa bancária mensal", categoryId: FCAT.taxas, amount: 29.9, day: -15, status: "settled", departmentId: DEP.financeiro, responsibleId: USR.davi, method: "other" },
    { type: "income", description: "Patrocínio — parceiro de exemplo (2ª parcela)", categoryId: FCAT.patrocinio, amount: 1500, day: -8, status: "settled", departmentId: DEP.financeiro, responsibleId: USR.caio, method: "transfer", receipt: true },
    { type: "expense", description: "Sinal do espaço — Calourada", categoryId: FCAT.locacao, amount: 1500, day: -4, status: "settled", departmentId: DEP.eventos, responsibleId: USR.bruno, method: "transfer", eventId: EVT.calourada, receipt: true },
    { type: "expense", description: "Saldo do espaço — Calourada", categoryId: FCAT.locacao, amount: 1500, day: 10, status: "pending", departmentId: DEP.eventos, responsibleId: USR.bruno, method: "transfer", eventId: EVT.calourada },
    { type: "expense", description: "Sonorização e iluminação — Calourada", categoryId: FCAT.servicos, amount: 1200, day: 11, status: "pending", departmentId: DEP.eventos, responsibleId: USR.bruno, eventId: EVT.calourada },
    { type: "income", description: "Ingressos 1º lote — Calourada (previsão)", categoryId: FCAT.ingressos, amount: 4000, day: 12, status: "pending", departmentId: DEP.eventos, responsibleId: USR.caio, eventId: EVT.calourada },
    { type: "expense", description: "Impressão de banners — Semana do Psicólogo", categoryId: FCAT.impressao, amount: 210, day: -2, status: "settled", departmentId: DEP.extensao, responsibleId: USR.marina, method: "pix", eventId: EVT.semanaPsi, receipt: true },
    { type: "expense", description: "Coffee break — Semana do Psicólogo", categoryId: FCAT.alimentacao, amount: 380, day: 5, status: "pending", departmentId: DEP.extensao, responsibleId: USR.marina, eventId: EVT.semanaPsi },
    { type: "expense", description: "Prêmio — Kit Interatlética", categoryId: FCAT.materiais, amount: 260, day: -19, status: "settled", departmentId: DEP.presidencia, responsibleId: USR.rebeca, method: "pix", campaignId: CMP.kit, receipt: true },
    { type: "expense", description: "Prêmio — Cesta de chocolates", categoryId: FCAT.materiais, amount: 140, day: -9, status: "settled", departmentId: DEP.eventos, responsibleId: USR.bruno, method: "cash", campaignId: CMP.chocolate },
    { type: "expense", description: "Inscrição nos Jogos Interatléticas", categoryId: FCAT.taxas, amount: 600, day: 20, status: "pending", departmentId: DEP.esportes, responsibleId: USR.gabriel, eventId: EVT.interatletica },
    { type: "expense", description: "Material esportivo (bolas e coletes)", categoryId: FCAT.materiais, amount: 450, day: -30, status: "cancelled", departmentId: DEP.esportes, responsibleId: USR.gabriel, notes: "Compra cancelada: material doado por parceiro (exemplo)." },
    { type: "income", description: "Repasse de vendas — Rifa do Kit (parcial)", categoryId: FCAT.rifas, amount: 800, day: -6, status: "settled", departmentId: DEP.financeiro, responsibleId: USR.davi, method: "pix", campaignId: CMP.kit, notes: "Valor depositado pelos vendedores até a data (exemplo)." },
  ];

  return rows.map((r, index) => {
    const seq = index + 1;
    const createdAt = clock.at(Math.min(r.day, 0) - 1, 10 + (seq % 8), (seq * 7) % 60);
    const code = `LAN-${String(seq).padStart(4, "0")}`;
    const entry: FinanceEntry = {
      id: `fin-seed-${seq}`,
      code,
      type: r.type,
      description: r.description,
      categoryId: r.categoryId,
      amount: Math.round(r.amount * 100),
      date: clock.date(r.day),
      responsibleId: r.responsibleId,
      departmentId: r.departmentId,
      eventId: r.eventId,
      campaignId: r.campaignId,
      paymentMethod: r.method,
      status: r.status,
      receipt: r.receipt ? { name: `comprovante-${code.toLowerCase()}.pdf`, size: 84_000, mimeType: "application/pdf" } : undefined,
      notes: r.notes,
      createdBy: r.responsibleId,
      createdAt,
      updatedAt: createdAt,
      history: [h(createdAt, r.responsibleId, "created", `${r.type === "income" ? "Receita" : "Despesa"} registrada`)],
    };
    if (r.status === "settled") {
      entry.history.push(h(clock.at(Math.min(r.day, 0), 18, 0), USR.caio, "payment", r.type === "income" ? "Recebimento confirmado" : "Pagamento confirmado"));
    }
    if (r.status === "cancelled") {
      entry.history.push(h(clock.at(Math.min(r.day, 0) + 1, 9, 0), USR.caio, "cancelled", "Lançamento cancelado"));
    }
    return entry;
  });
}

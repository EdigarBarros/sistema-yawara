/**
 * Campanhas (rifas) no modo Firebase.
 *
 * LEITURAS (Firestore, com regras de segurança):
 *  - campanhas: `listVisible` (filtro por `readers`, ou tudo para campaigns.admin);
 *  - vendas: parte pública em `campaigns/{id}/sales` + dados do comprador em
 *    `campaigns/{id}/buyers`, consultados com o filtro por `readers` (o
 *    navegador só recebe os compradores que o perfil pode ver). Os dois lados
 *    são juntados com `saleFromDocs`; sem acesso, `buyer` vem `null`.
 *
 * ESCRITAS: Cloud Function `campaignsApi` (transação, travas por número,
 * auditoria). `takeRequestId()` é sempre a primeira linha.
 *
 * As operações de venda recebem só o id da venda; o id da campanha vem do
 * cadastro das vendas já carregadas nesta sessão (a tela sempre lista as
 * vendas antes de agir sobre elas) e é conferido pelo servidor.
 */
import { collection, doc, getDocs, onSnapshot, query, where, type Firestore, type QuerySnapshot, type Unsubscribe } from "firebase/firestore";
import { saleFromDocs, type SaleBuyerDoc, type SalePublicDoc } from "@/lib/firestore-model";
import type { AccessSnapshot, Campaign, ID, Sale } from "@/types";
import type { CampaignService, CampaignUpdateInput } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { fromSnap, mapFirestoreError } from "./convert";
import { uploadFile } from "./files";
import { getVisible, listVisible } from "./queries";
import { hasPerm, useFirebaseSession, whenAccess } from "./session";

/** Venda → campanha (preenchido pelas listagens e respostas desta sessão). */
const saleCampaign = new Map<ID, ID>();

function remember<T extends Sale | Sale[]>(value: T): T {
  for (const s of Array.isArray(value) ? value : [value]) saleCampaign.set(s.id, s.campaignId);
  return value;
}

function campaignOf(saleId: ID): ID {
  const campaignId = saleCampaign.get(saleId);
  if (!campaignId) throw new ServiceError("not_found", "Venda não encontrada nesta tela. Atualize a página e tente novamente.");
  return campaignId;
}

/** Ids viram parte do caminho do documento: recusa barras e caracteres estranhos. */
function safeId(id: ID, label: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError("not_found", `${label} não encontrado(a).`);
  return id;
}

function withoutStats(c: Campaign & { stats?: unknown }): Campaign {
  const { stats: _stats, ...rest } = c;
  void _stats;
  return rest;
}

/** Consulta dos compradores permitida pelas regras (null = o perfil não vê nenhum comprador). */
function buyersQuery(access: AccessSnapshot, campaignId: ID) {
  if (!hasPerm(access, "campaigns.view")) return null;
  const base = collection(firebase().db, `campaigns/${campaignId}/buyers`);
  if (hasPerm(access, "campaigns.admin")) return base;
  const tokens = access.tokens.slice(0, 30);
  if (tokens.length === 0) return null;
  return query(base, where("readers", "array-contains-any", tokens));
}

function mergeSales(sales: QuerySnapshot, buyers: QuerySnapshot | null): Sale[] {
  const buyerMap = new Map((buyers?.docs ?? []).map((d) => [d.id, fromSnap<SaleBuyerDoc>(d)]));
  return sales.docs.map((d) => {
    const { id, ...pub } = fromSnap<SalePublicDoc & { id: string }>(d);
    return saleFromDocs(id, pub, buyerMap.get(id) ?? null);
  });
}

async function listSalesOf(campaignId: ID): Promise<Sale[]> {
  safeId(campaignId, "Campanha");
  const access = await whenAccess();
  if (!hasPerm(access, "campaigns.view")) throw new ServiceError("forbidden", "Seu perfil não pode ver campanhas.");
  const { db } = firebase();
  const bq = buyersQuery(access, campaignId);
  try {
    const [sales, buyers] = await Promise.all([getDocs(collection(db, `campaigns/${campaignId}/sales`)), bq ? getDocs(bq) : Promise.resolve(null)]);
    return remember(mergeSales(sales, buyers));
  } catch (error) {
    throw mapFirestoreError(error, "As vendas desta campanha não estão disponíveis para o seu perfil.");
  }
}

/** Datas, observações e evento apagados na edição viajam como null (undefined some no envio). */
const CLEARABLE: (keyof CampaignUpdateInput)[] = ["startDate", "endDate", "drawDate", "notes", "eventId"];

function updatePayload(input: CampaignUpdateInput) {
  const payload: Record<string, unknown> = { ...input };
  for (const key of CLEARABLE) {
    if (key in input && (input[key] === undefined || input[key] === "")) payload[key] = null;
  }
  return payload;
}

export const firebaseCampaigns: CampaignService = {
  async list() {
    const campaigns = await listVisible<Campaign & { stats?: unknown }>("campaigns", "campaigns");
    return campaigns.map(withoutStats);
  },

  async get(id) {
    safeId(id, "Campanha");
    return withoutStats(await getVisible<Campaign & { stats?: unknown }>(`campaigns/${id}`, "Campanha"));
  },

  listSales: listSalesOf,

  async listAllSales() {
    const campaigns = await firebaseCampaigns.list();
    const all = await Promise.all(campaigns.map((c) => listSalesOf(c.id)));
    return all.flat();
  },

  subscribe(campaignId, onChange) {
    const access = useFirebaseSession.getState().access;
    if (!access || !hasPerm(access, "campaigns.view") || !/^[A-Za-z0-9_-]{1,128}$/.test(campaignId)) return () => undefined;
    let db: Firestore;
    try {
      db = firebase().db;
    } catch {
      return () => undefined;
    }
    // Agrupa avisos próximos (uma venda muda campanha, venda e comprador ao mesmo tempo).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const notifyChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, 150);
    };
    /** O primeiro retrato de cada escuta é o estado que a tela já carregou: só as mudanças seguintes avisam. */
    const changesOnly = (start: (next: () => void) => Unsubscribe): Unsubscribe => {
      let first = true;
      return start(() => {
        if (first) {
          first = false;
          return;
        }
        notifyChange();
      });
    };
    const ignoreError = () => undefined;
    const stops = [
      changesOnly((next) => onSnapshot(doc(db, `campaigns/${campaignId}`), next, ignoreError)),
      changesOnly((next) => onSnapshot(collection(db, `campaigns/${campaignId}/sales`), next, ignoreError)),
    ];
    const bq = buyersQuery(access, campaignId);
    if (bq) stops.push(changesOnly((next) => onSnapshot(bq, next, ignoreError)));
    return () => {
      if (timer) clearTimeout(timer);
      for (const stop of stops) stop();
    };
  },

  async create(input) {
    const rid = takeRequestId();
    return callApi<Campaign>("campaigns", "create", input, rid);
  },

  async update(id, input) {
    const rid = takeRequestId();
    return callApi<Campaign>("campaigns", "update", { id, input: updatePayload(input) }, rid);
  },

  async close(id) {
    const rid = takeRequestId();
    return callApi<Campaign>("campaigns", "close", { id }, rid);
  },

  async reopen(id) {
    const rid = takeRequestId();
    return callApi<Campaign>("campaigns", "reopen", { id }, rid);
  },

  async registerSale(campaignId, input) {
    const rid = takeRequestId();
    return remember(await callApi<Sale>("campaigns", "registerSale", { campaignId, ...input }, rid));
  },

  async updateSale(saleId, input) {
    const rid = takeRequestId();
    return remember(await callApi<Sale>("campaigns", "updateSale", { campaignId: campaignOf(saleId), saleId, input }, rid));
  },

  async setSaleStatus(saleId, status) {
    const rid = takeRequestId();
    return remember(await callApi<Sale>("campaigns", "setSaleStatus", { campaignId: campaignOf(saleId), saleId, status }, rid));
  },

  async confirmPayment(saleId, input) {
    const rid = takeRequestId();
    const campaignId = campaignOf(saleId);
    const uploadId = input.receipt ? await uploadFile("saleReceipt", input.receipt, { targetId: saleId }) : undefined;
    return remember(await callApi<Sale>("campaigns", "confirmPayment", { campaignId, saleId, paymentMethod: input.paymentMethod, uploadId }, rid));
  },

  async revertPayment(saleId, reason) {
    const rid = takeRequestId();
    return remember(await callApi<Sale>("campaigns", "revertPayment", { campaignId: campaignOf(saleId), saleId, reason }, rid));
  },

  async cancelSale(saleId, reason) {
    const rid = takeRequestId();
    return remember(await callApi<Sale>("campaigns", "cancelSale", { campaignId: campaignOf(saleId), saleId, reason }, rid));
  },

  async releaseSale(saleId) {
    const rid = takeRequestId();
    return remember(await callApi<Sale>("campaigns", "releaseSale", { campaignId: campaignOf(saleId), saleId }, rid));
  },
};

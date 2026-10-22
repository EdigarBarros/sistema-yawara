import type { CampaignInput, CampaignService, SaleInput } from "../contracts";
import type { Campaign, Sale } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import type { AccessContext } from "@/lib/permissions";
import { formatNumberRanges, isSaleActive, unavailableNumbers } from "@/lib/raffle";
import { formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { newId } from "@/lib/utils";
import { commit, getDB } from "./db";
import { storeFile } from "./blob-store";
import {
  accessContext,
  clone,
  findOrThrow,
  historyEntry,
  latency,
  nextCode,
  now,
  pushNotification,
  requireModuleEnabled,
  requirePermission,
  sanitizeAudience,
  ServiceError,
  validateAudience,
} from "./context";
import { canChangePaymentMethod, canChangeSeller, canEditSale, canManageCampaign, canSeeBuyer, canSeeCampaign, canSellIn } from "@/lib/policies";

/* ------------------------- regras de permissão ------------------------- */

/* ------------------------------- helpers ------------------------------- */

/** Como no servidor: com o módulo desativado, nenhuma consulta ou operação de campanha é atendida. */
function visibleCampaign(db: DemoDB, ctx: AccessContext, id: string) {
  requireModuleEnabled(db, "campaigns");
  const campaign = findOrThrow(db.campaigns, id, "Campanha");
  if (!canSeeCampaign(ctx, campaign)) {
    throw new ServiceError("forbidden", "Esta campanha não está disponível para o seu perfil.");
  }
  return campaign;
}

/** Como no servidor: comprador e motivos em texto livre (podem citá-lo) só para quem vê os dados do comprador. */
function redact(ctx: AccessContext, campaign: Campaign, sale: Sale): Sale {
  const copy = clone(sale);
  if (!canSeeBuyer(ctx, campaign, sale)) {
    copy.buyer = null;
    copy.cancelReason = undefined;
    copy.revertReason = undefined;
  }
  return copy;
}

/** Responsável pela venda (novo ou trocado): ativo e autorizado a vender nesta campanha (mesma regra do servidor). */
function requireEligibleSeller(db: DemoDB, campaign: Campaign, sellerId: string) {
  const user = db.members.find((m) => m.id === sellerId);
  if (!user || user.status !== "active") throw new ServiceError("invalid", "Escolha um responsável pela venda que esteja ativo.");
  const role = db.roles.find((r) => r.id === user.roleId);
  const ctx: AccessContext | null = role ? { user, role, department: db.departments.find((d) => d.id === role.departmentId) } : null;
  if (!ctx || !canSellIn(ctx, campaign)) throw new ServiceError("invalid", "Escolha um responsável que possa registrar vendas nesta campanha.");
}

function saleWithCampaign(db: DemoDB, ctx: AccessContext, saleId: string) {
  requireModuleEnabled(db, "campaigns");
  const sale = findOrThrow(db.sales, saleId, "Venda");
  const campaign = visibleCampaign(db, ctx, sale.campaignId);
  return { sale, campaign };
}

function numbersLabel(campaign: Campaign, numbers: number[]) {
  return formatNumberRanges(numbers, campaign.quantity);
}

function validateCampaignInput(input: Partial<CampaignInput>, creating: boolean) {
  if (creating || input.name !== undefined) {
    if (!input.name || input.name.trim().length < 3) throw new ServiceError("invalid", "Informe o nome da campanha (mínimo de 3 caracteres).");
  }
  if (creating || input.prize !== undefined) {
    if (!input.prize || input.prize.trim().length < 3) throw new ServiceError("invalid", "Informe o prêmio ou item oferecido.");
  }
  if (creating) {
    if (!Number.isInteger(input.quantity) || input.quantity! < 2 || input.quantity! > 10000) {
      throw new ServiceError("invalid", "A quantidade de números deve ser um número inteiro entre 2 e 10.000.");
    }
    if (!Number.isInteger(input.unitPrice) || input.unitPrice! <= 0) {
      throw new ServiceError("invalid", "Informe um valor unitário maior que zero.");
    }
  }
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new ServiceError("invalid", "A data de encerramento não pode ser anterior à data de início.");
  }
  if (input.startDate && input.drawDate && input.drawDate < input.startDate) {
    throw new ServiceError("invalid", "A data do sorteio não pode ser anterior à data de início.");
  }
  if (input.access) {
    validateAudience(input.access.view, "Quem pode visualizar");
    validateAudience(input.access.sell, "Quem pode registrar vendas");
    validateAudience(input.access.buyerData, "Quem pode consultar dados dos compradores");
  }
}

/** Evento relacionado (opcional): precisa existir. */
function validateEventLink(db: DemoDB, eventId: string | undefined) {
  if (eventId && !db.events.some((e) => e.id === eventId)) {
    throw new ServiceError("invalid", "O evento relacionado não foi encontrado ou não está disponível para o seu perfil.");
  }
}

function validateSaleInput(db: DemoDB, campaign: Campaign, input: SaleInput, sales: Sale[]) {
  if (input.numbers.length === 0) throw new ServiceError("invalid", "Selecione pelo menos um número.");
  const blocked = unavailableNumbers(campaign, sales, input.numbers);
  if (blocked.length > 0) {
    const outOfRange = blocked.filter((n) => n < 1 || n > campaign.quantity);
    if (outOfRange.length > 0) {
      throw new ServiceError("invalid", `Números fora da campanha (1 a ${campaign.quantity}): ${outOfRange.join(", ")}.`);
    }
    throw new ServiceError(
      "conflict",
      `Estes números já não estão disponíveis: ${numbersLabel(campaign, blocked)}. Atualize a seleção e tente novamente.`,
      { numbers: blocked },
    );
  }
  if (!input.buyerName || input.buyerName.trim().length < 2) throw new ServiceError("invalid", "Informe o nome do comprador.");
  // Contato opcional (vendas antigas podem não ter telefone); quando preenchido, precisa ser válido.
  if (input.buyerContact?.trim() && input.buyerContact.trim().length < 5) throw new ServiceError("invalid", "Informe um contato válido (telefone ou e-mail).");
  requireEligibleSeller(db, campaign, input.sellerId);
  if (input.status === "paid" && !input.paymentMethod) throw new ServiceError("invalid", "Informe a forma de pagamento.");
}

/* ------------------------------- serviço ------------------------------- */

export const localCampaigns: CampaignService = {
  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "campaigns");
    const ctx = accessContext(db);
    return clone(db.campaigns.filter((c) => canSeeCampaign(ctx, c)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    const ctx = accessContext(db);
    return clone(visibleCampaign(db, ctx, id));
  },

  async listSales(campaignId) {
    await latency(120, 260);
    const db = getDB();
    const ctx = accessContext(db);
    const campaign = visibleCampaign(db, ctx, campaignId);
    return db.sales.filter((s) => s.campaignId === campaignId).map((s) => redact(ctx, campaign, s));
  },

  async listAllSales() {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "campaigns");
    const ctx = accessContext(db);
    const visible = new Map(db.campaigns.filter((c) => canSeeCampaign(ctx, c)).map((c) => [c.id, c]));
    return db.sales.filter((s) => visible.has(s.campaignId)).map((s) => redact(ctx, visible.get(s.campaignId)!, s));
  },

  async create(input) {
    await latency(300, 600);
    return commit((db) => {
      requireModuleEnabled(db, "campaigns");
      const ctx = accessContext(db);
      requirePermission(ctx, "campaigns.create", "Seu perfil não pode criar campanhas.");
      validateCampaignInput(input, true);
      validateEventLink(db, input.eventId);
      const at = now();
      const campaign: Campaign = {
        id: newId("cmp"),
        kind: "raffle",
        code: nextCode(db, "RIFA"),
        name: input.name.trim(),
        description: input.description.trim(),
        prize: input.prize.trim(),
        status: "active",
        departmentId: ctx.role.departmentId,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        drawDate: input.drawDate || undefined,
        startDate: input.startDate || undefined,
        endDate: input.endDate || undefined,
        notes: input.notes?.trim() || undefined,
        eventId: input.eventId || undefined,
        access: {
          view: sanitizeAudience(input.access.view),
          sell: sanitizeAudience(input.access.sell),
          buyerData: sanitizeAudience(input.access.buyerData),
        },
        createdBy: ctx.user.id,
        createdAt: at,
        updatedBy: ctx.user.id,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", `Campanha criada com ${input.quantity} números a ${formatMoney(input.unitPrice)}`)],
      };
      db.campaigns.unshift(campaign);
      pushNotification(db, {
        kind: "campaign_shared",
        title: "Nova campanha disponível",
        body: `${ctx.user.name} criou “${campaign.name}”.`,
        href: `/campanhas/${campaign.id}`,
        audience: campaign.access.view,
        actorId: ctx.user.id,
      });
      return clone(campaign);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const campaign = visibleCampaign(db, ctx, id);
      if (!canManageCampaign(ctx, campaign)) throw new ServiceError("forbidden", "Seu perfil não pode editar esta campanha.");
      validateCampaignInput({ ...input }, false);
      if (input.eventId !== campaign.eventId) validateEventLink(db, input.eventId);
      const accessChanged = input.access && JSON.stringify(input.access) !== JSON.stringify(campaign.access);
      Object.assign(campaign, {
        ...input,
        name: input.name?.trim() ?? campaign.name,
        prize: input.prize?.trim() ?? campaign.prize,
        access: input.access
          ? { view: sanitizeAudience(input.access.view), sell: sanitizeAudience(input.access.sell), buyerData: sanitizeAudience(input.access.buyerData) }
          : campaign.access,
        updatedBy: ctx.user.id,
        updatedAt: now(),
      });
      campaign.history.push(historyEntry(ctx.user.id, "updated", "Dados da campanha editados"));
      if (accessChanged) campaign.history.push(historyEntry(ctx.user.id, "shared", "Configuração de acesso e permissões alterada"));
      return clone(campaign);
    });
  },

  async close(id) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const campaign = visibleCampaign(db, ctx, id);
      if (campaign.createdBy !== ctx.user.id) requirePermission(ctx, "campaigns.archive", "Seu perfil não pode encerrar campanhas.");
      if (campaign.status === "closed") throw new ServiceError("conflict", "A campanha já está encerrada.");
      const at = now();
      Object.assign(campaign, { status: "closed", closedAt: at, closedBy: ctx.user.id, updatedAt: at, updatedBy: ctx.user.id });
      campaign.history.push(historyEntry(ctx.user.id, "closed", "Campanha encerrada para novas vendas"));
      pushNotification(db, {
        kind: "campaign_closed",
        title: "Campanha encerrada",
        body: `“${campaign.name}” foi encerrada para novas vendas.`,
        href: `/campanhas/${campaign.id}`,
        audience: campaign.access.view,
        actorId: ctx.user.id,
      });
      return clone(campaign);
    });
  },

  async reopen(id) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const campaign = visibleCampaign(db, ctx, id);
      if (campaign.createdBy !== ctx.user.id) requirePermission(ctx, "campaigns.archive", "Seu perfil não pode reabrir campanhas.");
      if (campaign.status === "active") throw new ServiceError("conflict", "A campanha já está ativa.");
      Object.assign(campaign, { status: "active", closedAt: undefined, closedBy: undefined, updatedAt: now(), updatedBy: ctx.user.id });
      campaign.history.push(historyEntry(ctx.user.id, "reopened", "Campanha reaberta para vendas"));
      return clone(campaign);
    });
  },

  async registerSale(campaignId, input) {
    await latency(250, 500);
    return commit((db) => {
      const ctx = accessContext(db);
      const campaign = visibleCampaign(db, ctx, campaignId);
      if (campaign.status !== "active") throw new ServiceError("conflict", "Esta campanha está encerrada e não aceita novas vendas.");
      if (!canSellIn(ctx, campaign)) throw new ServiceError("forbidden", "Seu perfil não está autorizado a registrar vendas nesta campanha.");
      if (input.status === "paid") {
        requirePermission(ctx, "campaigns.approve", "Seu perfil não pode registrar uma venda já como paga. Registre como pendente; quem confirma recebimentos fará a confirmação.");
      }
      const sales = db.sales.filter((s) => s.campaignId === campaignId);
      const numbers = [...new Set(input.numbers)].sort((a, b) => a - b);
      validateSaleInput(db, campaign, { ...input, numbers }, sales);
      const at = now();
      const label = numbersLabel(campaign, numbers);
      const sale: Sale = {
        id: newId("sale"),
        campaignId,
        numbers,
        buyer: { name: input.buyerName.trim(), contact: input.buyerContact?.trim() ?? "" },
        sellerId: input.sellerId,
        registeredById: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        status: input.status,
        paymentMethod: input.status === "reserved" ? undefined : input.paymentMethod,
        notes: input.notes?.trim() || undefined,
        history: [
          historyEntry(
            ctx.user.id,
            input.status === "reserved" ? "status" : "sale",
            input.status === "reserved" ? `Reserva registrada (${label})` : `Venda registrada (${label})`,
          ),
        ],
      };
      if (input.status === "paid") {
        sale.paidAt = at;
        sale.confirmedById = ctx.user.id;
        sale.history.push(historyEntry(ctx.user.id, "payment", `Pagamento confirmado no registro (${PAYMENT_METHOD_LABELS[input.paymentMethod!]})`));
      }
      db.sales.push(sale);
      campaign.updatedAt = at;
      return redact(ctx, campaign, sale);
    });
  },

  async updateSale(saleId, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const { sale, campaign } = saleWithCampaign(db, ctx, saleId);
      if (!canEditSale(ctx, sale)) throw new ServiceError("forbidden", "Seu perfil não pode editar esta venda.");
      if (sale.status === "cancelled") throw new ServiceError("conflict", "Vendas canceladas não podem ser editadas.");
      const changes: string[] = [];
      if ((input.buyerName !== undefined || input.buyerContact !== undefined) && !canSeeBuyer(ctx, campaign, sale)) {
        throw new ServiceError("forbidden", "Seu perfil não pode alterar os dados pessoais deste comprador.");
      }
      if (input.buyerName !== undefined && input.buyerName.trim() !== sale.buyer?.name) {
        if (input.buyerName.trim().length < 2) throw new ServiceError("invalid", "Informe o nome do comprador.");
        sale.buyer = { name: input.buyerName.trim(), contact: sale.buyer?.contact ?? "" };
        changes.push("nome do comprador");
      }
      if (input.buyerContact !== undefined && input.buyerContact.trim() !== sale.buyer?.contact) {
        if (input.buyerContact.trim() && input.buyerContact.trim().length < 5) throw new ServiceError("invalid", "Informe um contato válido.");
        sale.buyer = { name: sale.buyer?.name ?? "", contact: input.buyerContact.trim() };
        changes.push("contato");
      }
      const methodChanged = !!input.paymentMethod && input.paymentMethod !== sale.paymentMethod;
      if (methodChanged && !canChangePaymentMethod(ctx, sale)) {
        throw new ServiceError("forbidden", "Somente quem confirma recebimentos pode alterar a forma de pagamento de uma venda já paga.");
      }
      if (input.sellerId && input.sellerId !== sale.sellerId) {
        // O novo responsável passa a ver os dados do comprador: só quem já os vê transfere a venda.
        if (!canChangeSeller(ctx, campaign, sale)) throw new ServiceError("forbidden", "Seu perfil não pode transferir esta venda para outro responsável.");
        requireEligibleSeller(db, campaign, input.sellerId);
        sale.sellerId = input.sellerId;
        changes.push("responsável pela venda");
      }
      if (methodChanged) {
        sale.paymentMethod = input.paymentMethod;
        changes.push("forma de pagamento");
      }
      if (input.notes !== undefined && (input.notes.trim() || undefined) !== sale.notes) {
        sale.notes = input.notes.trim() || undefined;
        changes.push("observações");
      }
      if (changes.length === 0) return redact(ctx, campaign, sale);
      sale.updatedAt = now();
      sale.history.push(historyEntry(ctx.user.id, "updated", `Alterado: ${changes.join(", ")}`));
      return redact(ctx, campaign, sale);
    });
  },

  async setSaleStatus(saleId, status) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const { sale, campaign } = saleWithCampaign(db, ctx, saleId);
      if (!canEditSale(ctx, sale)) throw new ServiceError("forbidden", "Seu perfil não pode alterar esta venda.");
      if (sale.status === "paid" || sale.status === "cancelled") {
        throw new ServiceError("conflict", "Só é possível alternar entre reservado e pendente antes do pagamento.");
      }
      if (sale.status === status) return redact(ctx, campaign, sale);
      sale.status = status;
      sale.updatedAt = now();
      sale.history.push(
        historyEntry(ctx.user.id, "status", status === "pending" ? "Reserva convertida em venda com pagamento pendente" : "Venda voltou para reservada"),
      );
      return redact(ctx, campaign, sale);
    });
  },

  async confirmPayment(saleId, input) {
    await latency(250, 500);
    return commit((db) => {
      const ctx = accessContext(db);
      const { sale, campaign } = saleWithCampaign(db, ctx, saleId);
      requirePermission(ctx, "campaigns.approve", "Seu perfil não pode confirmar recebimentos.");
      if (sale.status === "paid") throw new ServiceError("conflict", "O pagamento desta venda já foi confirmado.");
      if (sale.status === "cancelled") throw new ServiceError("conflict", "Não é possível confirmar pagamento de uma venda cancelada.");
      const at = now();
      sale.status = "paid";
      sale.paymentMethod = input.paymentMethod;
      sale.paidAt = at;
      sale.confirmedById = ctx.user.id;
      sale.updatedAt = at;
      if (input.receipt) sale.receipt = storeFile(input.receipt);
      sale.history.push(
        historyEntry(
          ctx.user.id,
          "payment",
          `Pagamento confirmado (${PAYMENT_METHOD_LABELS[input.paymentMethod]})${input.receipt ? " com comprovante anexado" : ""}`,
        ),
      );
      return redact(ctx, campaign, sale);
    });
  },

  async revertPayment(saleId, reason) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const { sale, campaign } = saleWithCampaign(db, ctx, saleId);
      requirePermission(ctx, "campaigns.approve", "Seu perfil não pode desfazer confirmações de pagamento.");
      if (sale.status !== "paid") throw new ServiceError("conflict", "Esta venda não está marcada como paga.");
      if (!reason || reason.trim().length < 3) throw new ServiceError("invalid", "Explique o motivo para desfazer a confirmação.");
      sale.status = "pending";
      sale.paidAt = undefined;
      sale.confirmedById = undefined;
      // Texto livre (pode citar o comprador): só aparece para quem vê os dados do comprador.
      sale.revertReason = reason.trim();
      sale.updatedAt = now();
      sale.history.push(historyEntry(ctx.user.id, "payment", "Confirmação de pagamento desfeita (motivo nos dados restritos)"));
      return redact(ctx, campaign, sale);
    });
  },

  async cancelSale(saleId, reason) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const { sale, campaign } = saleWithCampaign(db, ctx, saleId);
      if (sale.status === "cancelled") throw new ServiceError("conflict", "Esta venda já está cancelada.");
      if (sale.status === "paid") {
        requirePermission(ctx, "campaigns.approve", "Vendas já pagas só podem ser canceladas por quem confirma recebimentos.");
      } else if (!canEditSale(ctx, sale)) {
        throw new ServiceError("forbidden", "Seu perfil não pode cancelar esta venda.");
      }
      if (!reason || reason.trim().length < 3) throw new ServiceError("invalid", "Informe o motivo do cancelamento.");
      const at = now();
      const wasPaid = sale.status === "paid";
      sale.status = "cancelled";
      sale.cancelledAt = at;
      sale.cancelledById = ctx.user.id;
      sale.cancelReason = reason.trim();
      sale.updatedAt = at;
      sale.history.push(historyEntry(ctx.user.id, "cancelled", `Venda cancelada${wasPaid ? " (estava paga — verificar devolução)" : ""} (motivo nos dados restritos)`));
      return redact(ctx, campaign, sale);
    });
  },

  async releaseSale(saleId) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const { sale, campaign } = saleWithCampaign(db, ctx, saleId);
      requirePermission(ctx, "campaigns.edit", "Seu perfil não pode liberar números cancelados.");
      if (sale.status !== "cancelled") throw new ServiceError("conflict", "Só é possível liberar números de vendas canceladas.");
      if (sale.releasedAt) throw new ServiceError("conflict", "Os números desta venda já foram liberados.");
      const others = db.sales.filter((s) => s.campaignId === sale.campaignId && s.id !== sale.id && isSaleActive(s));
      const clash = unavailableNumbers(campaign, others, sale.numbers);
      if (clash.length > 0) throw new ServiceError("conflict", `Os números ${numbersLabel(campaign, clash)} já estão em outra venda.`);
      sale.releasedAt = now();
      sale.releasedById = ctx.user.id;
      sale.updatedAt = sale.releasedAt;
      sale.history.push(
        historyEntry(ctx.user.id, "released", `Números ${numbersLabel(campaign, sale.numbers)} liberados para nova venda (registro cancelado mantido)`),
      );
      return redact(ctx, campaign, sale);
    });
  },
};

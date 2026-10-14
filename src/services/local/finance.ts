import type { FinanceEntryInput, FinanceService } from "../contracts";
import type { FinanceEntry } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import { hasPermission } from "@/lib/permissions";
import { entryStatusMeta, ENTRY_TYPE_LABELS } from "@/lib/labels";
import { formatMoney } from "@/lib/format";
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
  requireModuleEnabled,
  requirePermission,
  ServiceError,
} from "./context";
import { canEditEntry, canSeeEvent, canSeeEventFinance } from "@/lib/policies";

function scope(db: DemoDB) {
  requireModuleEnabled(db, "finance");
  const ctx = accessContext(db);
  requirePermission(ctx, "finance.view", "Seu perfil não tem acesso ao Financeiro.");
  return ctx;
}

function validate(db: DemoDB, input: Partial<FinanceEntryInput>, creating: boolean) {
  if (creating || input.description !== undefined) {
    if (!input.description || input.description.trim().length < 3) throw new ServiceError("invalid", "Informe uma descrição (mínimo de 3 caracteres).");
  }
  if (creating || input.amount !== undefined) {
    if (!Number.isInteger(input.amount) || input.amount! <= 0) throw new ServiceError("invalid", "Informe um valor maior que zero.");
  }
  if (creating && !input.date) throw new ServiceError("invalid", "Informe a data.");
  if (input.categoryId) {
    const cat = findOrThrow(db.financeCategories, input.categoryId, "Categoria");
    if (input.type && cat.type !== input.type) throw new ServiceError("invalid", "A categoria escolhida não corresponde ao tipo de movimentação.");
  }
}

export const localFinance: FinanceService = {
  async listCategories() {
    await latency(60, 140);
    return clone(getDB().financeCategories);
  },

  async list() {
    await latency();
    const db = getDB();
    scope(db);
    return clone(db.financeEntries);
  },

  async listForEvent(eventId) {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "finance");
    const ctx = accessContext(db);
    const event = findOrThrow(db.events, eventId, "Evento");
    if (!canSeeEvent(ctx, event) || !canSeeEventFinance(ctx, event)) {
      throw new ServiceError("forbidden", "Seu perfil não tem acesso aos dados financeiros deste evento.");
    }
    return clone(db.financeEntries.filter((e) => e.eventId === eventId));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    scope(db);
    return clone(findOrThrow(db.financeEntries, id, "Lançamento"));
  },

  async create(input, receipt) {
    await latency(300, 550);
    return commit((db) => {
      const ctx = scope(db);
      requirePermission(ctx, "finance.register", "Seu perfil não pode registrar lançamentos.");
      if (input.status === "settled") {
        requirePermission(ctx, "finance.approve", "Seu perfil não pode registrar já como recebido/pago. Registre como pendente para confirmação.");
      }
      validate(db, input, true);
      const at = now();
      const entry: FinanceEntry = {
        id: newId("fin"),
        code: nextCode(db, "LAN"),
        type: input.type,
        description: input.description.trim(),
        categoryId: input.categoryId,
        amount: input.amount,
        date: input.date,
        responsibleId: input.responsibleId,
        departmentId: input.departmentId,
        eventId: input.eventId || undefined,
        campaignId: input.campaignId || undefined,
        paymentMethod: input.paymentMethod,
        status: input.status,
        receipt: receipt ? storeFile(receipt) : undefined,
        notes: input.notes?.trim() || undefined,
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", `${ENTRY_TYPE_LABELS[input.type]} de ${formatMoney(input.amount)} registrada`)],
      };
      if (receipt) entry.history.push(historyEntry(ctx.user.id, "attachment", "Comprovante anexado (somente neste navegador)"));
      db.financeEntries.unshift(entry);
      return clone(entry);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = scope(db);
      const entry = findOrThrow(db.financeEntries, id, "Lançamento");
      if (!canEditEntry(ctx, entry)) throw new ServiceError("forbidden", "Seu perfil não pode editar este lançamento.");
      if (input.status && input.status !== entry.status) {
        throw new ServiceError("invalid", "Use a ação de confirmar/reabrir para mudar a situação.");
      }
      validate(db, { ...input, type: input.type ?? entry.type }, false);
      const amountChanged = input.amount !== undefined && input.amount !== entry.amount;
      const previous = entry.amount;
      Object.assign(entry, input, { updatedAt: now() });
      entry.history.push(
        historyEntry(ctx.user.id, "updated", amountChanged ? `Valor alterado de ${formatMoney(previous)} para ${formatMoney(entry.amount)}` : "Lançamento editado"),
      );
      return clone(entry);
    });
  },

  async setStatus(id, status, reason) {
    await latency();
    return commit((db) => {
      const ctx = scope(db);
      const entry = findOrThrow(db.financeEntries, id, "Lançamento");
      if (entry.status === status) return clone(entry);
      if (status === "cancelled") {
        requirePermission(ctx, "finance.archive", "Seu perfil não pode cancelar lançamentos.");
        if (!reason || reason.trim().length < 3) throw new ServiceError("invalid", "Informe o motivo do cancelamento.");
      } else {
        requirePermission(ctx, "finance.approve", "Seu perfil não pode confirmar ou reabrir lançamentos.");
      }
      if (entry.status === "cancelled" && status !== "pending") {
        throw new ServiceError("conflict", "Reabra o lançamento cancelado como pendente antes de confirmá-lo.");
      }
      entry.status = status;
      entry.updatedAt = now();
      const label = entryStatusMeta(entry.type, status).label;
      entry.history.push(
        historyEntry(
          ctx.user.id,
          status === "cancelled" ? "cancelled" : status === "settled" ? "payment" : "status",
          status === "cancelled" ? `Lançamento cancelado: ${reason!.trim()}` : `Situação alterada para ${label}`,
        ),
      );
      return clone(entry);
    });
  },

  async attachReceipt(id, receipt) {
    await latency(300, 600);
    return commit((db) => {
      const ctx = scope(db);
      const entry = findOrThrow(db.financeEntries, id, "Lançamento");
      if (!hasPermission(ctx, "finance.register") && !hasPermission(ctx, "finance.edit")) {
        throw new ServiceError("forbidden", "Seu perfil não pode anexar comprovantes.");
      }
      if (receipt.size > 15 * 1024 * 1024) throw new ServiceError("invalid", "O comprovante deve ter no máximo 15 MB.");
      const replaced = entry.receipt?.name;
      entry.receipt = storeFile(receipt);
      entry.updatedAt = now();
      entry.history.push(
        historyEntry(ctx.user.id, "attachment", replaced ? `Comprovante substituído (anterior: ${replaced})` : "Comprovante anexado (somente neste navegador)"),
      );
      return clone(entry);
    });
  },
};

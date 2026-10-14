import type { AppNotification, Audience, HistoryAction, HistoryEntry, ID, Permission } from "@/types";
import { getSessionUserId } from "@/stores/session";
import { hasPermission, type AccessContext } from "@/lib/permissions";
import { newId } from "@/lib/utils";
import type { DemoDB } from "@/data/demo/seed";

import { ServiceError } from "../errors";

export { ServiceError };
export type { ServiceErrorCode } from "../errors";

let actorOverride: ID | null = null;
let latencyEnabled = true;

export function setActorForTests(id: ID | null) {
  actorOverride = id;
}
export function disableLatencyForTests() {
  latencyEnabled = false;
}

export function currentActorId(): ID | null {
  return actorOverride ?? getSessionUserId();
}

/** Monta o contexto de acesso do perfil demonstrativo em uso. */
export function accessContext(db: DemoDB): AccessContext {
  const id = currentActorId();
  const user = db.members.find((m) => m.id === id);
  if (!user) throw new ServiceError("unauthenticated", "Nenhum perfil de demonstração ativo. Entre novamente.");
  const role = db.roles.find((r) => r.id === user.roleId);
  if (!role) throw new ServiceError("unauthenticated", "O cargo deste perfil não foi encontrado.");
  return { user, role, department: db.departments.find((d) => d.id === role.departmentId) };
}

export function requirePermission(ctx: AccessContext, permission: Permission, message: string) {
  if (!hasPermission(ctx, permission)) throw new ServiceError("forbidden", message);
}

export function requireModuleEnabled(db: DemoDB, module: keyof DemoDB["settings"]["modules"]) {
  if (!db.settings.modules[module]) {
    throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
  }
}

/** Atraso simulado, para que os estados de carregamento sejam visíveis na demonstração. */
export async function latency(min = 160, max = 380) {
  if (!latencyEnabled) return;
  const ms = Math.round(min + Math.random() * (max - min));
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function now() {
  return new Date().toISOString();
}

export function historyEntry(actorId: ID, action: HistoryAction, summary: string): HistoryEntry {
  return { id: newId("hst"), at: now(), actorId, action, summary };
}

export function findOrThrow<T extends { id: ID }>(items: T[], id: ID, label: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) throw new ServiceError("not_found", `${label} não encontrado(a). Ele(a) pode ter sido removido(a) ou não estar disponível para o seu perfil.`);
  return found;
}

/** Gera códigos legíveis: RIFA-2026-011. */
export function nextCode(db: DemoDB, prefix: string) {
  const n = (db.counters[prefix] ?? 0) + 1;
  db.counters[prefix] = n;
  const year = new Date().getFullYear();
  return prefix === "LAN" ? `LAN-${String(n).padStart(4, "0")}` : `${prefix}-${year}-${String(n).padStart(3, "0")}`;
}

/** Notificação interna demonstrativa (nenhum envio externo). */
export function pushNotification(
  db: DemoDB,
  data: Omit<AppNotification, "id" | "createdAt" | "readBy">,
) {
  db.notifications.unshift({ ...data, id: newId("ntf"), createdAt: now(), readBy: [] });
}

export function sanitizeAudience(audience: Audience): Audience {
  return {
    scope: audience.scope,
    departmentId: audience.scope === "department" ? audience.departmentId : undefined,
    roleIds: audience.scope === "roles" ? [...new Set(audience.roleIds)] : [],
    userIds: audience.scope === "people" ? [...new Set(audience.userIds)] : [],
  };
}

export function validateAudience(audience: Audience, label: string) {
  if (audience.scope === "roles" && audience.roleIds.length === 0) {
    throw new ServiceError("invalid", `${label}: escolha pelo menos um cargo.`);
  }
  if (audience.scope === "people" && audience.userIds.length === 0) {
    throw new ServiceError("invalid", `${label}: escolha pelo menos uma pessoa.`);
  }
}

/**
 * Regras de permissão compartilhadas.
 *
 * Na interface, decidem o que mostrar — o que NÃO é segurança. A autorização
 * efetiva é aplicada pelo servidor (Cloud Functions) e pelas regras do
 * Firestore/Storage, que usam exatamente esta mesma lógica de públicos
 * (ver src/lib/access-tokens.ts). No modo demonstração, todas as permissões
 * são simuladas no navegador.
 */
import type { Audience, Department, ID, Member, ModuleKey, Permission, Role } from "@/types";
import { audienceTokens, intersects, userTokens } from "./access-tokens";

export interface AccessContext {
  user: Member;
  role: Role;
  department: Department | undefined;
}

/**
 * Permissões privilegiadas: só podem ser concedidas por quem já as possui e
 * tem `organization.admin`. Protegem a própria estrutura de autorização.
 */
export const PRIVILEGED_PERMISSIONS: Permission[] = [
  "organization.create",
  "organization.edit",
  "organization.admin",
  "settings.edit",
  "settings.admin",
  "audit.view",
  "audit.export",
];

export function isPrivileged(permission: Permission) {
  return PRIVILEGED_PERMISSIONS.includes(permission);
}

export function hasPermission(ctx: AccessContext | null | undefined, permission: Permission) {
  if (!ctx || ctx.user.status !== "active" || !ctx.role.active) return false;
  return ctx.role.permissions.includes(permission);
}

export function canViewModule(ctx: AccessContext | null | undefined, module: ModuleKey) {
  return hasPermission(ctx, `${module}.view`);
}

/** Verifica se o usuário pertence ao público informado (mesma regra usada no servidor). */
export function matchesAudience(ctx: AccessContext, audience: Audience, fallbackDepartmentId?: ID): boolean {
  return intersects(userTokens(ctx.user, ctx.role), audienceTokens(audience, fallbackDepartmentId));
}

/**
 * Regra geral de visualização de um registro: o criador sempre vê; quem tem
 * permissão de administrar o módulo vê tudo; os demais precisam estar no público.
 */
export function canSeeRecord(
  ctx: AccessContext,
  module: ModuleKey,
  record: { access: Audience; createdBy: ID; departmentId?: ID },
) {
  if (!hasPermission(ctx, `${module}.view`)) return false;
  if (record.createdBy === ctx.user.id) return true;
  if (hasPermission(ctx, `${module}.admin`)) return true;
  return matchesAudience(ctx, record.access, record.departmentId);
}

export type Ownership = "mine" | "department" | "shared";

/** Diferencia o que é próprio do usuário/departamento do que foi compartilhado com ele. */
export function ownershipOf(ctx: AccessContext, record: { createdBy: ID; departmentId?: ID }): Ownership {
  if (record.createdBy === ctx.user.id) return "mine";
  if (record.departmentId && (record.departmentId === ctx.role.departmentId || ctx.user.departmentIds?.includes(record.departmentId))) return "department";
  return "shared";
}

export function emptyAudience(scope: Audience["scope"] = "all"): Audience {
  return { scope, roleIds: [], userIds: [] };
}

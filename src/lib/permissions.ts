/**
 * Permissões SIMULADAS.
 *
 * Estas funções decidem o que a interface mostra para cada perfil de
 * demonstração. Elas não oferecem segurança: qualquer pessoa com acesso ao
 * navegador pode alterar os dados locais. A autorização real será feita no
 * backend (regras do Firestore/Cloud Functions) na Etapa 2, reaproveitando
 * esta mesma lógica de públicos.
 */
import type { Audience, Department, ID, Member, ModuleKey, Permission, Role } from "@/types";

export interface AccessContext {
  user: Member;
  role: Role;
  department: Department | undefined;
}

export function hasPermission(ctx: AccessContext | null | undefined, permission: Permission) {
  if (!ctx || ctx.user.status !== "active" || !ctx.role.active) return false;
  return ctx.role.permissions.includes(permission);
}

export function canViewModule(ctx: AccessContext | null | undefined, module: ModuleKey) {
  return hasPermission(ctx, `${module}.view`);
}

/** Verifica se o usuário pertence ao público informado. */
export function matchesAudience(ctx: AccessContext, audience: Audience, fallbackDepartmentId?: ID): boolean {
  const { role, user } = ctx;
  if (user.status !== "active") return false;
  switch (audience.scope) {
    case "all":
      return true;
    case "board":
      return role.isBoard;
    case "directors":
      return role.level === "presidency" || role.level === "director";
    case "directors_advisors":
      return role.level === "presidency" || role.level === "director" || role.level === "advisor";
    case "department":
      return role.departmentId === (audience.departmentId ?? fallbackDepartmentId);
    case "roles":
      return audience.roleIds.includes(role.id);
    case "people":
      return audience.userIds.includes(user.id);
    default:
      return false;
  }
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
  if (record.departmentId && record.departmentId === ctx.role.departmentId) return "department";
  return "shared";
}

export function emptyAudience(scope: Audience["scope"] = "all"): Audience {
  return { scope, roleIds: [], userIds: [] };
}

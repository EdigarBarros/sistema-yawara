/**
 * Regras da área de organização usadas pela INTERFACE para não oferecer o que
 * o servidor recusaria (cargos que a pessoa não pode atribuir, permissões que
 * ela não pode conceder, integrantes que ela não pode alterar).
 *
 * Espelham as proteções de functions/src/modules/organization.ts
 * (assertCanAssignRole, assertCanManageMember, createRole, updateRole,
 * updateMember, renewInvitation). NÃO são segurança: o servidor confere tudo
 * de novo dentro da transação. A equivalência é testada em
 * functions/test/organization-ui.test.ts.
 *
 * Funções puras (sem React), usadas também nos testes das Cloud Functions.
 */
import type { ID, Invitation, InvitationStatus, Member, Permission, Role } from "@/types";
import type { Tone } from "@/lib/labels";
import { TOKEN, userTokens } from "@/lib/access-tokens";
import { hasPermission, isPrivileged, type AccessContext } from "@/lib/permissions";
import { isSupportRole, LOCK_SUPPORT } from "@/lib/support";

type Ctx = AccessContext | null | undefined;

export const LOCK_NOT_OWN = "Você só pode conceder permissões que o seu cargo tem.";
export const LOCK_PRIVILEGED = "Permissões administrativas só podem ser alteradas por quem administra permissões.";
export const LOCK_NO_ADMIN = "Somente quem administra permissões pode alterar as permissões dos cargos.";
export const LOCK_SELF_ADMIN = "Você não pode retirar do seu próprio cargo a permissão de administrar permissões.";
export const LOCK_ROLE_ABOVE = "Este cargo tem permissões que o seu não tem. Somente quem tem todas elas pode alterar o acesso dele.";
export const LOCK_MEMBER_ABOVE = "Você não pode alterar um integrante cujo cargo tem permissões que o seu não tem.";

/** Permissões da lista que a pessoa não possui. */
export function missingPermissions(ctx: Ctx, permissions: Iterable<Permission>): Permission[] {
  return [...permissions].filter((p) => !hasPermission(ctx, p));
}

export function withinOwn(ctx: Ctx, permissions: Iterable<Permission>) {
  return missingPermissions(ctx, permissions).length === 0;
}

/**
 * Alcance que um cargo dá (mais os departamentos adicionais): marcadores de
 * público de diretoria, nível e departamentos, sem os da conta e do cargo.
 */
export function roleReach(role: Role, departmentIds: ID[] = []): string[] {
  const own = new Set([TOKEN.user("_"), TOKEN.role(role.id)]);
  return userTokens({ id: "_", status: "active", departmentIds }, { ...role, active: true }).filter((t) => !own.has(t));
}

const LEVEL_RANK: Record<Role["level"], number> = { member: 0, advisor: 1, director: 2, presidency: 3 };

/**
 * O nível do cargo dá algo que o nível de `own` não dá: nível acima, ou — para
 * quem é da assessoria — outro nível com `events.edit` (a assessoria é o único
 * nível em que essa permissão não edita os dados do evento; ver
 * canEditEvent em src/lib/policies.ts).
 */
export function levelBeyond(role: Role, own: Role) {
  if (LEVEL_RANK[role.level] > LEVEL_RANK[own.level]) return true;
  return own.level === "advisor" && role.level !== "advisor" && role.permissions.includes("events.edit");
}

/**
 * O alcance do cargo (e dos departamentos adicionais) está contido no da
 * pessoa: mesmo departamento principal (as políticas usam o departamento do
 * cargo, não os adicionais), nível sem mais acesso e marcadores contidos.
 */
export function withinOwnReach(ctx: Ctx, role: Role, departmentIds: ID[] = []) {
  if (!ctx) return false;
  if (role.departmentId !== ctx.role.departmentId || levelBeyond(role, ctx.role)) return false;
  const own = new Set(userTokens(ctx.user, ctx.role));
  return roleReach(role, departmentIds).every((t) => own.has(t));
}

/**
 * Cargo que a pessoa pode atribuir (convite, renovação, troca de cargo,
 * reativação): as permissões do cargo precisam estar contidas nas dela; cargos
 * com permissões administrativas ou com alcance (diretoria, nível,
 * departamentos) que ela não tem exigem `organization.admin`.
 * `departmentIds`: departamentos adicionais concedidos junto com o cargo.
 */
export function canAssignRole(ctx: Ctx, role: Role, departmentIds: ID[] = []) {
  if (isSupportRole(role.id) && !isSupportRole(ctx?.role.id)) return false;
  if (!withinOwn(ctx, role.permissions)) return false;
  if (hasPermission(ctx, "organization.admin")) return true;
  if (role.permissions.some(isPrivileged)) return false;
  return withinOwnReach(ctx, role, departmentIds);
}

/** Cargos ativos que a pessoa pode atribuir. */
export function assignableRoles(ctx: Ctx, roles: Role[]) {
  return roles.filter((r) => r.active && canAssignRole(ctx, r));
}

/** Pode alterar o integrante (o cargo dele não tem permissões que a pessoa não tem). */
export function canManageMember(ctx: Ctx, member: Member, roles: Role[]) {
  if (!hasPermission(ctx, "organization.edit")) return false;
  const role = roles.find((r) => r.id === member.roleId);
  if (role && isSupportRole(role.id) && !isSupportRole(ctx?.role.id)) return false;
  return !role || withinOwn(ctx, role.permissions);
}

export interface MemberEditRules {
  /** Pode abrir a edição do integrante. */
  canEdit: boolean;
  /** Motivo quando não pode editar. */
  reason?: string;
  /** É a própria pessoa (não muda cargo, situação nem departamentos). */
  self: boolean;
  canChangeRole: boolean;
  canChangeStatus: boolean;
  canChangeDepartments: boolean;
}

export function memberEditRules(ctx: Ctx, member: Member, roles: Role[]): MemberEditRules {
  const self = !!ctx && ctx.user.id === member.id;
  if (!hasPermission(ctx, "organization.edit")) {
    return { canEdit: false, reason: "Seu perfil não pode editar integrantes.", self, canChangeRole: false, canChangeStatus: false, canChangeDepartments: false };
  }
  if (!canManageMember(ctx, member, roles)) {
    const reason = isSupportRole(member.roleId) ? LOCK_SUPPORT : LOCK_MEMBER_ABOVE;
    return { canEdit: false, reason, self, canChangeRole: false, canChangeStatus: false, canChangeDepartments: false };
  }
  return {
    canEdit: true,
    self,
    canChangeRole: !self,
    canChangeStatus: !self,
    canChangeDepartments: !self && hasPermission(ctx, "organization.admin"),
  };
}

/**
 * Pode alterar o que muda o alcance de acesso de um cargo (permissões, nível,
 * diretoria, departamento, situação). Sem `role`, vale para um cargo novo
 * (permissões, nível de diretoria/presidência e "faz parte da diretoria").
 */
export function canChangeRoleAccess(ctx: Ctx, role?: Role) {
  if (role && isSupportRole(role.id) && !isSupportRole(ctx?.role.id)) return false;
  if (!hasPermission(ctx, "organization.admin")) return false;
  return !role || withinOwn(ctx, role.permissions);
}

/** Motivo pelo qual o acesso do cargo inteiro não pode ser alterado (undefined = pode). */
export function roleAccessLock(ctx: Ctx, role?: Role): string | undefined {
  if (role && isSupportRole(role.id) && !isSupportRole(ctx?.role.id)) return LOCK_SUPPORT;
  if (!hasPermission(ctx, "organization.admin")) return LOCK_NO_ADMIN;
  if (role && !withinOwn(ctx, role.permissions)) return LOCK_ROLE_ABOVE;
  return undefined;
}

/**
 * Motivo pelo qual uma permissão específica não pode ser marcada ou
 * desmarcada neste cargo (undefined = pode).
 */
export function permissionLock(ctx: Ctx, role: Role | undefined, permission: Permission, checked: boolean): string | undefined {
  const whole = roleAccessLock(ctx, role);
  if (whole) return whole;
  if (isPrivileged(permission) && !hasPermission(ctx, "organization.admin")) return LOCK_PRIVILEGED;
  if (!hasPermission(ctx, permission)) return LOCK_NOT_OWN;
  if (role && ctx && role.id === ctx.role.id && permission === "organization.admin" && checked) return LOCK_SELF_ADMIN;
  return undefined;
}

/* --------------------------------- Convites -------------------------------- */

export const INVITATION_STATUS: Record<InvitationStatus, { label: string; tone: Tone }> = {
  pending: { label: "Convite pendente", tone: "warn" },
  accepted: { label: "Aceito", tone: "ok" },
  revoked: { label: "Revogado", tone: "neutral" },
  expired: { label: "Expirado", tone: "danger" },
};

/** Situação exibida para um valor desconhecido (defensivo: a lista nunca quebra). */
export function invitationStatusMeta(status: InvitationStatus) {
  return INVITATION_STATUS[status] ?? INVITATION_STATUS.pending;
}

/** Convites ainda pendentes no servidor (os expirados também podem ser renovados ou revogados). */
export function isOpenInvitation(inv: Pick<Invitation, "status">) {
  return inv.status === "pending" || inv.status === "expired";
}

/**
 * Motivo pelo qual o convite não pode ser renovado (undefined = pode).
 * `others`: os demais convites da lista — nunca há dois convites válidos para
 * o mesmo e-mail (o servidor também recusa quando o e-mail já é de um
 * integrante, o que a lista não mostra).
 */
export function renewLock(ctx: Ctx, inv: Invitation, roles: Role[], others: Invitation[] = []): string | undefined {
  if (!hasPermission(ctx, "organization.create")) return "Seu perfil não pode renovar convites.";
  if (!isOpenInvitation(inv)) return "Somente convites pendentes ou expirados podem ser renovados.";
  const role = roles.find((r) => r.id === inv.roleId);
  if (!role || !role.active) return "O cargo deste convite está desativado. Revogue e crie um novo convite.";
  if (!canAssignRole(ctx, role, inv.departmentIds ?? [])) return "Você não pode renovar um convite para um cargo com permissões ou alcance que o seu não tem.";
  if (inv.email && others.some((o) => o.id !== inv.id && o.status === "pending" && o.email === inv.email)) {
    return "Já existe outro convite pendente para esse e-mail. Use aquele convite ou revogue-o antes.";
  }
  return undefined;
}

/** Motivo pelo qual o convite não pode ser revogado (undefined = pode). */
export function revokeLock(ctx: Ctx, inv: Invitation): string | undefined {
  if (!hasPermission(ctx, "organization.create")) return "Seu perfil não pode revogar convites.";
  if (!isOpenInvitation(inv)) return "Este convite não está mais pendente.";
  return undefined;
}

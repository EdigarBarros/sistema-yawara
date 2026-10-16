/**
 * MARCADORES DE ACESSO ("tokens")
 * ------------------------------------------------------------------
 * Fonte única da regra "quem faz parte de qual público". É usada:
 *  - pela interface (para decidir o que mostrar);
 *  - pelo servidor (Cloud Functions), ao calcular o campo `readers` de cada
 *    registro e o retrato de autorização de cada integrante (`userAccess`);
 *  - indiretamente pelas regras do Firestore/Storage, que comparam
 *    `registro.readers` com `userAccess.tokens` (hasAny).
 *
 * Um integrante pertence a um público quando os marcadores dele e os do
 * público têm pelo menos um item em comum. Funções puras, sem dependências
 * de navegador ou de servidor.
 */
import type { AccessSnapshot, Audience, ID, Member, Permission, Role } from "@/types";

export const TOKEN = {
  all: "all",
  board: "board",
  directors: "directors",
  directorsAdvisors: "directors_advisors",
  user: (id: ID) => `u:${id}`,
  role: (id: ID) => `r:${id}`,
  department: (id: ID) => `d:${id}`,
} as const;

/** Limite de marcadores por integrante (consultas `array-contains-any` aceitam até 30 valores). */
export const MAX_USER_TOKENS = 30;
/** Limite de departamentos adicionais por integrante. */
export const MAX_EXTRA_DEPARTMENTS = 10;

/** Departamentos do integrante: o do cargo primeiro, depois os adicionais (sem repetição). */
export function memberDepartments(member: Pick<Member, "departmentIds">, role: Pick<Role, "departmentId">): ID[] {
  return [...new Set([role.departmentId, ...(member.departmentIds ?? [])].filter(Boolean))];
}

/** Marcadores de um integrante. Conta ou cargo desativados não pertencem a nenhum público. */
export function userTokens(member: Pick<Member, "id" | "status" | "departmentIds">, role: Pick<Role, "id" | "active" | "departmentId" | "isBoard" | "level">): string[] {
  if (member.status !== "active" || !role.active) return [];
  const tokens: string[] = [TOKEN.all, TOKEN.user(member.id), TOKEN.role(role.id)];
  for (const dep of memberDepartments(member, role)) tokens.push(TOKEN.department(dep));
  if (role.isBoard) tokens.push(TOKEN.board);
  if (role.level === "presidency" || role.level === "director") tokens.push(TOKEN.directors);
  if (role.level === "presidency" || role.level === "director" || role.level === "advisor") tokens.push(TOKEN.directorsAdvisors);
  return tokens.slice(0, MAX_USER_TOKENS);
}

/** Marcadores que representam um público. `fallbackDepartmentId` é usado quando o público é "departamento" sem departamento explícito. */
export function audienceTokens(audience: Audience, fallbackDepartmentId?: ID): string[] {
  switch (audience.scope) {
    case "all":
      return [TOKEN.all];
    case "board":
      return [TOKEN.board];
    case "directors":
      return [TOKEN.directors];
    case "directors_advisors":
      return [TOKEN.directorsAdvisors];
    case "department": {
      const dep = audience.departmentId ?? fallbackDepartmentId;
      return dep ? [TOKEN.department(dep)] : [];
    }
    case "roles":
      return audience.roleIds.map(TOKEN.role);
    case "people":
      return audience.userIds.map(TOKEN.user);
    default:
      return [];
  }
}

export function intersects(a: readonly string[], b: readonly string[]) {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((t) => set.has(t));
}

/**
 * Leitores de um registro: o público configurado + pessoas que sempre podem
 * ver (criador, responsáveis, participantes). Quem tem a permissão
 * `<módulo>.admin` vê todos os registros do módulo e não precisa constar aqui.
 */
export function readersFor(audiences: { audience: Audience; fallbackDepartmentId?: ID }[], people: (ID | undefined | null)[] = []): string[] {
  const set = new Set<string>();
  for (const { audience, fallbackDepartmentId } of audiences) for (const t of audienceTokens(audience, fallbackDepartmentId)) set.add(t);
  for (const id of people) if (id) set.add(TOKEN.user(id));
  return [...set].sort();
}

/** Retrato de autorização efetiva (gravado pelo servidor em `userAccess/{uid}`). */
export function computeAccess(
  member: Pick<Member, "id" | "status" | "departmentIds" | "roleId">,
  role: Role | undefined,
  previousVersion = 0,
  updatedAt = new Date().toISOString(),
): AccessSnapshot {
  const usable = !!role && role.active && member.status === "active";
  return {
    uid: member.id,
    status: member.status,
    roleId: member.roleId,
    level: role?.level ?? "member",
    isBoard: !!role?.isBoard,
    departmentIds: role ? memberDepartments(member, role) : [],
    permissions: usable ? ([...new Set(role!.permissions)].sort() as Permission[]) : [],
    tokens: usable ? userTokens(member, role!) : [],
    version: previousVersion + 1,
    updatedAt,
  };
}

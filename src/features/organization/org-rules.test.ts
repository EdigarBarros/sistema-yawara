import { describe, expect, it } from "vitest";
import { DEFAULT_DEPARTMENTS, DEFAULT_ROLES } from "@/data/structure/default-structure";
import type { AccessContext } from "@/lib/permissions";
import type { Invitation, Member, Role } from "@/types";
import {
  assignableRoles,
  canAssignRole,
  canChangeRoleAccess,
  INVITATION_STATUS,
  invitationStatusMeta,
  levelBeyond,
  LOCK_MEMBER_ABOVE,
  LOCK_NO_ADMIN,
  LOCK_NOT_OWN,
  LOCK_ROLE_ABOVE,
  LOCK_SELF_ADMIN,
  memberEditRules,
  permissionLock,
  renewLock,
  revokeLock,
  roleAccessLock,
  roleReach,
} from "./org-rules";
import { LOCK_SUPPORT, SUPPORT_ROLE_ID, supportRoleDefinition } from "@/lib/support";

const NOW = "2026-10-14T12:00:00.000Z";
const roles: Role[] = DEFAULT_ROLES.map((r) => ({ ...r, createdAt: NOW, updatedAt: NOW }));
const role = (id: string) => roles.find((r) => r.id === id)!;

function member(id: string, roleId: string, extra: Partial<Member> = {}): Member {
  return { id, name: id, email: "", roleId, status: "active", joinedAt: NOW, departmentIds: [], ...extra };
}

function ctxFor(id: string, roleId: string, roleOverride?: Role): AccessContext {
  const r = roleOverride ?? role(roleId);
  return { user: member(id, roleId), role: r, department: DEFAULT_DEPARTMENTS.map((d) => ({ ...d, createdAt: NOW })).find((d) => d.id === r.departmentId) };
}

const pres = ctxFor("pres", "presidente");
const vice = ctxFor("vice", "vice-presidente");
const sec = ctxFor("sec", "secretario");
/** Cargo sem `organization.admin`, mas que convida e edita integrantes. */
const managerRole: Role = {
  ...role("assessor-eventos"),
  id: "gestor",
  name: "Gestor(a)",
  permissions: ["organization.view", "organization.create", "organization.edit", "events.view", "events.edit", "campaigns.view", "campaigns.register", "documents.view"],
};
const manager = ctxFor("gestor", "gestor", managerRole);

describe("cargos que cada perfil pode atribuir", () => {
  it("presidência atribui qualquer cargo ativo", () => {
    expect(assignableRoles(pres, roles).map((r) => r.id)).toEqual(roles.map((r) => r.id));
  });

  it("vice não atribui a presidência (tem settings.admin, que ela não tem)", () => {
    expect(canAssignRole(vice, role("presidente"))).toBe(false);
    expect(canAssignRole(vice, role("vice-presidente"))).toBe(true);
  });

  it("sem organization.admin, só cargos sem permissões administrativas e contidos nas próprias", () => {
    const ids = assignableRoles(manager, [...roles, managerRole]).map((r) => r.id);
    expect(ids).toContain("assessor-eventos");
    expect(ids).not.toContain("gestor"); // tem organization.create/edit (administrativas)
    expect(ids).not.toContain("assessor-marketing"); // marketing.* que o gestor não tem
    expect(ids).not.toContain("presidente");
  });

  it("sem organization.admin, não atribui cargo de alcance maior (diretoria, nível, outro departamento)", () => {
    // Mesmas permissões do assessor de eventos (contidas nas do gestor), alcances diferentes.
    const base = role("assessor-eventos");
    const board: Role = { ...base, id: "conselho-eventos", isBoard: true };
    const director: Role = { ...base, id: "diretor-sem-diretoria", level: "director" };
    const otherDep: Role = { ...base, id: "apoio-fin", departmentId: "financeiro", level: "member" };
    const sameReach: Role = { ...base, id: "apoio-eventos", level: "member", permissions: ["events.view", "documents.view"] };
    expect(canAssignRole(manager, base)).toBe(true);
    expect(canAssignRole(manager, sameReach)).toBe(true);
    expect(canAssignRole(manager, board)).toBe(false);
    expect(canAssignRole(manager, director)).toBe(false);
    expect(canAssignRole(manager, otherDep)).toBe(false);
    // Departamentos adicionais concedidos junto com o cargo também contam.
    expect(canAssignRole(manager, sameReach, ["financeiro"])).toBe(false);
    expect(canAssignRole(manager, sameReach, ["eventos"])).toBe(true);
    // Quem administra permissões atribui qualquer alcance.
    expect(canAssignRole(pres, { ...board, permissions: ["events.view"] })).toBe(true);
    expect(roleReach(board)).toEqual(expect.arrayContaining(["board", "d:eventos", "directors_advisors"]));
    expect(roleReach(board).some((t) => t.startsWith("u:") || t.startsWith("r:"))).toBe(false);
  });

  it("sem organization.admin, não atribui nível com mais acesso nem cargo de outro departamento principal", () => {
    // Diretor(a) sem organization.admin: mesmos marcadores de um cargo de presidência do mesmo departamento.
    const directorRole: Role = { ...role("diretor-eventos"), id: "gestor-eventos", permissions: ["organization.view", "organization.create", "events.view", "documents.view", "documents.edit"] };
    const director = ctxFor("gestor-eventos", "gestor-eventos", directorRole);
    const presidencyRole: Role = { ...directorRole, id: "conselho-pres", level: "presidency", permissions: ["events.view"] };
    expect(roleReach(presidencyRole)).toEqual(roleReach({ ...presidencyRole, level: "director" }));
    expect(canAssignRole(director, presidencyRole)).toBe(false);
    expect(canAssignRole(director, { ...presidencyRole, level: "director" })).toBe(true);
    expect(canAssignRole(pres, presidencyRole)).toBe(true);

    // Departamento adicional dá o marcador, mas não o departamento principal (editar documentos, financeiro dos eventos).
    const withExtra: AccessContext = { ...director, user: { ...director.user, departmentIds: ["financeiro"] } };
    const financeDocs: Role = { ...directorRole, id: "conselho-fin-docs", departmentId: "financeiro", permissions: ["documents.view", "documents.edit"] };
    expect(roleReach(financeDocs).every((t) => ["all", "board", "directors", "directors_advisors", "d:financeiro"].includes(t))).toBe(true);
    expect(canAssignRole(withExtra, financeDocs)).toBe(false);
    expect(canAssignRole(pres, financeDocs)).toBe(true);

    // Assessoria: events.edit só edita os dados do evento em outro nível — atribuir esse nível com events.edit exige organization.admin.
    const memberEditor: Role = { ...role("assessor-eventos"), id: "apoio-editor", level: "member", permissions: ["events.view", "events.edit"] };
    expect(canAssignRole(manager, memberEditor)).toBe(false);
    expect(canAssignRole(manager, { ...memberEditor, permissions: ["events.view"] })).toBe(true);
    expect(canAssignRole(manager, { ...memberEditor, level: "advisor" })).toBe(true);
    expect(levelBeyond(memberEditor, managerRole)).toBe(true);
    expect(levelBeyond(memberEditor, directorRole)).toBe(false);
  });

  it("cargos desativados não aparecem", () => {
    expect(assignableRoles(pres, [{ ...role("assessor-eventos"), active: false }])).toEqual([]);
  });
});

describe("edição de integrantes", () => {
  it("ninguém muda o próprio cargo, a própria situação ou os próprios departamentos", () => {
    const rules = memberEditRules(pres, member("pres", "presidente"), roles);
    expect(rules).toMatchObject({ canEdit: true, self: true, canChangeRole: false, canChangeStatus: false, canChangeDepartments: false });
  });

  it("vice não altera a presidência", () => {
    expect(memberEditRules(vice, member("p", "presidente"), roles)).toMatchObject({ canEdit: false, reason: LOCK_MEMBER_ABOVE });
    expect(memberEditRules(vice, member("a", "assessor-eventos"), roles)).toMatchObject({ canEdit: true, canChangeDepartments: true });
  });

  it("departamentos adicionais exigem organization.admin; sem organization.edit não edita", () => {
    expect(memberEditRules(manager, member("a", "assessor-eventos"), roles)).toMatchObject({ canEdit: true, canChangeRole: true, canChangeDepartments: false });
    expect(memberEditRules(sec, member("a", "assessor-eventos"), roles).canEdit).toBe(false);
  });
});

describe("matriz de permissões", () => {
  it("sem organization.admin, nada pode ser alterado", () => {
    expect(permissionLock(manager, role("assessor-eventos"), "events.view", true)).toBe(LOCK_NO_ADMIN);
    expect(canChangeRoleAccess(manager, undefined)).toBe(false);
  });

  it("vice não concede o que não tem nem altera cargos acima dela", () => {
    expect(permissionLock(vice, role("assessor-eventos"), "settings.admin", false)).toBe(LOCK_NOT_OWN);
    expect(permissionLock(vice, role("assessor-eventos"), "finance.view", false)).toBeUndefined();
    expect(permissionLock(vice, role("presidente"), "finance.view", true)).toBe(LOCK_ROLE_ABOVE);
  });

  it("ninguém retira de si a administração de permissões", () => {
    expect(permissionLock(pres, role("presidente"), "organization.admin", true)).toBe(LOCK_SELF_ADMIN);
    expect(permissionLock(pres, role("vice-presidente"), "organization.admin", true)).toBeUndefined();
  });
});

describe("convites", () => {
  const inv = (status: Invitation["status"], roleId = "assessor-eventos"): Invitation => ({
    id: "i1",
    name: "Pessoa",
    email: "p@example.org",
    roleId,
    departmentIds: [],
    status,
    expiresAt: NOW,
    createdBy: "pres",
    createdAt: NOW,
  });

  it("renovar e revogar valem para convites pendentes ou expirados", () => {
    expect(renewLock(pres, inv("pending"), roles)).toBeUndefined();
    expect(renewLock(pres, inv("expired"), roles)).toBeUndefined();
    expect(renewLock(pres, inv("accepted"), roles)).toBeDefined();
    expect(revokeLock(pres, inv("revoked"))).toBeDefined();
    expect(revokeLock(pres, inv("expired"))).toBeUndefined();
  });

  it("não renova convite para cargo que a pessoa não pode atribuir", () => {
    expect(renewLock(vice, inv("pending", "presidente"), roles)).toMatch(/não pode renovar/);
    expect(renewLock(sec, inv("pending"), roles)).toMatch(/não pode renovar/);
  });

  it("sem organization.admin, não renova convite com alcance maior (cargo de diretoria ou departamentos adicionais)", () => {
    const board: Role = { ...role("assessor-eventos"), id: "conselho-eventos", isBoard: true };
    expect(renewLock(manager, inv("pending"), [...roles, managerRole])).toBeUndefined();
    expect(renewLock(manager, inv("pending", "conselho-eventos"), [...roles, board])).toMatch(/alcance/);
    expect(renewLock(manager, { ...inv("pending"), departmentIds: ["financeiro"] }, roles)).toMatch(/alcance/);
  });

  it("não renova quando já existe outro convite pendente para o mesmo e-mail", () => {
    const expired = inv("expired");
    const other = { ...inv("pending"), id: "i2" };
    expect(renewLock(pres, expired, roles, [expired, other])).toMatch(/outro convite pendente/);
    expect(renewLock(pres, expired, roles, [expired, { ...other, status: "expired" }])).toBeUndefined();
    expect(renewLock(pres, expired, roles, [expired, { ...other, email: "outra@example.org" }])).toBeUndefined();
    expect(renewLock(pres, expired, roles, [expired, { ...other, status: "revoked" }])).toBeUndefined();
  });

  it("situação desconhecida não quebra a lista", () => {
    expect(invitationStatusMeta("accepting" as Invitation["status"])).toBe(INVITATION_STATUS.pending);
    expect(invitationStatusMeta("accepted")).toBe(INVITATION_STATUS.accepted);
  });
});

describe("suporte do sistema (acima da presidência)", () => {
  const supportRole: Role = { ...supportRoleDefinition(), id: SUPPORT_ROLE_ID, createdAt: NOW, updatedAt: NOW };
  const all = [...roles, supportRole];
  const support = ctxFor("sup", SUPPORT_ROLE_ID, supportRole);

  it("presidência não atribui o cargo de suporte; o suporte atribui", () => {
    expect(canAssignRole(pres, supportRole)).toBe(false);
    expect(assignableRoles(pres, all).map((r) => r.id)).not.toContain(SUPPORT_ROLE_ID);
    expect(canAssignRole(support, supportRole)).toBe(true);
    expect(canAssignRole(support, role("presidente"))).toBe(true);
  });

  it("presidência não edita a conta do suporte; o suporte edita a presidência", () => {
    const rules = memberEditRules(pres, member("sup", SUPPORT_ROLE_ID), all);
    expect(rules.canEdit).toBe(false);
    expect(rules.reason).toBe(LOCK_SUPPORT);
    expect(memberEditRules(support, member("p2", "presidente"), all).canEdit).toBe(true);
  });

  it("presidência não altera o cargo de suporte", () => {
    expect(canChangeRoleAccess(pres, supportRole)).toBe(false);
    expect(roleAccessLock(pres, supportRole)).toBe(LOCK_SUPPORT);
    expect(roleAccessLock(support, supportRole)).toBeUndefined();
  });

  it("o cargo de suporte tem todas as permissões e o alcance da presidência", () => {
    expect(supportRole.permissions).toEqual([...role("presidente").permissions].sort());
    expect(supportRole.level).toBe("presidency");
    expect(supportRole.isBoard).toBe(true);
  });
});

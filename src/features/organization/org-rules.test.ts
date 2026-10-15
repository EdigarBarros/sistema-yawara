import { describe, expect, it } from "vitest";
import { DEFAULT_DEPARTMENTS, DEFAULT_ROLES } from "@/data/structure/default-structure";
import type { AccessContext } from "@/lib/permissions";
import type { Invitation, Member, Role } from "@/types";
import {
  assignableRoles,
  canAssignRole,
  canChangeRoleAccess,
  LOCK_MEMBER_ABOVE,
  LOCK_NO_ADMIN,
  LOCK_NOT_OWN,
  LOCK_ROLE_ABOVE,
  LOCK_SELF_ADMIN,
  memberEditRules,
  permissionLock,
  renewLock,
  revokeLock,
} from "./org-rules";

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
});

/**
 * A tela de Diretoria (modo Firebase) usa as regras puras de
 * src/features/organization/org-rules.ts para só oferecer o que o servidor
 * aceita. Estes testes conferem, contra os emuladores, que o que a tela
 * oferece é exatamente o que as Cloud Functions aceitam (e o que ela esconde
 * é recusado) — a interface nunca é a barreira de segurança.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { allPermissions } from "@/lib/modules";
import { hasPermission, type AccessContext } from "@/lib/permissions";
import type { Member, Permission, Role } from "@/types";
import { assignableRoles, memberEditRules, permissionLock, renewLock } from "@/features/organization/org-rules";
import { authActions, organizationActions } from "../src/modules/organization";
import { caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const org = caller("organization", organizationActions);
const auth = caller("auth", authActions);

interface InviteResult {
  invitation: { id: string; status: string; expiresAt: string };
  link: string | null;
}

/** Cargo sem `organization.admin` que convida e edita integrantes (não existe na estrutura padrão). */
const MANAGER_PERMISSIONS: Permission[] = [
  "organization.view",
  "organization.create",
  "organization.edit",
  "events.view",
  "events.edit",
  "campaigns.view",
  "campaigns.register",
  "documents.view",
];

async function rolesNow(): Promise<Role[]> {
  const snap = await db.collection("roles").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Role, "id">) }));
}

async function ctxOf(uid: string): Promise<AccessContext> {
  const m = (await db.doc(`members/${uid}`).get()).data()!;
  const r = await db.doc(`roles/${m.roleId}`).get();
  const user = { id: uid, email: "", ...m } as Member;
  return { user, role: { id: r.id, ...(r.data() as Omit<Role, "id">) }, department: undefined };
}

async function memberOf(uid: string): Promise<Member> {
  const m = (await db.doc(`members/${uid}`).get()).data()!;
  return { id: uid, email: "", ...m } as Member;
}

/** Executa e devolve true se o servidor aceitou, false se recusou por regra (forbidden/invalid). */
async function accepted(promise: Promise<unknown>) {
  try {
    await promise;
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "forbidden" || code === "invalid") return false;
    throw error;
  }
}

function tokenOf(link: string) {
  return new URL(link).searchParams.get("token")!;
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await db.doc("roles/gestor").set({
    name: "Gestor(a) de Pessoas",
    description: "Cargo de teste sem administração de permissões.",
    departmentId: "eventos",
    level: "advisor",
    isBoard: false,
    active: true,
    homePreset: "advisor",
    permissions: MANAGER_PERMISSIONS,
    createdAt: "2026-10-14T12:00:00.000Z",
    updatedAt: "2026-10-14T12:00:00.000Z",
  });
  await seedPeople();
  await createMember("gestor", "Gestor Teste", "gestor");
});

describe("convite: cargos oferecidos ≡ cargos aceitos pelo servidor", () => {
  it.each(["pres", "vice", "gestor", "sec"])("perfil %s", async (uid) => {
    const ctx = await ctxOf(uid);
    const roles = await rolesNow();
    const offered = new Set(hasPermission(ctx, "organization.create") ? assignableRoles(ctx, roles).map((r) => r.id) : []);
    const mismatches: string[] = [];
    for (const role of roles) {
      const ok = await accepted(org("inviteMember", uid, { name: "Pessoa Convidada", email: `${uid}.${role.id}@example.org`, roleId: role.id, departmentIds: [] }));
      if (ok !== offered.has(role.id)) mismatches.push(`${role.id}: tela=${offered.has(role.id)} servidor=${ok}`);
    }
    expect(mismatches).toEqual([]);
    if (uid === "pres") expect(offered.size).toBe(roles.length);
    if (uid === "sec") expect(offered.size).toBe(0);
  });
});

describe("matriz: permissões liberadas ≡ aceitas pelo servidor", () => {
  it.each(["vice", "gestor"])("perfil %s concedendo cada permissão ao cargo de assessor", async (uid) => {
    const ctx = await ctxOf(uid);
    const base = (await rolesNow()).find((r) => r.id === "assessor-eventos")!;
    const mismatches: string[] = [];
    for (const p of allPermissions().filter((x) => !base.permissions.includes(x))) {
      const lock = permissionLock(ctx, base, p, false);
      const ok = await accepted(org("updateRole", uid, { id: base.id, input: { permissions: [...base.permissions, p] } }));
      if (ok !== !lock) mismatches.push(`${p}: tela=${lock ?? "liberada"} servidor=${ok}`);
      if (ok) await db.doc(`roles/${base.id}`).update({ permissions: base.permissions });
    }
    expect(mismatches).toEqual([]);
  });

  it("cargo acima de quem edita e a própria administração ficam bloqueados", async () => {
    const vice = await ctxOf("vice");
    const pres = await ctxOf("pres");
    const roles = await rolesNow();
    const presidente = roles.find((r) => r.id === "presidente")!;
    const cases: [AccessContext, string, Role, Permission][] = [
      [vice, "vice", presidente, "finance.view"],
      [pres, "pres", presidente, "organization.admin"],
      [pres, "pres", roles.find((r) => r.id === "vice-presidente")!, "organization.admin"],
    ];
    for (const [ctx, uid, role, p] of cases) {
      const lock = permissionLock(ctx, role, p, true);
      const ok = await accepted(org("updateRole", uid, { id: role.id, input: { permissions: role.permissions.filter((x) => x !== p) } }));
      expect({ role: role.id, p, ok }).toEqual({ role: role.id, p, ok: !lock });
    }
  });
});

describe("edição de integrante: o que a tela oferece ≡ o que o servidor aceita", () => {
  it("cargo acima, departamentos, situação e a própria conta", async () => {
    const roles = await rolesNow();
    const vice = await ctxOf("vice");
    const gestor = await ctxOf("gestor");
    const pres = await ctxOf("pres");

    // Vice não edita a presidência.
    const onPres = memberEditRules(vice, await memberOf("pres"), roles);
    expect(onPres.canEdit).toBe(false);
    expect(await accepted(org("updateMember", "vice", { id: "pres", input: { name: "Outro Nome" } }))).toBe(false);

    // Vice altera departamentos adicionais; o gestor (sem organization.admin) não.
    expect(memberEditRules(vice, await memberOf("ass"), roles).canChangeDepartments).toBe(true);
    expect(await accepted(org("updateMember", "vice", { id: "ass", input: { departmentIds: ["marketing"] } }))).toBe(true);
    expect(memberEditRules(gestor, await memberOf("ass"), roles).canChangeDepartments).toBe(false);
    expect(await accepted(org("updateMember", "gestor", { id: "ass", input: { departmentIds: [] } }))).toBe(false);

    // O gestor desativa e reativa quem tem um cargo contido no dele.
    const onAss = memberEditRules(gestor, await memberOf("ass"), roles);
    expect(onAss).toMatchObject({ canEdit: true, canChangeStatus: true });
    expect(await accepted(org("updateMember", "gestor", { id: "ass", input: { status: "inactive" } }))).toBe(true);
    expect((await db.doc("userAccess/ass").get()).data()!.status).toBe("inactive");
    expect(await accepted(org("updateMember", "gestor", { id: "ass", input: { status: "active" } }))).toBe(true);

    // O gestor não edita quem tem um cargo com permissões que ele não tem.
    expect(memberEditRules(gestor, await memberOf("assmkt"), roles).canEdit).toBe(false);
    expect(await accepted(org("updateMember", "gestor", { id: "assmkt", input: { name: "Outro Nome" } }))).toBe(false);

    // Na própria conta, só o nome.
    const self = memberEditRules(pres, await memberOf("pres"), roles);
    expect(self).toMatchObject({ canEdit: true, self: true, canChangeRole: false, canChangeStatus: false, canChangeDepartments: false });
    expect(await accepted(org("updateMember", "pres", { id: "pres", input: { name: "Presidente Renomeada" } }))).toBe(true);
    expect(await accepted(org("updateMember", "pres", { id: "pres", input: { roleId: "vice-presidente" } }))).toBe(false);
  });

  it("o e-mail de acesso não é trocado pela edição (a tela não envia o campo)", async () => {
    await expectCode(org("updateMember", "pres", { id: "ass", input: { email: "novo@example.org" } }), "invalid");
    // Reenviar o mesmo e-mail não é troca.
    await org("updateMember", "pres", { id: "ass", input: { email: "ass@example.org", name: "Assessor Renomeado" } });
    expect((await db.doc("memberPrivate/ass").get()).data()!.email).toBe("ass@example.org");
  });
});

describe("convites: link exibido uma única vez", () => {
  it("o link vem só na primeira resposta; renovar gera outro e invalida o anterior", async () => {
    const requestId = "req-convite-uma-vez-0001";
    const first = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Nova", email: "nova@example.org", roleId: "assessor-eventos", departmentIds: [] }, requestId);
    expect(first.link).toContain("/convite?token=");
    expect(first.invitation.status).toBe("pending");
    expect(Date.parse(first.invitation.expiresAt)).toBeGreaterThan(Date.now());

    // Reenvio da mesma requisição (ex.: queda de conexão): mesmo convite, sem link.
    const replay = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Nova", email: "nova@example.org", roleId: "assessor-eventos", departmentIds: [] }, requestId);
    expect(replay.invitation.id).toBe(first.invitation.id);
    expect(replay.link).toBeNull();

    const renewed = await org<InviteResult>("renewInvitation", "pres", { id: first.invitation.id });
    expect(renewed.link).toContain("/convite?token=");
    expect(tokenOf(renewed.link!)).not.toBe(tokenOf(first.link!));
    await expectCode(auth("previewInvitation", undefined, { token: tokenOf(first.link!) }), "not_found");
    expect((await auth<{ name: string }>("previewInvitation", undefined, { token: tokenOf(renewed.link!) })).name).toBe("Pessoa Nova");
  });

  it("renovação bloqueada na tela é recusada pelo servidor", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Futura Presidência", email: "futura@example.org", roleId: "presidente", departmentIds: [] });
    const roles = await rolesNow();
    const inv = { ...res.invitation, name: "Futura Presidência", email: "futura@example.org", roleId: "presidente", departmentIds: [], createdBy: "pres", createdAt: "" };
    expect(renewLock(await ctxOf("vice"), inv as never, roles)).toBeDefined();
    await expectCode(org("renewInvitation", "vice", { id: res.invitation.id }), "forbidden");
    expect(renewLock(await ctxOf("pres"), inv as never, roles)).toBeUndefined();
    await org("revokeInvitation", "pres", { id: res.invitation.id });
    await expectCode(org("revokeInvitation", "pres", { id: res.invitation.id }), "conflict");
  });
});

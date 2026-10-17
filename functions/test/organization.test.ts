import { beforeEach, describe, expect, it } from "vitest";
import { adminCount, assertAdminsRemain, authActions, organizationActions } from "../src/modules/organization";
import { SUPPORT_ROLE_ID, supportRoleDefinition } from "@/lib/support";
import { adminAuth, auditFor, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const org = caller("organization", organizationActions);
const auth = caller("auth", authActions);

interface InviteResult {
  invitation: { id: string; status: string };
  link: string | null;
}

function tokenOf(link: string) {
  return new URL(link).searchParams.get("token")!;
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("convites e criação de contas", () => {
  it("presidência convida; o token não é gravado, só o hash; o aceite cria a conta ativa", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Nova Integrante", email: "Nova@Example.org", roleId: "assessor-eventos" });
    expect(res.link).toContain("/convite?token=");
    const token = tokenOf(res.link!);
    const stored = (await db.doc(`invitations/${res.invitation.id}`).get()).data()!;
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.email).toBe("nova@example.org");

    const preview = await auth<{ name: string; roleName: string }>("previewInvitation", undefined, { token });
    expect(preview.name).toBe("Nova Integrante");
    expect(preview.roleName).toBe("Assessor(a) de Eventos");

    await expectCode(auth("acceptInvitation", undefined, { token, password: "curta" }), "invalid");
    const accepted = await auth<{ email: string }>("acceptInvitation", undefined, { token, password: "SenhaForte123" });
    expect(accepted.email).toBe("nova@example.org");

    const user = await adminAuth.getUserByEmail("nova@example.org");
    const access = (await db.doc(`userAccess/${user.uid}`).get()).data()!;
    expect(access.status).toBe("active");
    expect(access.permissions).toContain("campaigns.register");
    expect(access.tokens).toContain(`u:${user.uid}`);
    expect((await db.doc(`invitations/${res.invitation.id}`).get()).data()!.status).toBe("accepted");

    // Convite de uso único: o link usado recebe a mensagem específica.
    const reused = await expectCode(auth("acceptInvitation", undefined, { token, password: "SenhaForte123" }), "conflict");
    expect(reused.message).toBe("Este convite já foi usado. Entre com o seu e-mail e senha.");
    expect((await auditFor(user.uid)).some((a) => a.action === "auth.acceptInvitation")).toBe(true);
  });

  it("token inválido é recusado", async () => {
    await expectCode(auth("previewInvitation", undefined, { token: "x".repeat(43) }), "not_found");
  });

  it("assessor não pode convidar; vice não pode convidar para um cargo com permissões que não tem", async () => {
    await expectCode(org("inviteMember", "ass", { name: "Alguém", email: "a@example.org", roleId: "assessor-eventos" }), "forbidden");
    await expectCode(org("inviteMember", "vice", { name: "Alguém", email: "b@example.org", roleId: "presidente" }), "forbidden");
  });

  it("não duplica integrante nem convite pendente para o mesmo e-mail", async () => {
    await expectCode(org("inviteMember", "pres", { name: "Duplicado", email: "ass@example.org", roleId: "assessor-eventos" }), "conflict");
    await org("inviteMember", "pres", { name: "Pessoa", email: "pessoa@example.org", roleId: "assessor-eventos" });
    await expectCode(org("inviteMember", "pres", { name: "Pessoa", email: "pessoa@example.org", roleId: "assessor-eventos" }), "conflict");
  });

  it("convite revogado não pode ser usado", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa", email: "p2@example.org", roleId: "assessor-eventos" });
    await org("revokeInvitation", "pres", { id: res.invitation.id });
    const error = await expectCode(auth("acceptInvitation", undefined, { token: tokenOf(res.link!), password: "SenhaForte123" }), "conflict");
    expect(error.message).toBe("Este convite foi cancelado. Peça um novo link.");
    await expect(adminAuth.getUserByEmail("p2@example.org")).rejects.toMatchObject({ code: "auth/user-not-found" });
  });
});

describe("proteção contra elevação de privilégios", () => {
  it("ninguém altera o próprio cargo, os próprios departamentos ou desativa a própria conta", async () => {
    await expectCode(org("updateMember", "vice", { id: "vice", input: { roleId: "presidente" } }), "invalid");
    await expectCode(org("updateMember", "pres", { id: "pres", input: { status: "inactive" } }), "invalid");
    await expectCode(org("updateMember", "pres", { id: "pres", input: { departmentIds: ["financeiro"] } }), "invalid");
  });

  it("diretor sem permissão de organização não altera cargos nem permissões", async () => {
    await expectCode(org("updateRole", "fin", { id: "diretor-financeiro", input: { permissions: ["finance.view", "organization.admin"] } }), "forbidden");
    await expectCode(org("updateRole", "fin", { id: "assessor-eventos", input: { name: "Outro nome" } }), "forbidden");
  });

  it("vice não concede permissões que não tem nem altera a presidência", async () => {
    await expectCode(org("updateRole", "vice", { id: "assessor-eventos", input: { permissions: ["events.view", "settings.admin"] } }), "forbidden");
    await expectCode(org("updateMember", "vice", { id: "pres", input: { status: "inactive" } }), "forbidden");
  });

  it("presidência não remove de si a administração de permissões", async () => {
    const pres = (await db.doc("roles/presidente").get()).data()!.permissions as string[];
    await expectCode(org("updateRole", "pres", { id: "presidente", input: { permissions: pres.filter((x) => x !== "organization.admin") } }), "invalid");
  });

  it("sempre resta pelo menos um administrador ativo", async () => {
    // Regra pura (defesa em profundidade): nenhuma mudança pode zerar os administradores.
    const roles = new Map([
      ["adm", { id: "adm", active: true, permissions: ["organization.admin"] } as never],
      ["outro", { id: "outro", active: true, permissions: [] } as never],
    ]);
    const members = [{ id: "a", roleId: "adm", status: "active" }, { id: "b", roleId: "outro", status: "active" }] as never[];
    expect(adminCount(members, roles)).toBe(1);
    expect(() => assertAdminsRemain(members.map((m: { id: string }) => (m.id === "a" ? { ...m, status: "inactive" } : m)) as never, roles)).toThrow(/sem nenhum integrante/);
    // Pela API: retirar a administração do cargo da vice é permitido porque a presidência continua administradora.
    const vice = (await db.doc("roles/vice-presidente").get()).data()!.permissions as string[];
    await org("updateRole", "pres", { id: "vice-presidente", input: { permissions: vice.filter((x) => x !== "organization.admin") } });
    expect((await db.doc("userAccess/vice").get()).data()!.permissions).not.toContain("organization.admin");
  });

  it("alterar permissões de um cargo atualiza o retrato de acesso de quem o ocupa", async () => {
    const before = (await db.doc("userAccess/ass").get()).data()!;
    await org("updateRole", "pres", { id: "assessor-eventos", input: { permissions: ["events.view", "events.edit", "campaigns.view"] } });
    const after = (await db.doc("userAccess/ass").get()).data()!;
    expect(after.permissions).not.toContain("campaigns.register");
    expect(after.version).toBeGreaterThan(before.version ?? 0);
    expect((await auditFor("assessor-eventos")).some((a) => a.action === "organization.updateRole")).toBe(true);
  });

  it("desativar uma conta tira o acesso efetivo e bloqueia o login", async () => {
    await org("updateMember", "pres", { id: "ass", input: { status: "inactive" } });
    const access = (await db.doc("userAccess/ass").get()).data()!;
    expect(access.status).toBe("inactive");
    expect(access.permissions).toEqual([]);
    expect(access.tokens).toEqual([]);
    expect((await adminAuth.getUser("ass")).disabled).toBe(true);
    // A conta desativada não executa mais nenhuma operação.
    await expectCode(org("createDepartment", "ass", { name: "Qualquer", shortName: "QQ", description: "", active: true }), "forbidden");
  });
});

describe("suporte do sistema (acima da presidência)", () => {
  async function seedSupport() {
    await db.doc(`roles/${SUPPORT_ROLE_ID}`).set({ ...supportRoleDefinition(), createdAt: "2026-10-14T12:00:00.000Z", updatedAt: "2026-10-14T12:00:00.000Z" });
    await createMember("sup", "Suporte Teste", SUPPORT_ROLE_ID);
  }

  it("presidência não desativa, não troca o cargo nem edita a conta do suporte", async () => {
    await seedSupport();
    await expectCode(org("updateMember", "pres", { id: "sup", input: { status: "inactive" } }), "forbidden");
    await expectCode(org("updateMember", "pres", { id: "sup", input: { roleId: "presidente" } }), "forbidden");
    await expectCode(org("updateMember", "pres", { id: "sup", input: { name: "Outro" } }), "forbidden");
    expect((await db.doc("members/sup").get()).data()!.status).toBe("active");
  });

  it("presidência não altera o cargo de suporte nem o atribui (convite ou troca)", async () => {
    await seedSupport();
    await expectCode(org("updateRole", "pres", { id: SUPPORT_ROLE_ID, input: { name: "Outro nome" } }), "forbidden");
    await expectCode(org("updateRole", "pres", { id: SUPPORT_ROLE_ID, input: { active: false } }), "forbidden");
    await expectCode(org("inviteMember", "pres", { name: "Alguém", email: "alguem@example.org", roleId: SUPPORT_ROLE_ID }), "forbidden");
    await expectCode(org("updateMember", "pres", { id: "vice", input: { roleId: SUPPORT_ROLE_ID } }), "forbidden");
  });

  it("o suporte administra a presidência normalmente", async () => {
    await seedSupport();
    await org("updateMember", "sup", { id: "vice", input: { status: "inactive" } });
    expect((await db.doc("members/vice").get()).data()!.status).toBe("inactive");
    await org("updateRole", "sup", { id: SUPPORT_ROLE_ID, input: { description: "Manutenção" } });
  });
});

describe("integridade", () => {
  it("repetir a mesma requisição (mesmo requestId) não duplica o registro", async () => {
    const requestId = "req-teste-idempotencia-001";
    const a = await org<{ id: string }>("createDepartment", "pres", { name: "Esportes", shortName: "ESP", description: "", active: true }, requestId);
    const b = await org<{ id: string }>("createDepartment", "pres", { name: "Esportes", shortName: "ESP", description: "", active: true }, requestId);
    expect(b.id).toBe(a.id);
    const all = await db.collection("departments").where("name", "==", "Esportes").get();
    expect(all.size).toBe(1);
  });

  it("convites simultâneos para o mesmo e-mail: só um é criado", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => org("inviteMember", "pres", { name: `Pessoa ${i}`, email: "mesma@example.org", roleId: "assessor-eventos" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const pending = await db.collection("invitations").where("email", "==", "mesma@example.org").get();
    expect(pending.size).toBe(1);
  });
});

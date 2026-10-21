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

  it("o suporte troca nome, foto, e-mail e senha de qualquer integrante; ninguém mais pode", async () => {
    await seedSupport();
    const photo = "data:image/jpeg;base64," + "A".repeat(400);
    const input = { name: "Presidente Renomeada", email: "Nova.Presidente@Example.org", password: "NovaSenha123", photo };
    await expectCode(org("supportUpdateAccount", "pres", { id: "ass", input }), "forbidden");

    const res = await org<{ name: string; email: string; photo?: string }>("supportUpdateAccount", "sup", { id: "pres", input });
    expect(res).toMatchObject({ name: "Presidente Renomeada", email: "nova.presidente@example.org", photo });
    const user = await adminAuth.getUser("pres");
    expect(user.email).toBe("nova.presidente@example.org");
    expect(user.displayName).toBe("Presidente Renomeada");
    expect((await db.doc("memberPrivate/pres").get()).data()!.email).toBe("nova.presidente@example.org");
    // A senha não aparece em lugar nenhum da auditoria nem do controle de repetição.
    const logs = await auditFor("pres");
    expect(logs.some((l) => l.action === "organization.supportUpdateAccount")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("NovaSenha123");
    const idem = await db.collection("idempotency").get();
    expect(JSON.stringify(idem.docs.map((d) => d.data()))).not.toContain("NovaSenha123");

    await org("supportUpdateAccount", "sup", { id: "pres", input: { photo: null } });
    expect((await db.doc("members/pres").get()).data()!.photo).toBeUndefined();
    // E-mail já usado por outra pessoa: recusado, nada muda.
    await expectCode(org("supportUpdateAccount", "sup", { id: "ass", input: { email: "nova.presidente@example.org" } }), "conflict");
    expect((await adminAuth.getUser("ass")).email).toBe("ass@example.org");
    await expectCode(org("supportUpdateAccount", "sup", { id: "ass", input: { password: "curta" } }), "invalid");
  });

  it("só o suporte recupera o link de um convite pendente; aceito ou revogado, o link some", async () => {
    await seedSupport();
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Convidada", email: "convidada@example.org", roleId: "assessor-eventos" });
    await expectCode(org("invitationLink", "pres", { id: res.invitation.id }), "forbidden");
    const { link } = await org<{ link: string }>("invitationLink", "sup", { id: res.invitation.id });
    expect(link).toBe(res.link);

    await auth("acceptInvitation", undefined, { token: tokenOf(link), password: "SenhaForte123" });
    expect((await db.doc(`invitationLinks/${res.invitation.id}`).get()).exists).toBe(false);
    await expectCode(org("invitationLink", "sup", { id: res.invitation.id }), "conflict");

    const other = await org<InviteResult>("inviteMember", "pres", { name: "Outra Pessoa", email: "outra@example.org", roleId: "assessor-eventos" });
    await org("revokeInvitation", "pres", { id: other.invitation.id });
    expect((await db.doc(`invitationLinks/${other.invitation.id}`).get()).exists).toBe(false);
  });
});

describe("foto de perfil e exclusão de perfis", () => {
  const PHOTO = "data:image/jpeg;base64," + "A".repeat(400);

  it("cada integrante troca e remove a própria foto; formato e tamanho são conferidos", async () => {
    const res = await org<{ photo?: string }>("updateMyPhoto", "ass", { photo: PHOTO });
    expect(res.photo).toBe(PHOTO);
    expect((await db.doc("members/ass").get()).data()!.photo).toBe(PHOTO);
    await org("updateMyPhoto", "ass", { photo: null });
    expect((await db.doc("members/ass").get()).data()!.photo).toBeUndefined();
    await expectCode(org("updateMyPhoto", "ass", { photo: "data:image/svg+xml;base64,PHN2Zz4=" }), "invalid");
    await expectCode(org("updateMyPhoto", "ass", { photo: "data:image/jpeg;base64," + "A".repeat(130_000) }), "invalid");
    // Não há como trocar a foto de outra pessoa: a ação só vale para a própria conta.
    await expectCode(org("updateMyPhoto", "ass", { photo: PHOTO, id: "pres" }), "invalid");
  });

  it("presidência e vice excluem perfis; a conta some do Auth e do cadastro", async () => {
    await org("deleteMember", "vice", { id: "ass" });
    for (const col of ["members", "memberPrivate", "userAccess"]) expect((await db.doc(`${col}/ass`).get()).exists).toBe(false);
    await expect(adminAuth.getUser("ass")).rejects.toThrow();
    expect((await auditFor("ass")).some((a) => a.action === "organization.deleteMember")).toBe(true);
  });

  it("quem não é da presidência não exclui; ninguém exclui a si mesmo, a presidência (pela vice) nem o suporte", async () => {
    await expectCode(org("deleteMember", "sec", { id: "ass" }), "forbidden");
    await expectCode(org("deleteMember", "pres", { id: "pres" }), "invalid");
    await expectCode(org("deleteMember", "vice", { id: "pres" }), "forbidden");
    await db.doc(`roles/${SUPPORT_ROLE_ID}`).set({ ...supportRoleDefinition(), createdAt: "2026-10-14T12:00:00.000Z", updatedAt: "2026-10-14T12:00:00.000Z" });
    await createMember("sup", "Suporte Teste", SUPPORT_ROLE_ID);
    await expectCode(org("deleteMember", "pres", { id: "sup" }), "forbidden");
    expect((await db.doc("members/sup").get()).exists).toBe(true);
  });
});

describe("integridade", () => {
  it("repetir a mesma requisição (mesmo requestId) não duplica o registro", async () => {
    const requestId = "req-teste-idempotencia-001";
    const a = await org<{ id: string }>("createDepartment", "pres", { name: "Bateria", shortName: "BAT", description: "", active: true }, requestId);
    const b = await org<{ id: string }>("createDepartment", "pres", { name: "Bateria", shortName: "BAT", description: "", active: true }, requestId);
    expect(b.id).toBe(a.id);
    const all = await db.collection("departments").where("name", "==", "Bateria").get();
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

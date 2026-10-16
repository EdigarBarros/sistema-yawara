/**
 * Convites: aceite seguro (conta pré-existente, aceites simultâneos), alcance
 * do cargo atribuído, privacidade do e-mail depois do aceite, mensagens dos
 * links usados/revogados e validação em português.
 * Nomes e e-mails fictícios (@example.org), criados só para o teste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@/types";
import { Timestamp } from "../src/core/admin";
import { loadActorOutsideTx } from "../src/core/dispatch";
import { authActions, organizationActions } from "../src/modules/organization";
import { adminAuth, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const org = caller("organization", organizationActions);
const auth = caller("auth", authActions);

interface InviteResult {
  invitation: { id: string; status: string; email: string };
  link: string | null;
}

const NOW = "2026-10-14T12:00:00.000Z";
const INVALID_INVITE = "Convite inválido. Peça um novo link a quem convidou você.";
const USED_INVITE = "Este convite já foi usado. Entre com o seu e-mail e senha.";
const REVOKED_INVITE = "Este convite foi cancelado. Peça um novo link.";
const BUSY_INVITE = "Este convite está sendo usado neste momento. Aguarde alguns instantes e tente novamente.";
const DAY = 24 * 60 * 60 * 1000;

function tokenOf(link: string) {
  return new URL(link).searchParams.get("token")!;
}

function authUrl(path: string) {
  return `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/${path}?key=fake-api-key`;
}

/** Cadastro feito "por fora" (SDK do cliente / REST), como faria quem tenta se antecipar ao convite. */
async function signUpOutside(email: string, password: string) {
  const res = await fetch(authUrl("accounts:signUp"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { localId?: string; idToken?: string };
  if (!body.localId) throw new Error(`cadastro externo falhou: ${JSON.stringify(body)}`);
  return { uid: body.localId, idToken: body.idToken! };
}

/** Confere uma senha no emulador de Auth (true = login aceito). */
async function canSignIn(email: string, password: string) {
  const res = await fetch(authUrl("accounts:signInWithPassword"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.ok;
}

async function createRole(id: string, data: { departmentId: string; level: "presidency" | "director" | "advisor" | "member"; isBoard: boolean; permissions: Permission[] }) {
  await db.doc(`roles/${id}`).set({
    name: `Cargo ${id}`,
    description: "Cargo de teste.",
    active: true,
    homePreset: "advisor",
    createdAt: NOW,
    updatedAt: NOW,
    ...data,
  });
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error("Esperava erro, mas a operação foi concluída.");
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aceite do convite: conta pré-existente e concorrência", () => {
  it("conta criada por fora antes do convite não é reaproveitada: o integrante nasce com outro uid", async () => {
    const outsider = await signUpOutside("futuro.tesoureiro@example.org", "SenhaDoIntruso1");
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Futuro Tesoureiro", email: "futuro.tesoureiro@example.org", roleId: "diretor-financeiro" });

    await auth("acceptInvitation", undefined, { token: tokenOf(res.link!), password: "SenhaDaPessoa123" });

    const user = await adminAuth.getUserByEmail("futuro.tesoureiro@example.org");
    expect(user.uid).not.toBe(outsider.uid);
    expect((await db.doc(`members/${user.uid}`).get()).exists).toBe(true);
    // O uid antigo (e qualquer token emitido para ele) não corresponde a nada na Central.
    expect((await db.doc(`members/${outsider.uid}`).get()).exists).toBe(false);
    expect((await db.doc(`userAccess/${outsider.uid}`).get()).exists).toBe(false);
    await expect(adminAuth.getUser(outsider.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    await expectCode(loadActorOutsideTx(outsider.uid), "forbidden");
    // Só a senha escolhida no aceite vale.
    expect(await canSignIn("futuro.tesoureiro@example.org", "SenhaDaPessoa123")).toBe(true);
    expect(await canSignIn("futuro.tesoureiro@example.org", "SenhaDoIntruso1")).toBe(false);
  });

  it("a conta criada por fora e removida no aceite fica registrada na auditoria (sem o e-mail)", async () => {
    const outsider = await signUpOutside("antecipada@example.org", "SenhaDoIntruso1");
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Antecipada", email: "antecipada@example.org", roleId: "assessor-eventos" });
    await auth("acceptInvitation", undefined, { token: tokenOf(res.link!), password: "SenhaDaPessoa123" });

    const logs = (await db.collection("auditLogs").where("action", "==", "auth.removeUnlinkedAccount").get()).docs.map((d) => d.data());
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ module: "auth", resourceType: "invitation", resourceId: res.invitation.id, actorId: null, outcome: "success" });
    expect(logs[0].details.removedUid).toBe(outsider.uid);
    expect(typeof logs[0].details.accountCreatedAt).toBe("string");
    expect(JSON.stringify(logs[0])).not.toContain("antecipada@example.org");
    // Sem conta pré-existente, nada é removido nem registrado.
    const other = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Comum", email: "comum@example.org", roleId: "assessor-eventos" });
    await auth("acceptInvitation", undefined, { token: tokenOf(other.link!), password: "SenhaDaPessoa123" });
    expect((await db.collection("auditLogs").where("action", "==", "auth.removeUnlinkedAccount").get()).size).toBe(1);
  });

  it("dois convites válidos para o mesmo e-mail: um aceite em andamento bloqueia o outro (nenhuma conta é apagada)", async () => {
    const payload = { name: "Pessoa Dupla", email: "duplo@example.org", roleId: "assessor-eventos" };
    const first = await org<InviteResult>("inviteMember", "pres", payload);
    await db.doc(`invitations/${first.invitation.id}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const second = await org<InviteResult>("inviteMember", "pres", payload);
    // Dados antigos (antes da regra de renovação): os dois links valem ao mesmo tempo.
    await db.doc(`invitations/${first.invitation.id}`).update({ expiresAt: Timestamp.fromMillis(Date.now() + DAY) });

    // O aceite B começa quando o A já criou a conta e ainda não gravou o integrante.
    const createUser = adminAuth.createUser.bind(adminAuth);
    let uidA = "";
    let resultB: PromiseSettledResult<unknown> | undefined;
    vi.spyOn(adminAuth, "createUser").mockImplementationOnce(async (props) => {
      const user = await createUser(props);
      uidA = user.uid;
      [resultB] = await Promise.allSettled([auth("acceptInvitation", undefined, { token: tokenOf(second.link!), password: "SenhaDoB12345" })]);
      return user;
    });
    const deleteUser = vi.spyOn(adminAuth, "deleteUser");

    await auth("acceptInvitation", undefined, { token: tokenOf(first.link!), password: "SenhaDoA12345" });
    expect(resultB).toMatchObject({ status: "rejected", reason: { code: "conflict", message: BUSY_INVITE } });
    expect(deleteUser).not.toHaveBeenCalled();
    expect((await adminAuth.getUserByEmail("duplo@example.org")).uid).toBe(uidA);
    expect((await db.doc(`members/${uidA}`).get()).exists).toBe(true);
    expect(await canSignIn("duplo@example.org", "SenhaDoA12345")).toBe(true);
    expect(await canSignIn("duplo@example.org", "SenhaDoB12345")).toBe(false);
    // O outro link deixa de valer (a pessoa já é integrante) e não guarda mais o e-mail.
    const other = (await db.doc(`invitations/${second.invitation.id}`).get()).data()!;
    expect(other.status).toBe("revoked");
    expect(other).not.toHaveProperty("email");
    expect(await errorOf(auth("acceptInvitation", undefined, { token: tokenOf(second.link!), password: "SenhaDoB12345" }))).toMatchObject({ code: "conflict", message: REVOKED_INVITE });
  });

  it("aceites simultâneos de dois convites do mesmo e-mail: exatamente um conclui e a conta dele é a que fica", async () => {
    for (const n of [1, 2, 3]) {
      const email = `paralelo${n}@example.org`;
      const payload = { name: "Pessoa Paralela", email, roleId: "assessor-eventos" };
      const first = await org<InviteResult>("inviteMember", "pres", payload);
      await db.doc(`invitations/${first.invitation.id}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
      const second = await org<InviteResult>("inviteMember", "pres", payload);
      await db.doc(`invitations/${first.invitation.id}`).update({ expiresAt: Timestamp.fromMillis(Date.now() + DAY) });

      const passwords = ["SenhaPrimeira1", "SenhaSegunda2"];
      const results = await Promise.allSettled(
        [first, second].map((inv, i) => auth<{ email: string }>("acceptInvitation", undefined, { token: tokenOf(inv.link!), password: passwords[i] })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const winner = passwords[results.findIndex((r) => r.status === "fulfilled")];
      const user = await adminAuth.getUserByEmail(email);
      expect((await db.doc(`members/${user.uid}`).get()).exists).toBe(true);
      for (const p of passwords) expect(await canSignIn(email, p)).toBe(p === winner);
      const privates = await db.collection("memberPrivate").where("email", "==", email).get();
      expect(privates.docs.map((d) => d.id)).toEqual([user.uid]);
    }
  });

  it("renovar não cria um segundo convite aberto para o mesmo e-mail nem convida quem já é integrante", async () => {
    const payload = { name: "Pessoa Renovável", email: "renovavel@example.org", roleId: "assessor-eventos" };
    const first = await org<InviteResult>("inviteMember", "pres", payload);
    await db.doc(`invitations/${first.invitation.id}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const second = await org<InviteResult>("inviteMember", "pres", payload);
    const error = await expectCode(org("renewInvitation", "pres", { id: first.invitation.id }), "conflict");
    expect(error.message).toMatch(/outro convite pendente/);

    // Com o segundo também expirado, renovar o primeiro volta a ser possível (só um aberto por vez).
    await db.doc(`invitations/${second.invitation.id}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const renewed = await org<InviteResult>("renewInvitation", "pres", { id: first.invitation.id });
    await expectCode(org("renewInvitation", "pres", { id: second.invitation.id }), "conflict");

    // Depois do aceite, o outro convite (expirado) é revogado e nada mais é renovado para esse e-mail.
    await auth("acceptInvitation", undefined, { token: tokenOf(renewed.link!), password: "SenhaForte123" });
    expect((await db.doc(`invitations/${second.invitation.id}`).get()).data()!.status).toBe("revoked");
    await expectCode(org("renewInvitation", "pres", { id: second.invitation.id }), "conflict");

    // Convite pendente antigo de quem já virou integrante por outro caminho.
    await createMember("integrante", "Integrante Teste", "assessor-eventos");
    const legacy = db.collection("invitations").doc();
    await legacy.set({ name: "Integrante Teste", email: "integrante@example.org", roleId: "assessor-eventos", departmentIds: [], tokenHash: "x".repeat(64), status: "pending", expiresAt: Timestamp.fromMillis(Date.now() - 1000), createdBy: "pres", createdAt: NOW });
    expect((await expectCode(org("renewInvitation", "pres", { id: legacy.id }), "conflict")).message).toMatch(/Já existe um integrante/);
  });

  it("e-mail que já pertence a um integrante: aceite recusado, conta e convite intactos", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Dupla", email: "dupla@example.org", roleId: "assessor-eventos" });
    // A conta do integrante surge depois do convite (ex.: criada por outro convite).
    await createMember("dupla", "Pessoa Dupla", "assessor-eventos");

    const error = await errorOf(auth("acceptInvitation", undefined, { token: tokenOf(res.link!), password: "OutraSenha123" }));
    expect(error).toMatchObject({ code: "conflict", message: "Já existe uma conta com este e-mail. Entre com o seu e-mail e senha." });

    expect((await adminAuth.getUserByEmail("dupla@example.org")).uid).toBe("dupla");
    expect(await canSignIn("dupla@example.org", "Senha-teste-123")).toBe(true);
    expect(await canSignIn("dupla@example.org", "OutraSenha123")).toBe(false);
    // A reserva do convite é desfeita.
    const inv = (await db.doc(`invitations/${res.invitation.id}`).get()).data()!;
    expect(inv.status).toBe("pending");
    expect(inv.claimId).toBeUndefined();
  });

  it("dois aceites intercalados do mesmo link: só um conclui e a senha é definida uma única vez", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Concorrida", email: "concorrida@example.org", roleId: "assessor-eventos" });
    const token = tokenOf(res.link!);

    // O segundo aceite começa exatamente quando o primeiro já mexeu no Auth e ainda não confirmou a transação.
    const createUser = adminAuth.createUser.bind(adminAuth);
    let second: Promise<PromiseSettledResult<unknown>> | undefined;
    vi.spyOn(adminAuth, "createUser").mockImplementationOnce(async (props) => {
      const user = await createUser(props);
      second = Promise.allSettled([auth("acceptInvitation", undefined, { token, password: "SenhaSegunda22" })]).then(([r]) => r);
      await second;
      return user;
    });
    const updateUser = vi.spyOn(adminAuth, "updateUser");

    const first = await Promise.allSettled([auth("acceptInvitation", undefined, { token, password: "SenhaPrimeira11" })]).then(([r]) => r);
    const results = [first, await second!];
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(first.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "conflict" } });

    // Nenhuma tentativa recusada trocou a senha de uma conta.
    expect(updateUser.mock.calls.some(([, props]) => props.password !== undefined)).toBe(false);
    expect(await canSignIn("concorrida@example.org", "SenhaPrimeira11")).toBe(true);
    expect(await canSignIn("concorrida@example.org", "SenhaSegunda22")).toBe(false);

    const user = await adminAuth.getUserByEmail("concorrida@example.org");
    expect((await db.doc(`members/${user.uid}`).get()).exists).toBe(true);
    const members = await db.collection("memberPrivate").where("email", "==", "concorrida@example.org").get();
    expect(members.size).toBe(1);
  });

  it("aceites simultâneos: exatamente um conclui", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Simultânea", email: "simultanea@example.org", roleId: "assessor-eventos" });
    const token = tokenOf(res.link!);
    const passwords = ["SenhaUm1111", "SenhaDois222", "SenhaTres333"];
    const results = await Promise.allSettled(passwords.map((password) => auth("acceptInvitation", undefined, { token, password })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = passwords[results.findIndex((r) => r.status === "fulfilled")];
    for (const p of passwords) expect(await canSignIn("simultanea@example.org", p)).toBe(p === winner);
    expect((await db.collection("memberPrivate").where("email", "==", "simultanea@example.org").get()).size).toBe(1);
    expect((await db.doc(`invitations/${res.invitation.id}`).get()).data()!.status).toBe("accepted");
  });

  it("reserva em andamento: a prévia mostra o convite normal, a lista mostra pendente e a revogação continua possível", async () => {
    const payload = { name: "Pessoa Reservada", email: "reservada@example.org", roleId: "assessor-eventos" };
    const res = await org<InviteResult>("inviteMember", "pres", payload, "req-convite-reservado-01");
    const token = tokenOf(res.link!);
    const ref = db.doc(`invitations/${res.invitation.id}`);
    await ref.update({ status: "accepting", claimId: "reserva-em-andamento", claimedAt: new Date().toISOString() });

    expect((await auth<{ name: string }>("previewInvitation", undefined, { token })).name).toBe("Pessoa Reservada");
    // A resposta do servidor (aqui, um reenvio da criação) mostra o estado transitório como pendente.
    expect((await org<InviteResult>("inviteMember", "pres", payload, "req-convite-reservado-01")).invitation.status).toBe("pending");
    // Enquanto a reserva vale, não se cria outro convite para o mesmo e-mail.
    await expectCode(org("inviteMember", "pres", payload), "conflict");
    const busy = await errorOf(auth("acceptInvitation", undefined, { token, password: "SenhaForte123" }));
    expect(busy.code).toBe("conflict");
    await expect(adminAuth.getUserByEmail("reservada@example.org")).rejects.toMatchObject({ code: "auth/user-not-found" });
    await expectCode(org("renewInvitation", "pres", { id: res.invitation.id }), "conflict");

    const revoked = await org<{ status: string }>("revokeInvitation", "pres", { id: res.invitation.id });
    expect(revoked.status).toBe("revoked");
    const data = (await ref.get()).data()!;
    expect(data.claimId).toBeUndefined();
    expect(await errorOf(auth("acceptInvitation", undefined, { token, password: "SenhaForte123" }))).toMatchObject({ code: "conflict", message: REVOKED_INVITE });
  });

  it("reserva abandonada (mais de 10 minutos) pode ser assumida por um novo aceite", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Retomada", email: "retomada@example.org", roleId: "assessor-eventos" });
    const token = tokenOf(res.link!);
    await db.doc(`invitations/${res.invitation.id}`).update({ status: "accepting", claimId: "reserva-antiga", claimedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
    // Conta órfã deixada pelo processo interrompido.
    await adminAuth.createUser({ email: "retomada@example.org", password: "SenhaOrfa1234" });

    await auth("acceptInvitation", undefined, { token, password: "SenhaNova1234" });
    expect(await canSignIn("retomada@example.org", "SenhaNova1234")).toBe(true);
    expect((await db.doc(`invitations/${res.invitation.id}`).get()).data()!.status).toBe("accepted");
  });

  it("falha depois da reserva: a conta criada é apagada e o convite volta a pendente", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Sem Cargo", email: "semcargo@example.org", roleId: "assessor-eventos" });
    await db.doc("roles/assessor-eventos").delete();
    const error = await errorOf(auth("acceptInvitation", undefined, { token: tokenOf(res.link!), password: "SenhaForte123" }));
    expect(error.code).toBe("conflict");
    await expect(adminAuth.getUserByEmail("semcargo@example.org")).rejects.toMatchObject({ code: "auth/user-not-found" });
    const inv = (await db.doc(`invitations/${res.invitation.id}`).get()).data()!;
    expect(inv.status).toBe("pending");
    expect(inv.claimId).toBeUndefined();
  });
});

describe("alcance do cargo atribuído (diretoria, nível, departamento)", () => {
  beforeEach(async () => {
    // Cenário da revisão: RH convida, mas não administra permissões.
    await createRole("rh", { departmentId: "secretaria", level: "advisor", isBoard: false, permissions: ["organization.view", "organization.create", "organization.edit", "documents.view"] });
    await createRole("conselho-fin", { departmentId: "financeiro", level: "director", isBoard: true, permissions: ["documents.view"] });
    await createRole("apoio-fin", { departmentId: "financeiro", level: "member", isBoard: false, permissions: ["documents.view"] });
    await createRole("apoio-sec", { departmentId: "secretaria", level: "member", isBoard: false, permissions: ["documents.view"] });
    await createRole("conselho-sec", { departmentId: "secretaria", level: "member", isBoard: true, permissions: ["documents.view"] });
    await createMember("rh", "RH Teste", "rh");
    await createMember("apoio", "Apoio Teste", "apoio-sec");
  });

  it("sem organization.admin, não convida para cargo de diretoria, de nível acima ou de outro departamento", async () => {
    for (const roleId of ["conselho-fin", "apoio-fin", "conselho-sec"]) {
      const error = await expectCode(org("inviteMember", "rh", { name: "Conta Alternativa", email: `rh.alt.${roleId}@example.org`, roleId }), "forbidden");
      expect(error.message).toMatch(/administra permissões/);
    }
    // Cargo com o mesmo alcance (ou menor): permitido.
    await org("inviteMember", "rh", { name: "Pessoa Apoio", email: "apoio.sec@example.org", roleId: "apoio-sec" });
    // Quem administra permissões atribui qualquer alcance.
    await org("inviteMember", "pres", { name: "Conselheira", email: "conselheira@example.org", roleId: "conselho-fin" });
  });

  it("sem organization.admin, não renova convite de cargo com alcance maior", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Conselheira", email: "conselheira@example.org", roleId: "conselho-fin" });
    await expectCode(org("renewInvitation", "rh", { id: res.invitation.id }), "forbidden");
    await org("renewInvitation", "pres", { id: res.invitation.id });
  });

  it("sem organization.admin, não muda o cargo de alguém para um de alcance maior nem reativa quem tem departamentos que não alcança", async () => {
    await expectCode(org("updateMember", "rh", { id: "apoio", input: { roleId: "conselho-fin" } }), "forbidden");
    await expectCode(org("updateMember", "rh", { id: "apoio", input: { roleId: "apoio-fin" } }), "forbidden");
    expect((await db.doc("members/apoio").get()).data()!.roleId).toBe("apoio-sec");

    // Departamento adicional definido por quem administra; o RH desativa, mas não reativa.
    await org("updateMember", "pres", { id: "apoio", input: { departmentIds: ["financeiro"] } });
    await org("updateMember", "rh", { id: "apoio", input: { status: "inactive" } });
    await expectCode(org("updateMember", "rh", { id: "apoio", input: { status: "active" } }), "forbidden");
    await org("updateMember", "pres", { id: "apoio", input: { status: "active" } });
    expect((await db.doc("userAccess/apoio").get()).data()!.tokens).toContain("d:financeiro");
  });

  it("sem organization.admin, não atribui nível com mais acesso nem cargo de um departamento que só tem como adicional", async () => {
    // Cenários da verificação: mesmos marcadores, mas a presidência vê o financeiro de todos os eventos e o
    // departamento principal decide quem edita documentos.
    await createRole("gestor-eventos", { departmentId: "eventos", level: "director", isBoard: true, permissions: ["organization.view", "organization.create", "organization.edit", "events.view", "documents.view", "documents.edit"] });
    await createRole("conselho-pres", { departmentId: "eventos", level: "presidency", isBoard: true, permissions: ["events.view"] });
    await createRole("conselho-dir", { departmentId: "eventos", level: "director", isBoard: true, permissions: ["events.view"] });
    await createRole("conselho-fin-docs", { departmentId: "financeiro", level: "director", isBoard: true, permissions: ["documents.view", "documents.edit"] });
    await createMember("gestor", "Gestor Teste", "gestor-eventos", { departmentIds: ["financeiro"] });
    await createMember("conselheira", "Conselheira Teste", "conselho-dir");

    for (const roleId of ["conselho-pres", "conselho-fin-docs"]) {
      const error = await expectCode(org("inviteMember", "gestor", { name: "Conta Alternativa", email: `alt.${roleId}@example.org`, roleId }), "forbidden");
      expect(error.message).toMatch(/administra permissões/);
      await expectCode(org("updateMember", "gestor", { id: "conselheira", input: { roleId } }), "forbidden");
    }
    expect((await db.doc("members/conselheira").get()).data()!.roleId).toBe("conselho-dir");
    // Mesmo nível e mesmo departamento principal: permitido.
    await org("inviteMember", "gestor", { name: "Conselheira Nova", email: "conselho.dir@example.org", roleId: "conselho-dir" });
    await org("inviteMember", "pres", { name: "Conselheira Pres", email: "conselho.pres@example.org", roleId: "conselho-pres" });
    await org("inviteMember", "pres", { name: "Conselheira Fin", email: "conselho.fin@example.org", roleId: "conselho-fin-docs" });

    // Assessoria: events.edit só edita os dados do evento fora da assessoria.
    await createRole("pessoas-eventos", { departmentId: "eventos", level: "advisor", isBoard: false, permissions: ["organization.view", "organization.create", "events.view", "events.edit"] });
    await createRole("apoio-editor", { departmentId: "eventos", level: "member", isBoard: false, permissions: ["events.view", "events.edit"] });
    await createRole("apoio-leitor", { departmentId: "eventos", level: "member", isBoard: false, permissions: ["events.view"] });
    await createMember("pessoas", "Pessoas Teste", "pessoas-eventos");
    await expectCode(org("inviteMember", "pessoas", { name: "Apoio Editor", email: "apoio.editor@example.org", roleId: "apoio-editor" }), "forbidden");
    await org("inviteMember", "pessoas", { name: "Apoio Leitor", email: "apoio.leitor@example.org", roleId: "apoio-leitor" });
  });

  it("aceite de um convite permitido não dá marcadores além dos de quem convidou", async () => {
    const res = await org<InviteResult>("inviteMember", "rh", { name: "Pessoa Apoio", email: "apoio.sec@example.org", roleId: "apoio-sec" });
    await auth("acceptInvitation", undefined, { token: tokenOf(res.link!), password: "SenhaForte123" });
    const user = await adminAuth.getUserByEmail("apoio.sec@example.org");
    const tokens = (await db.doc(`userAccess/${user.uid}`).get()).data()!.tokens as string[];
    const inviter = (await db.doc("userAccess/rh").get()).data()!.tokens as string[];
    expect(tokens.filter((t) => !t.startsWith("u:") && !t.startsWith("r:")).every((t) => inviter.includes(t))).toBe(true);
  });
});

describe("privacidade: e-mail do convite e reenvios", () => {
  it("o convite aceito não guarda mais o e-mail (a fonte é memberPrivate)", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Nova", email: "pessoa.nova@example.org", roleId: "assessor-eventos" });
    await auth("acceptInvitation", undefined, { token: tokenOf(res.link!), password: "SenhaForte123" });
    const user = await adminAuth.getUserByEmail("pessoa.nova@example.org");
    const inv = (await db.doc(`invitations/${res.invitation.id}`).get()).data()!;
    expect(inv.status).toBe("accepted");
    expect(inv.acceptedUserId).toBe(user.uid);
    expect(inv).not.toHaveProperty("email");
    expect(JSON.stringify(inv)).not.toContain("pessoa.nova@example.org");
    expect((await db.doc(`memberPrivate/${user.uid}`).get()).data()!.email).toBe("pessoa.nova@example.org");
  });

  it("convites antigos do mesmo e-mail (revogado, expirado) também deixam de guardá-lo depois do aceite", async () => {
    const payload = { name: "Pessoa Insistente", email: "insistente@example.org", roleId: "assessor-eventos" };
    const revoked = await org<InviteResult>("inviteMember", "pres", payload);
    await org("revokeInvitation", "pres", { id: revoked.invitation.id });
    const expired = await org<InviteResult>("inviteMember", "pres", payload);
    await db.doc(`invitations/${expired.invitation.id}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const unrelated = await org<InviteResult>("inviteMember", "pres", { ...payload, name: "Outra Pessoa", email: "outra@example.org" });
    const current = await org<InviteResult>("inviteMember", "pres", payload);
    await auth("acceptInvitation", undefined, { token: tokenOf(current.link!), password: "SenhaForte123" });

    expect((await db.collection("invitations").where("email", "==", "insistente@example.org").get()).empty).toBe(true);
    const all = (await db.collection("invitations").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);
    expect(JSON.stringify(all)).not.toContain("insistente@example.org");
    const byId = (id: string) => all.find((d) => d.id === id)!;
    expect(byId(revoked.invitation.id)).toMatchObject({ status: "revoked", name: "Pessoa Insistente" });
    expect(byId(expired.invitation.id)).toMatchObject({ status: "revoked" });
    expect(byId(current.invitation.id)).toMatchObject({ status: "accepted" });
    // Convites de outras pessoas não são tocados.
    expect(byId(unrelated.invitation.id)).toMatchObject({ status: "pending", email: "outra@example.org" });
  });

  it("reenvio (mesmo requestId) de quem perdeu a permissão de convites não devolve o convite", async () => {
    await createRole("convites", { departmentId: "eventos", level: "advisor", isBoard: false, permissions: ["organization.view", "organization.create", "events.view"] });
    await createRole("apoio-eventos", { departmentId: "eventos", level: "member", isBoard: false, permissions: ["events.view"] });
    await createMember("convidador", "Convidador Teste", "convites");

    const inviteReq = "req-convite-reenvio-0001";
    const revokeReq = "req-revoga-reenvio-0001";
    const renewReq = "req-renova-reenvio-0001";
    const payload = { name: "Pessoa Reenvio", email: "reenvio@example.org", roleId: "apoio-eventos" };
    const first = await org<InviteResult>("inviteMember", "convidador", payload, inviteReq);
    await org("renewInvitation", "convidador", { id: first.invitation.id }, renewReq);
    const other = await org<InviteResult>("inviteMember", "convidador", { ...payload, email: "reenvio2@example.org" });
    await org("revokeInvitation", "convidador", { id: other.invitation.id }, revokeReq);
    // Ainda com permissão, o reenvio devolve o convite (sem link).
    expect((await org<InviteResult>("inviteMember", "convidador", payload, inviteReq)).link).toBeNull();

    await org("updateMember", "pres", { id: "convidador", input: { roleId: "apoio-eventos" } });
    await expectCode(org("inviteMember", "convidador", payload, inviteReq), "forbidden");
    await expectCode(org("renewInvitation", "convidador", { id: first.invitation.id }, renewReq), "forbidden");
    await expectCode(org("revokeInvitation", "convidador", { id: other.invitation.id }, revokeReq), "forbidden");
  });
});

describe("links usados ou revogados: mensagem específica, sem dados do convite", () => {
  it("link de convite revogado", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Revogada", email: "revogada@example.org", roleId: "assessor-eventos" });
    await org("revokeInvitation", "pres", { id: res.invitation.id });
    const token = tokenOf(res.link!);
    // Chamadas criadas uma de cada vez: uma recusa ainda não aguardada viraria "unhandled rejection".
    for (const call of [() => auth("previewInvitation", undefined, { token }), () => auth("acceptInvitation", undefined, { token, password: "SenhaForte123" })]) {
      const error = await errorOf(call());
      expect(error).toMatchObject({ code: "conflict", message: REVOKED_INVITE });
      expect(JSON.stringify(error)).not.toMatch(/revogada@example\.org|Pessoa Revogada|Assessor/);
    }
    await expect(adminAuth.getUserByEmail("revogada@example.org")).rejects.toMatchObject({ code: "auth/user-not-found" });
  });

  it("link de convite já usado", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Usada", email: "usada@example.org", roleId: "assessor-eventos" });
    const token = tokenOf(res.link!);
    await auth("acceptInvitation", undefined, { token, password: "SenhaForte123" });
    for (const call of [() => auth("previewInvitation", undefined, { token }), () => auth("acceptInvitation", undefined, { token, password: "OutraSenha123" })]) {
      const error = await errorOf(call());
      expect(error).toMatchObject({ code: "conflict", message: USED_INVITE });
      expect(JSON.stringify(error)).not.toMatch(/usada@example\.org|Pessoa Usada|Assessor/);
    }
    expect(await canSignIn("usada@example.org", "SenhaForte123")).toBe(true);
    expect(await canSignIn("usada@example.org", "OutraSenha123")).toBe(false);
  });

  it("link substituído por uma renovação continua inválido", async () => {
    const res = await org<InviteResult>("inviteMember", "pres", { name: "Pessoa Renovada", email: "renovada@example.org", roleId: "assessor-eventos" });
    await org("renewInvitation", "pres", { id: res.invitation.id });
    const error = await errorOf(auth("previewInvitation", undefined, { token: tokenOf(res.link!) }));
    expect(error).toMatchObject({ code: "not_found", message: INVALID_INVITE });
  });
});

describe("validação em português", () => {
  it("token curto, longo ou ausente: mensagem de convite inválido", async () => {
    for (const token of ["x", "y".repeat(201)]) {
      expect(await errorOf(auth("previewInvitation", undefined, { token }))).toMatchObject({ code: "invalid", message: INVALID_INVITE });
      expect(await errorOf(auth("acceptInvitation", undefined, { token, password: "SenhaForte123" }))).toMatchObject({ code: "invalid", message: INVALID_INVITE });
    }
    expect(await errorOf(auth("previewInvitation", undefined, {}))).toMatchObject({ code: "invalid", message: INVALID_INVITE });
  });

  it("limites dos demais campos da organização têm mensagens próprias", async () => {
    const long = "a".repeat(401);
    const cases: [() => Promise<unknown>, RegExp][] = [
      [() => org("createDepartment", "pres", { name: "Esportes", shortName: "ESP", description: long, active: true }), /descrição pode ter no máximo 400/],
      [() => org("revokeInvitation", "pres", { id: "" }), /identificador/i],
      [() => org("revokeInvitation", "pres", { id: "z".repeat(129) }), /identificador/i],
      [() => org("inviteMember", "pres", { name: "Pessoa", email: `${"e".repeat(200)}@example.org`, roleId: "assessor-eventos" }), /e-mail/i],
    ];
    for (const [call, message] of cases) {
      const error = await errorOf(call());
      expect(error.code).toBe("invalid");
      expect(error.message).toMatch(message);
      expect(error.message).not.toMatch(/Too (small|big)|expected/);
    }
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { eventDoc } from "@/lib/firestore-model";
import type { AtleticaEvent, Meeting, Permission } from "@/types";
import { meetingsActions } from "../src/modules/meetings";
import { auditFor, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const meetings = caller("meetings", meetingsActions);

const BOARD = { scope: "board", roleIds: [], userIds: [] };
const NOW = "2026-10-14T12:00:00.000Z";

function meetingInput(over: Record<string, unknown> = {}) {
  return {
    title: "Reunião ordinária de teste",
    date: "2026-10-20",
    startTime: "19:00",
    endTime: "20:30",
    mode: "presencial",
    location: "Sala da Atlética",
    participantIds: ["sec", "fin"],
    guests: [],
    eventId: null,
    agenda: ["Balanço do mês", "  ", "Calendário"],
    summary: "Discussão do balanço e do calendário.",
    decisions: ["Aprovado o calendário"],
    actions: [{ description: "Publicar o calendário", responsibleId: "mkt", dueDate: "2026-10-25" }],
    documentIds: [],
    access: BOARD,
    ...over,
  };
}

async function createMeeting(uid = "sec", over: Record<string, unknown> = {}) {
  return meetings<Meeting>("create", uid, meetingInput(over));
}

async function stored(id: string) {
  return (await db.doc(`meetings/${id}`).get()).data()!;
}

async function customRole(id: string, permissions: Permission[]) {
  await db.doc(`roles/${id}`).set({
    name: `Cargo ${id}`,
    description: "",
    departmentId: "secretaria",
    level: "member",
    isBoard: false,
    active: true,
    homePreset: "advisor",
    permissions,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

/** Evento gravado diretamente (o módulo de eventos tem testes próprios). */
async function seedEvent(id: string, over: Partial<AtleticaEvent> = {}) {
  const ev: AtleticaEvent = {
    id,
    code: "EVT-2026-001",
    name: "Calourada de Teste",
    description: "",
    objective: "",
    type: "festa",
    date: "2026-11-20",
    time: "20:00",
    location: "Quadra",
    departmentId: "eventos",
    responsibleIds: ["evt"],
    access: { scope: "all", roleIds: [], userIds: [] },
    status: "planning",
    schedule: [],
    tasks: [],
    suppliers: [],
    createdBy: "evt",
    createdAt: NOW,
    updatedAt: NOW,
    history: [],
    ...over,
  };
  await db.doc(`events/${id}`).set(eventDoc(ev));
}

async function seedDocument(id: string, access: Record<string, unknown>) {
  await db.doc(`documents/${id}`).set({
    name: "Regimento de teste",
    description: "",
    categoryId: "atas",
    departmentId: "secretaria",
    access,
    status: "current",
    versions: [],
    links: {},
    sample: false,
    createdBy: "sec",
    createdAt: NOW,
    updatedAt: NOW,
    history: [],
    readers: ["u:sec"],
  });
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
  // Redator: registra reuniões, mas não edita as dos outros, não aprova nem arquiva.
  await customRole("redator-atas", ["meetings.view", "meetings.create", "documents.view"]);
  await createMember("red", "Redator Teste", "redator-atas");
  // Aprovador: aprova atas, mas não arquiva.
  await customRole("aprovador-atas", ["meetings.view", "meetings.approve"]);
  await createMember("apr", "Aprovador Teste", "aprovador-atas");
});

describe("registro e público", () => {
  it("quem tem meetings.create registra; o servidor gera código, autor, datas e readers", async () => {
    const m = await createMeeting("sec", { access: { scope: "people", roleIds: [], userIds: ["mkt"] }, participantIds: ["fin", "evt", "fin"] });
    expect(m.code).toMatch(/^REU-\d{4}-001$/);
    expect(m.createdBy).toBe("sec");
    expect(m.status).toBe("draft");
    expect(m.participantIds).toEqual(["fin", "evt"]);
    expect(m.agenda).toEqual(["Balanço do mês", "Calendário"]);
    expect(m.history).toHaveLength(1);
    expect(m.history[0]).toMatchObject({ action: "created", actorId: "sec" });
    expect(m).not.toHaveProperty("readers");
    const data = await stored(m.id);
    // público + criador + participantes
    expect(data.readers).toEqual(["u:evt", "u:fin", "u:mkt", "u:sec"]);
    const index = (await db.doc(`searchIndex/meeting__${m.id}`).get()).data()!;
    expect(index.readers).toEqual(data.readers);
    expect(index.terms).toContain("ordinaria");
  });

  it("registrar exige meetings.create e pelo menos um participante", async () => {
    await expectCode(createMeeting("fin"), "forbidden");
    await expectCode(createMeeting("evt"), "forbidden");
    const e = await expectCode(createMeeting("sec", { participantIds: [] }), "invalid");
    expect(e.message).toMatch(/participante/);
    // Sem nenhum acesso ao módulo.
    await expectCode(createMeeting("ass"), "forbidden");
  });

  it("campos enviados pelo cliente como createdBy, readers, status ou id são recusados", async () => {
    await expectCode(meetings("create", "sec", { ...meetingInput(), createdBy: "pres" }), "invalid");
    await expectCode(meetings("create", "sec", { ...meetingInput(), readers: ["all"] }), "invalid");
    await expectCode(meetings("create", "sec", { ...meetingInput(), status: "approved" }), "invalid");
    await expectCode(meetings("create", "sec", { ...meetingInput(), id: "forjado" }), "invalid");
    await expectCode(meetings("create", "sec", { ...meetingInput(), access: { ...BOARD, extra: true } }), "invalid");
    const m = await createMeeting("sec");
    await expectCode(meetings("update", "sec", { id: m.id, input: { history: [] } }), "invalid");
  });

  it("participante inválido, inativo ou com identificador malicioso é recusado", async () => {
    await createMember("inativo", "Inativo Teste", "assessor-eventos", { status: "inactive" });
    const e1 = await expectCode(createMeeting("sec", { participantIds: ["sec", "ninguem"] }), "invalid");
    expect(e1.message).toMatch(/não é integrante/);
    const e2 = await expectCode(createMeeting("sec", { participantIds: ["inativo"] }), "invalid");
    expect(e2.message).toMatch(/desativada/);
    await expectCode(createMeeting("sec", { participantIds: ["../members/pres"] }), "invalid");
    await expectCode(createMeeting("sec", { actions: [{ description: "Tarefa", responsibleId: "ninguem" }] }), "invalid");

    // Quem já participava pode permanecer depois de ter a conta desativada; novos inativos não entram.
    const m = await createMeeting("sec", { participantIds: ["sec", "ext"] });
    await db.doc("members/ext").update({ status: "inactive" });
    const kept = await meetings<Meeting>("update", "sec", { id: m.id, input: { participantIds: ["sec", "ext"], title: "Título revisado" } });
    expect(kept.participantIds).toEqual(["sec", "ext"]);
    await expectCode(meetings("update", "sec", { id: m.id, input: { participantIds: ["sec", "ext", "inativo"] } }), "invalid");
  });

  it("término precisa ser depois do início (no registro e na edição)", async () => {
    const e = await expectCode(createMeeting("sec", { startTime: "19:00", endTime: "18:00" }), "invalid");
    expect(e.message).toMatch(/término/);
    await expectCode(createMeeting("sec", { startTime: "19:00", endTime: "19:00" }), "invalid");
    await expectCode(createMeeting("sec", { date: "2026-02-30" }), "invalid");
    const m = await createMeeting("sec");
    await expectCode(meetings("update", "sec", { id: m.id, input: { endTime: "18:30" } }), "invalid");
    const cleared = await meetings<Meeting>("update", "sec", { id: m.id, input: { endTime: null } });
    expect(cleared.endTime).toBeUndefined();
    expect(await stored(m.id)).not.toHaveProperty("endTime");
  });

  it("convidados externos: só nomes, guardados sem repetição e fora da auditoria", async () => {
    const m = await createMeeting("sec", { guests: ["  Profa. Convidada  ", "Representante do DCE", "profa. convidada", ""] });
    expect(m.guests).toEqual(["Profa. Convidada", "Representante do DCE"]);
    expect((await stored(m.id)).guests).toEqual(["Profa. Convidada", "Representante do DCE"]);

    await expectCode(createMeeting("sec", { guests: ["A"] }), "invalid");
    await expectCode(createMeeting("sec", { guests: ["x".repeat(81)] }), "invalid");
    await expectCode(createMeeting("sec", { guests: Array.from({ length: 51 }, (_, i) => `Convidado ${i}`) }), "invalid");
    await expectCode(createMeeting("sec", { guests: [{ name: "Objeto" }] }), "invalid");

    const updated = await meetings<Meeting>("update", "sec", { id: m.id, input: { guests: ["Palestrante Externo"] } });
    expect(updated.guests).toEqual(["Palestrante Externo"]);
    const logs = JSON.stringify(await auditFor(m.id));
    expect(logs).not.toContain("Convidada");
    expect(logs).not.toContain("Palestrante");
    expect((await auditFor(m.id)).find((a) => a.action === "meetings.create")!.details.guests).toBe(2);
  });

  it("evento relacionado precisa existir e estar visível para quem vincula", async () => {
    await seedEvent("evt-visivel");
    await seedEvent("evt-restrito", { access: { scope: "department", departmentId: "eventos", roleIds: [], userIds: [] } });
    const e = await expectCode(createMeeting("sec", { eventId: "nao-existe" }), "invalid");
    expect(e.message).toMatch(/evento relacionado/);
    await expectCode(createMeeting("sec", { eventId: "evt-restrito" }), "invalid");
    const m = await createMeeting("sec", { eventId: "evt-visivel", guests: ["Profa. Convidada"] });
    expect(m.eventId).toBe("evt-visivel");
    expect((await stored(m.id)).eventId).toBe("evt-visivel");
    // Campos ausentes não são alterados.
    const renamed = await meetings<Meeting>("update", "sec", { id: m.id, input: { title: "Reunião sobre a Calourada" } });
    expect(renamed.eventId).toBe("evt-visivel");
    expect(renamed.guests).toEqual(["Profa. Convidada"]);
    // Um vínculo que já existia não é reconferido (o evento pode ter ficado restrito depois).
    await db.doc("events/evt-visivel").update({ access: { scope: "department", departmentId: "eventos", roleIds: [], userIds: [] }, readers: ["d:eventos"] });
    await meetings("update", "sec", { id: m.id, input: { eventId: "evt-visivel", location: "Sala 2" } });
    // Limpar o vínculo.
    const cleared = await meetings<Meeting>("update", "sec", { id: m.id, input: { eventId: null } });
    expect(cleared.eventId).toBeUndefined();
  });

  it("documentos relacionados precisam existir e estar visíveis; encaminhamentos recebem ids do servidor", async () => {
    // "red" vê documentos pelo público (sem documents.admin).
    await seedDocument("doc-visivel", { scope: "all", roleIds: [], userIds: [] });
    await seedDocument("doc-restrito", { scope: "people", roleIds: [], userIds: ["pres"] });
    await expectCode(createMeeting("red", { documentIds: ["doc-inexistente"] }), "invalid");
    await expectCode(createMeeting("red", { documentIds: ["doc-restrito"] }), "invalid");
    const m = await createMeeting("red", { documentIds: ["doc-visivel"], actions: [{ id: "act-forjado", description: "Enviar convite", responsibleId: "", dueDate: "" }, { description: "   " }] });
    expect(m.documentIds).toEqual(["doc-visivel"]);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0].id).not.toBe("act-forjado");
    expect(m.actions[0]).not.toHaveProperty("responsibleId");
    // Ao editar, o id de um encaminhamento existente é mantido.
    const edited = await meetings<Meeting>("update", "red", {
      id: m.id,
      input: { actions: [{ id: m.actions[0].id, description: "Enviar convite revisado" }, { description: "Novo encaminhamento", responsibleId: "fin" }] },
    });
    expect(edited.actions.map((a) => a.id)[0]).toBe(m.actions[0].id);
    expect(edited.actions[1].responsibleId).toBe("fin");
  });

  it("módulo desativado recusa as operações", async () => {
    const m = await createMeeting("sec");
    await db.doc("settings/system").update({ "modules.meetings": false });
    await expectCode(createMeeting("sec"), "unavailable");
    await expectCode(meetings("update", "sec", { id: m.id, input: { title: "Outro título" } }), "unavailable");
    await expectCode(meetings("setStatus", "sec", { id: m.id, status: "pending_approval" }), "unavailable");
  });
});

describe("edição", () => {
  it("edição recalcula readers e o índice; quem não vê a reunião não a altera", async () => {
    const m = await createMeeting("sec", { access: { scope: "people", roleIds: [], userIds: ["mkt"] }, participantIds: ["sec"] });
    await expectCode(meetings("update", "evt", { id: m.id, input: { title: "Invasão" } }), "forbidden");
    await expectCode(meetings("setStatus", "evt", { id: m.id, status: "pending_approval" }), "forbidden");
    await expectCode(meetings("update", "sec", { id: "nao-existe", input: { title: "Nada" } }), "not_found");

    const updated = await meetings<Meeting>("update", "sec", { id: m.id, input: { participantIds: ["sec", "evt"], access: BOARD, title: "Reunião renomeada" } });
    expect(updated.history.map((h) => h.action)).toEqual(["created", "updated", "shared"]);
    const data = await stored(m.id);
    expect(data.readers).toEqual(["board", "u:evt", "u:sec"]);
    const index = (await db.doc(`searchIndex/meeting__${m.id}`).get()).data()!;
    expect(index.readers).toEqual(data.readers);
    expect(index.title).toBe("Reunião renomeada");
  });

  it("participante só com meetings.view vê, mas não edita; criador edita a própria reunião", async () => {
    const m = await createMeeting("red", { participantIds: ["red", "mkt"], access: { scope: "people", roleIds: [], userIds: ["red"] } });
    await expectCode(meetings("update", "mkt", { id: m.id, input: { title: "Outro título" } }), "forbidden");
    const own = await meetings<Meeting>("update", "red", { id: m.id, input: { title: "Título do redator" } });
    expect(own.title).toBe("Título do redator");
    // Sem meetings.edit, não edita a reunião de outra pessoa, mesmo participando dela.
    const bySec = await createMeeting("sec", { participantIds: ["sec", "red"] });
    await expectCode(meetings("update", "red", { id: bySec.id, input: { title: "Alheia" } }), "forbidden");
  });

  it("ata aprovada ou arquivada não pode ser editada (conflito), nem pela presidência", async () => {
    const m = await createMeeting("sec");
    await meetings("setStatus", "sec", { id: m.id, status: "pending_approval" });
    await meetings("setStatus", "sec", { id: m.id, status: "approved" });
    const e = await expectCode(meetings("update", "sec", { id: m.id, input: { summary: "Alterado depois" } }), "conflict");
    expect(e.message).toMatch(/aprovadas ou arquivadas/);
    await expectCode(meetings("update", "pres", { id: m.id, input: { title: "Alterado" } }), "conflict");
    await meetings("setStatus", "sec", { id: m.id, status: "archived" });
    await expectCode(meetings("update", "sec", { id: m.id, input: { title: "Alterado" } }), "conflict");
    expect((await stored(m.id)).summary).toBe("Discussão do balanço e do calendário.");
  });
});

describe("situação e aprovação da ata", () => {
  it("o criador envia para aprovação; quem não aprova não aprova; aprovar registra quem e quando", async () => {
    const m = await createMeeting("red", { participantIds: ["red", "fin", "apr"] });
    // Participante sem meetings.edit e sem ser o criador não envia.
    await expectCode(meetings("setStatus", "fin", { id: m.id, status: "pending_approval" }), "forbidden");
    const pending = await meetings<Meeting>("setStatus", "red", { id: m.id, status: "pending_approval" });
    expect(pending.status).toBe("pending_approval");
    expect(pending.history.at(-1)).toMatchObject({ action: "status", actorId: "red", summary: "Enviada para aprovação" });

    // O criador sem meetings.approve não aprova a própria ata.
    await expectCode(meetings("setStatus", "red", { id: m.id, status: "approved" }), "forbidden");
    await expectCode(meetings("setStatus", "fin", { id: m.id, status: "approved" }), "forbidden");
    expect((await stored(m.id)).status).toBe("pending_approval");

    const approved = await meetings<Meeting>("setStatus", "apr", { id: m.id, status: "approved" });
    expect(approved.status).toBe("approved");
    const last = approved.history.at(-1)!;
    expect(last).toMatchObject({ action: "status", actorId: "apr", summary: "Ata aprovada" });
    expect(last.at).toBe(approved.updatedAt);
    const approval = (await auditFor(m.id)).find((a) => a.action === "meetings.approve")!;
    expect(approval).toMatchObject({ actorId: "apr", outcome: "success" });
    expect(approval.details).toMatchObject({ from: "pending_approval", to: "approved", approvedBy: "apr", approvedAt: last.at });
  });

  it("aprovação é o único caminho para “aprovada”; transições inexistentes são conflito", async () => {
    const m = await createMeeting("sec");
    await expectCode(meetings("setStatus", "sec", { id: m.id, status: "approved" }), "conflict");
    await expectCode(meetings("setStatus", "sec", { id: m.id, status: "archived" }), "conflict");
    await expectCode(meetings("setStatus", "sec", { id: m.id, status: "draft" }), "conflict");
    expect((await stored(m.id)).status).toBe("draft");
  });

  it("resumo é obrigatório para enviar para aprovação e para continuar aguardando", async () => {
    const m = await createMeeting("sec", { summary: "   " });
    const e = await expectCode(meetings("setStatus", "sec", { id: m.id, status: "pending_approval" }), "invalid");
    expect(e.message).toMatch(/resumo/);
    await meetings("update", "sec", { id: m.id, input: { summary: "Resumo preenchido." } });
    await meetings("setStatus", "sec", { id: m.id, status: "pending_approval" });
    await expectCode(meetings("update", "sec", { id: m.id, input: { summary: "" } }), "invalid");
    // Devolvida para rascunho, a ata volta a aceitar edição livre.
    await meetings("setStatus", "sec", { id: m.id, status: "draft" });
    const cleared = await meetings<Meeting>("update", "sec", { id: m.id, input: { summary: "" } });
    expect(cleared.summary).toBe("");
  });

  it("arquivar uma ata aprovada exige meetings.archive (aprovar não basta)", async () => {
    const m = await createMeeting("sec", { participantIds: ["sec", "apr", "red"] });
    await meetings("setStatus", "sec", { id: m.id, status: "pending_approval" });
    await meetings("setStatus", "apr", { id: m.id, status: "approved" });
    await expectCode(meetings("setStatus", "apr", { id: m.id, status: "archived" }), "forbidden");
    await expectCode(meetings("setStatus", "red", { id: m.id, status: "archived" }), "forbidden");
    const archived = await meetings<Meeting>("setStatus", "sec", { id: m.id, status: "archived" });
    expect(archived.status).toBe("archived");
    expect(archived.history.at(-1)).toMatchObject({ action: "archived", summary: "Ata arquivada" });
    expect((await db.doc(`searchIndex/meeting__${m.id}`).get()).data()!.archived).toBe(true);
    // Desarquivar também exige meetings.archive e não é uma nova aprovação.
    await expectCode(meetings("setStatus", "apr", { id: m.id, status: "approved" }), "forbidden");
    const restored = await meetings<Meeting>("setStatus", "sec", { id: m.id, status: "approved" });
    expect(restored.history.at(-1)!.summary).toBe("Ata desarquivada");
    // Devolver uma ata aprovada para rascunho exige meetings.approve.
    await expectCode(meetings("setStatus", "red", { id: m.id, status: "draft" }), "forbidden");
    const back = await meetings<Meeting>("setStatus", "apr", { id: m.id, status: "draft" });
    expect(back.status).toBe("draft");
    const actions = (await auditFor(m.id)).map((a) => a.action);
    expect(actions.filter((a) => a === "meetings.approve")).toHaveLength(1);
  });
});

describe("avisos", () => {
  it("registro avisa o público (menos quem registrou); envio para aprovação avisa só quem aprova e vê a ata", async () => {
    const m = await createMeeting("red", { participantIds: ["red", "fin", "apr"], access: BOARD });
    const registered = await db.collection("notifications").where("kind", "==", "meeting_registered").get();
    const toRegistered = registered.docs.map((d) => d.data().recipientId).sort();
    // Diretoria com meetings.view + participantes; "ass"/"assmkt" não têm o módulo; o autor não é avisado.
    expect(toRegistered).toEqual(["apr", "evt", "ext", "fin", "mkt", "pres", "sec", "vice"]);
    expect(registered.docs.every((d) => d.id.startsWith(`meeting_registered__${m.id}__`))).toBe(true);

    await meetings("setStatus", "red", { id: m.id, status: "pending_approval" });
    const pending = await db.collection("notifications").where("title", "==", "Ata aguardando aprovação").get();
    const toPending = pending.docs.map((d) => d.data().recipientId).sort();
    expect(toPending).toEqual(["apr", "pres", "sec", "vice"]);
    expect(pending.docs.every((d) => d.data().href === `/secretaria/${m.id}`)).toBe(true);
  });

  it("aprovador fora do público da ata não é avisado", async () => {
    const m = await createMeeting("sec", { participantIds: ["sec", "fin"], access: { scope: "people", roleIds: [], userIds: ["fin"] } });
    await meetings("setStatus", "sec", { id: m.id, status: "pending_approval" });
    const pending = await db.collection("notifications").where("title", "==", "Ata aguardando aprovação").get();
    // "pres", "vice" e "apr" aprovam, mas não estão no público; "sec" é quem enviou.
    expect(pending.docs.map((d) => d.data().recipientId)).toEqual([]);
  });
});

describe("integridade e auditoria", () => {
  it("repetir a mesma requisição não duplica a reunião nem a mudança de situação", async () => {
    const rid = "req-reuniao-idempotente-01";
    const a = await meetings<Meeting>("create", "sec", meetingInput(), rid);
    const b = await meetings<Meeting>("create", "sec", meetingInput(), rid);
    expect(b.id).toBe(a.id);
    expect((await db.collection("meetings").get()).size).toBe(1);
    expect((await db.doc(`counters/${a.code.slice(0, 8)}`).get()).data()!.value).toBe(1);

    const sid = "req-situacao-idempotente-01";
    await meetings("setStatus", "sec", { id: a.id, status: "pending_approval" }, sid);
    const again = await meetings<Meeting>("setStatus", "sec", { id: a.id, status: "pending_approval" }, sid);
    expect(again.status).toBe("pending_approval");
    expect((await stored(a.id)).history).toHaveLength(2);
    expect((await auditFor(a.id)).filter((l) => l.action === "meetings.setStatus")).toHaveLength(1);
    // O mesmo identificador não pode ser reaproveitado para outra operação.
    await expectCode(meetings("update", "sec", { id: a.id, input: { title: "Outro" } }, sid), "conflict");
  });

  it("toda alteração gera auditoria (incluindo meetings.setStatus), sem textos livres ou nomes de convidados", async () => {
    const m = await createMeeting("sec", { guests: ["Convidada Especial"], summary: "Texto sigiloso do resumo" });
    await meetings("update", "sec", { id: m.id, input: { location: "Ginásio" } });
    await meetings("setStatus", "sec", { id: m.id, status: "pending_approval" });
    await meetings("setStatus", "sec", { id: m.id, status: "draft" });
    await meetings("setStatus", "sec", { id: m.id, status: "pending_approval" });
    await meetings("setStatus", "sec", { id: m.id, status: "approved" });
    await meetings("setStatus", "sec", { id: m.id, status: "archived" });

    const logs = await auditFor(m.id);
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(
      ["meetings.approve", "meetings.create", "meetings.setStatus", "meetings.setStatus", "meetings.setStatus", "meetings.setStatus", "meetings.update"].sort(),
    );
    const transitions = logs.filter((l) => l.action === "meetings.setStatus").map((l) => `${l.details.from}>${l.details.to}`).sort();
    expect(transitions).toEqual(["approved>archived", "draft>pending_approval", "draft>pending_approval", "pending_approval>draft"].sort());
    expect(logs.every((l) => l.actorId === "sec" && l.outcome === "success" && l.requestId && l.module === "meetings")).toBe(true);
    const text = JSON.stringify(logs);
    expect(text).not.toContain("Convidada");
    expect(text).not.toContain("sigiloso");
  });
});

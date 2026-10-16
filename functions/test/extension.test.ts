import { beforeEach, describe, expect, it } from "vitest";
import { documentDoc } from "@/lib/firestore-model";
import type { AtleticaEvent, ExtensionProject, InstitutionalDocument } from "@/types";
import { loadActorOutsideTx } from "../src/core/dispatch";
import { eventsActions } from "../src/modules/events";
import { extensionActions, MAX_ATTENDEES, presentProject } from "../src/modules/extension";
import { auditFor, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const ext = caller("extension", extensionActions);
const events = caller("events", eventsActions);

const ALL = { scope: "all", roleIds: [], userIds: [] };
const NOW = "2026-10-14T12:00:00.000Z";

function projectInput(over: Record<string, unknown> = {}) {
  return {
    name: "Roda de conversa sobre saúde mental",
    description: "Encontro aberto com convidados",
    objective: "Aproximar a graduação da prática",
    activityType: "roda_conversa",
    responsibleId: "assext",
    date: "2026-11-10",
    time: "19:00",
    location: "Auditório do bloco B",
    eventId: null,
    certificateHours: 4,
    access: ALL,
    ...over,
  };
}

async function createProject(uid = "ext", over: Record<string, unknown> = {}) {
  return ext<ExtensionProject>("create", uid, projectInput(over));
}

async function stored(id: string) {
  return (await db.doc(`projects/${id}`).get()).data()!;
}

async function storedAttendance(id: string) {
  return (await db.doc(`projects/${id}/private/attendance`).get()).data()!;
}

/** Cargo sob medida (as permissões vêm sempre do cargo gravado, nunca do nome). */
async function customRole(id: string, permissions: string[]) {
  await db.doc(`roles/${id}`).set({
    name: `Cargo ${id}`,
    description: "Cargo criado para o teste",
    departmentId: "extensao",
    level: "advisor",
    isBoard: false,
    active: true,
    permissions,
    homePreset: "advisor",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function seedDocument(id: string, over: Partial<InstitutionalDocument> = {}) {
  const d: InstitutionalDocument = {
    id,
    name: "Relatório de extensão 2026",
    description: "",
    categoryId: "relatorios-extensao",
    departmentId: "extensao",
    access: { scope: "all", roleIds: [], userIds: [] },
    status: "current",
    versions: [],
    links: {},
    sample: false,
    createdBy: "ext",
    createdAt: NOW,
    updatedAt: NOW,
    history: [],
    ...over,
  };
  await db.doc(`documents/${id}`).set(documentDoc(d));
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
  await createMember("assext", "Assessora Extensão Teste", "assessor-extensao");
});

describe("criação", () => {
  it("diretoria de extensão cria; o servidor gera código, autor, readers, lista privada e índice de busca", async () => {
    const p = await createProject("ext", { access: { scope: "people", roleIds: [], userIds: ["sec"] } });
    expect(p.code).toMatch(/^ENS-\d{4}-001$/);
    expect(p.createdBy).toBe("ext");
    expect(p.status).toBe("planning");
    expect(p.certificateStatus).toBe("not_started");
    expect(p.attendees).toEqual([]);
    expect(p.attendeesRestricted).toBe(false);
    expect(p.history).toHaveLength(1);
    expect(p).not.toHaveProperty("readers");
    expect(p).not.toHaveProperty("editors");

    const data = await stored(p.id);
    // criador + responsável + público
    expect(data.readers).toEqual(["u:assext", "u:ext", "u:sec"]);
    expect(data.attendeeCount).toBe(0);
    expect(data).not.toHaveProperty("attendees");
    const att = await storedAttendance(p.id);
    expect(att.attendees).toEqual([]);
    expect(att.editors).toEqual(["u:assext", "u:ext"]);
    const index = (await db.doc(`searchIndex/project__${p.id}`).get()).data()!;
    expect(index.readers).toEqual(data.readers);
    expect(index.terms).toContain("conversa");
  });

  it("perfis sem extension.create não criam projetos", async () => {
    await expectCode(createProject("sec"), "forbidden");
    await expectCode(createProject("assext"), "forbidden");
    await expectCode(createProject("evt"), "forbidden");
  });

  it("valida campos, recusa campos extras e confere responsável e evento no servidor", async () => {
    await expectCode(ext("create", "ext", { ...projectInput(), createdBy: "pres" }), "invalid");
    await expectCode(ext("create", "ext", { ...projectInput(), readers: ["all"] }), "invalid");
    await expectCode(ext("create", "ext", { ...projectInput(), attendees: [{ id: "a", name: "X", present: true }] }), "invalid");
    await expectCode(createProject("ext", { certificateHours: 401 }), "invalid");
    await expectCode(createProject("ext", { certificateHours: -1 }), "invalid");
    await expectCode(createProject("ext", { name: "AB" }), "invalid");
    await expectCode(createProject("ext", { date: "2026-02-30" }), "invalid");
    await expectCode(createProject("ext", { responsibleId: "ninguem" }), "invalid");
    await expectCode(createProject("ext", { responsibleId: "../members/pres" }), "invalid");
    await expectCode(createProject("ext", { eventId: "nao-existe" }), "not_found");

    const ev = await events<AtleticaEvent>("create", "evt", {
      name: "Semana acadêmica",
      type: "academico",
      date: "2026-11-10",
      time: "08:00",
      location: "Campus",
      departmentId: "eventos",
      responsibleIds: ["evt"],
      access: ALL,
    });
    const linked = await createProject("ext", { eventId: ev.id, certificateHours: 400 });
    expect(linked.eventId).toBe(ev.id);
    expect(linked.certificateHours).toBe(400);
  });

  it("módulo desativado recusa as operações", async () => {
    const p = await createProject();
    await db.doc("settings/system").update({ "modules.extension": false });
    await expectCode(createProject(), "unavailable");
    await expectCode(ext("addAttendee", "ext", { id: p.id, name: "Pessoa Teste" }), "unavailable");
  });
});

describe("lista de presença (dados pessoais)", () => {
  it("quem não edita o projeto recebe a lista restrita; quem edita vê os nomes", async () => {
    await customRole("arquivista-ext", ["extension.view", "extension.archive"]);
    await createMember("arq", "Arquivista Teste", "arquivista-ext");
    const p = await createProject();
    await ext("addAttendee", "assext", { id: p.id, name: "Maria Participante" });
    const editorView = await ext<ExtensionProject>("addAttendee", "ext", { id: p.id, name: "João Participante" });
    expect(editorView.attendeesRestricted).toBe(false);
    expect(editorView.attendees.map((a) => a.name)).toEqual(["Maria Participante", "João Participante"]);
    expect(editorView.attendeeCount).toBe(2);

    // Mutação permitida a quem NÃO edita (concluir, com extension.archive): resposta sem nomes.
    const viewerResult = await ext<ExtensionProject>("setStatus", "arq", { id: p.id, status: "done" });
    expect(viewerResult.status).toBe("done");
    expect(viewerResult.attendeesRestricted).toBe(true);
    expect(viewerResult.attendees).toEqual([]);
    expect(viewerResult.attendeeCount).toBe(2);
    expect(JSON.stringify(viewerResult)).not.toContain("Maria");

    // Leitora apenas (secretaria com extension.view): mesma regra na montagem da resposta.
    const secView = await presentProject(p.id, await loadActorOutsideTx("sec"));
    expect(secView.attendeesRestricted).toBe(true);
    expect(secView.attendees).toEqual([]);
    // Presidência (extension.admin) vê os nomes.
    const presView = await presentProject(p.id, await loadActorOutsideTx("pres"));
    expect(presView.attendees).toHaveLength(2);
    // Quem não tem extension.view não recebe nada.
    await expectCode(presentProject(p.id, await loadActorOutsideTx("evt")), "forbidden");
    // Quem não edita não altera a lista.
    await expectCode(ext("addAttendee", "sec", { id: p.id, name: "Outra Pessoa" }), "forbidden");
    await expectCode(ext("setAttendance", "arq", { id: p.id, attendeeId: editorView.attendees[0].id, present: true }), "forbidden");
  });

  it("nomes nunca aparecem no documento do projeto, no histórico, no índice nem na auditoria", async () => {
    const p = await createProject();
    const r = await ext<ExtensionProject>("addAttendee", "assext", { id: p.id, name: "Beatriz Confidencial" });
    await ext("setAttendance", "assext", { id: p.id, attendeeId: r.attendees[0].id, present: true });
    await ext("update", "ext", { id: p.id, input: { location: "Sala 12" } });
    await ext("setStatus", "ext", { id: p.id, status: "open" });

    const projectText = JSON.stringify(await stored(p.id));
    expect(projectText).not.toContain("Beatriz");
    expect(projectText).not.toContain("Confidencial");
    expect((await stored(p.id)).attendeeCount).toBe(1);
    expect(JSON.stringify((await db.doc(`searchIndex/project__${p.id}`).get()).data())).not.toContain("beatriz");
    const logs = await auditFor(p.id);
    expect(logs.map((l) => l.action).sort()).toEqual(["extension.addAttendee", "extension.create", "extension.setAttendance", "extension.setStatus", "extension.update"].sort());
    expect(JSON.stringify(logs)).not.toMatch(/Beatriz|Confidencial|beatriz/);
    expect(logs.every((l) => l.outcome === "success" && l.requestId)).toBe(true);
    // A lista fica só no documento privado.
    expect((await storedAttendance(p.id)).attendees).toEqual([{ id: r.attendees[0].id, name: "Beatriz Confidencial", present: true }]);
  });

  it("nomes repetidos são recusados (sem diferenciar maiúsculas e espaços) e há limite de participantes", async () => {
    const p = await createProject();
    await ext("addAttendee", "ext", { id: p.id, name: "  Ana   Souza " });
    const e = await expectCode(ext("addAttendee", "ext", { id: p.id, name: "ana souza" }), "conflict");
    expect(e.message).toMatch(/já está na lista/);
    await expectCode(ext("addAttendee", "ext", { id: p.id, name: "A" }), "invalid");
    expect((await storedAttendance(p.id)).attendees.map((a: { name: string }) => a.name)).toEqual(["Ana Souza"]);

    const full = Array.from({ length: MAX_ATTENDEES }, (_, i) => ({ id: `att-${i}`, name: `Participante ${i}`, present: false }));
    await db.doc(`projects/${p.id}/private/attendance`).update({ attendees: full });
    await expectCode(ext("addAttendee", "ext", { id: p.id, name: "Mais Uma Pessoa" }), "conflict");
  });

  it("marcação de presença: participante inexistente é recusado e a marcação repetida não muda nada", async () => {
    const p = await createProject();
    const r = await ext<ExtensionProject>("addAttendee", "ext", { id: p.id, name: "Carlos Teste" });
    const aid = r.attendees[0].id;
    await expectCode(ext("setAttendance", "ext", { id: p.id, attendeeId: "att-nao-existe", present: true }), "not_found");
    const marked = await ext<ExtensionProject>("setAttendance", "assext", { id: p.id, attendeeId: aid, present: true });
    expect(marked.attendees[0].present).toBe(true);
    await ext("setAttendance", "assext", { id: p.id, attendeeId: aid, present: true });
    expect((await auditFor(p.id)).filter((l) => l.action === "extension.setAttendance")).toHaveLength(1);
    const unmarked = await ext<ExtensionProject>("setAttendance", "assext", { id: p.id, attendeeId: aid, present: false });
    expect(unmarked.attendees[0].present).toBe(false);
  });
});

describe("responsáveis e edição", () => {
  it("assessor(a) de extensão designado(a) como responsável edita e vê a lista; secretaria só edita quando é responsável", async () => {
    const p = await createProject("ext", { responsibleId: "assext", access: { scope: "board", roleIds: [], userIds: [] } });
    const withSpeaker = await ext<ExtensionProject>("addSpeaker", "assext", { id: p.id, speaker: { name: "Dra. Convidada", affiliation: "Universidade", topic: "Clínica" } });
    expect(withSpeaker.speakers).toHaveLength(1);
    expect(withSpeaker.attendeesRestricted).toBe(false);
    await ext("addScheduleItem", "assext", { id: p.id, item: { time: "20:00", title: "Debate" } });
    const sched = await ext<ExtensionProject>("addScheduleItem", "assext", { id: p.id, item: { time: "19:00", title: "Abertura" } });
    expect(sched.schedule.map((s) => s.time)).toEqual(["19:00", "20:00"]);

    // Secretaria (só extension.view) não edita…
    await expectCode(ext("update", "sec", { id: p.id, input: { location: "Outro local" } }), "forbidden");
    await expectCode(ext("addSpeaker", "sec", { id: p.id, speaker: { name: "X", affiliation: "" } }), "forbidden");
    // …até ser designada responsável: aí edita e passa a ver a lista.
    await ext("update", "ext", { id: p.id, input: { responsibleId: "sec" } });
    expect((await storedAttendance(p.id)).editors).toEqual(["u:ext", "u:sec"]);
    expect((await stored(p.id)).readers).toContain("u:sec");
    const bySec = await ext<ExtensionProject>("update", "sec", { id: p.id, input: { report: "Relatório da atividade." } });
    expect(bySec.report).toBe("Relatório da atividade.");
    expect(bySec.attendeesRestricted).toBe(false);
    expect(bySec.history.at(-1)!.summary).toBe("Relatório atualizado");

    // Responsável removido(a): perde a edição.
    await ext("update", "ext", { id: p.id, input: { responsibleId: "assext" } });
    await expectCode(ext("update", "sec", { id: p.id, input: { report: "Outro texto" } }), "forbidden");
    expect((await storedAttendance(p.id)).editors).toEqual(["u:assext", "u:ext"]);
  });

  it("edição recalcula readers e índice, limpa campos esvaziados e mantém a lista", async () => {
    const p = await createProject();
    await ext("addAttendee", "ext", { id: p.id, name: "Diego Teste" });
    const updated = await ext<ExtensionProject>("update", "ext", {
      id: p.id,
      input: { name: "Roda de conversa renomeada", time: null, certificateHours: null, access: { scope: "people", roleIds: [], userIds: ["fin"] } },
    });
    expect(updated.name).toBe("Roda de conversa renomeada");
    expect(updated.time).toBeUndefined();
    expect(updated.certificateHours).toBeUndefined();
    expect(updated.attendees).toHaveLength(1);
    const data = await stored(p.id);
    expect(data.readers).toEqual(["u:assext", "u:ext", "u:fin"]);
    expect(data).not.toHaveProperty("time");
    expect(data.attendeeCount).toBe(1);
    const index = (await db.doc(`searchIndex/project__${p.id}`).get()).data()!;
    expect(index.title).toBe("Roda de conversa renomeada");
    expect(index.readers).toEqual(data.readers);
    // criação, participante adicionado, edição e mudança de visibilidade
    expect(updated.history.map((h) => h.action)).toEqual(["created", "updated", "updated", "shared"]);
    await expectCode(ext("update", "ext", { id: p.id, input: { certificateHours: 500 } }), "invalid");
    await expectCode(ext("update", "ext", { id: p.id, input: { readers: ["all"] } }), "invalid");
  });

  it("quem não vê o projeto não consegue alterá-lo", async () => {
    const p = await createProject("ext", { access: { scope: "people", roleIds: [], userIds: ["pres"] } });
    await expectCode(ext("addSpeaker", "sec", { id: p.id, speaker: { name: "X", affiliation: "" } }), "forbidden");
    await expectCode(ext("update", "evt", { id: p.id, input: { location: "Outro" } }), "forbidden");
    await expectCode(ext("update", "ext", { id: "nao-existe", input: { location: "Outro" } }), "not_found");
  });
});

describe("situação do projeto", () => {
  it("realizar ou cancelar exige extension.archive ou ser o criador; reabrir também", async () => {
    await customRole("criador-ext", ["extension.view", "extension.create"]);
    await createMember("cri", "Criadora Teste", "criador-ext");
    const p = await createProject("cri", { responsibleId: "assext" });
    // Assessora (extension.edit, sem archive, não criadora): abre inscrições, mas não conclui.
    const opened = await ext<ExtensionProject>("setStatus", "assext", { id: p.id, status: "open" });
    expect(opened.status).toBe("open");
    await expectCode(ext("setStatus", "assext", { id: p.id, status: "done" }), "forbidden");
    await expectCode(ext("setStatus", "assext", { id: p.id, status: "cancelled" }), "forbidden");
    // Criadora sem extension.archive conclui.
    const done = await ext<ExtensionProject>("setStatus", "cri", { id: p.id, status: "done" });
    expect(done.status).toBe("done");
    expect((await db.doc(`searchIndex/project__${p.id}`).get()).data()!.archived).toBe(true);
    // Reabrir um projeto realizado: só quem pode concluir.
    await expectCode(ext("setStatus", "assext", { id: p.id, status: "planning" }), "forbidden");
    await expectCode(ext("setStatus", "cri", { id: p.id, status: "open" }), "conflict");
    const reopened = await ext<ExtensionProject>("setStatus", "cri", { id: p.id, status: "planning" });
    expect(reopened.status).toBe("planning");
    expect(reopened.history.filter((h) => h.action === "status")).toHaveLength(3);
    // Diretoria (extension.archive) cancela projeto de outra pessoa.
    expect((await ext<ExtensionProject>("setStatus", "ext", { id: p.id, status: "cancelled" })).status).toBe("cancelled");
  });
});

describe("certificados", () => {
  it("emitir exige extension.approve e pelo menos um participante presente", async () => {
    const p = await createProject();
    // Sem participantes presentes: recusado mesmo para quem aprova.
    const e = await expectCode(ext("setCertificateStatus", "ext", { id: p.id, status: "issued" }), "invalid");
    expect(e.message).toMatch(/presença/);
    const r = await ext<ExtensionProject>("addAttendee", "ext", { id: p.id, name: "Elisa Teste" });
    await expectCode(ext("setCertificateStatus", "ext", { id: p.id, status: "issued" }), "invalid");
    await ext("setAttendance", "ext", { id: p.id, attendeeId: r.attendees[0].id, present: true });
    // Assessora edita o projeto, mas não tem extension.approve.
    await expectCode(ext("setCertificateStatus", "assext", { id: p.id, status: "issued" }), "forbidden");
    expect((await ext<ExtensionProject>("setCertificateStatus", "assext", { id: p.id, status: "in_progress" })).certificateStatus).toBe("in_progress");
    const issued = await ext<ExtensionProject>("setCertificateStatus", "ext", { id: p.id, status: "issued" });
    expect(issued.certificateStatus).toBe("issued");
    expect(issued.history.at(-1)!.summary).toBe("Certificados: Emitidos");
    // Desfazer a emissão também exige extension.approve.
    await expectCode(ext("setCertificateStatus", "assext", { id: p.id, status: "in_progress" }), "forbidden");
    // Quem só vê o projeto não altera certificados.
    await expectCode(ext("setCertificateStatus", "sec", { id: p.id, status: "in_progress" }), "forbidden");
  });
});

describe("documentos vinculados", () => {
  it("o documento precisa existir e estar visível para quem vincula", async () => {
    const p = await createProject();
    await seedDocument("doc-visivel");
    await seedDocument("doc-restrito", { createdBy: "pres", access: { scope: "people", roleIds: [], userIds: ["pres"] } });
    await expectCode(ext("linkDocument", "assext", { id: p.id, documentId: "doc-nao-existe" }), "not_found");
    await expectCode(ext("linkDocument", "assext", { id: p.id, documentId: "doc-restrito" }), "not_found");
    await expectCode(ext("linkDocument", "sec", { id: p.id, documentId: "doc-visivel" }), "forbidden");
    await expectCode(ext("linkDocument", "assext", { id: p.id, documentId: "../documents/x" }), "invalid");
    const linked = await ext<ExtensionProject>("linkDocument", "assext", { id: p.id, documentId: "doc-visivel" });
    expect(linked.documentIds).toEqual(["doc-visivel"]);
    // Vincular de novo não duplica.
    await ext("linkDocument", "assext", { id: p.id, documentId: "doc-visivel" });
    expect((await stored(p.id)).documentIds).toEqual(["doc-visivel"]);
    // A presidência vê o documento restrito e pode vinculá-lo; o nome dele não vai para o histórico.
    const byPres = await ext<ExtensionProject>("linkDocument", "pres", { id: p.id, documentId: "doc-restrito" });
    expect(byPres.documentIds).toEqual(["doc-visivel", "doc-restrito"]);
    expect(JSON.stringify(byPres.history)).not.toContain("Relatório de extensão");
  });
});

describe("integridade", () => {
  it("repetir a mesma requisição não duplica o projeto nem o participante", async () => {
    const rid = "req-projeto-idempotente-01";
    const a = await ext<ExtensionProject>("create", "ext", projectInput(), rid);
    const b = await ext<ExtensionProject>("create", "ext", projectInput(), rid);
    expect(b.id).toBe(a.id);
    expect((await db.collection("projects").get()).size).toBe(1);
    expect((await db.doc(`counters/${a.code.slice(0, 8)}`).get()).data()!.value).toBe(1);

    const tid = "req-participante-idem-01";
    const r1 = await ext<ExtensionProject>("addAttendee", "ext", { id: a.id, name: "Fábio Teste" }, tid);
    const r2 = await ext<ExtensionProject>("addAttendee", "ext", { id: a.id, name: "Fábio Teste" }, tid);
    expect(r2.attendees).toEqual(r1.attendees);
    expect((await storedAttendance(a.id)).attendees).toHaveLength(1);
    expect((await auditFor(a.id)).filter((l) => l.action === "extension.addAttendee")).toHaveLength(1);
  });
});

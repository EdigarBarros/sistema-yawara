import { beforeEach, describe, expect, it } from "vitest";
import { eventDoc } from "@/lib/firestore-model";
import type { AtleticaEvent, EventTask } from "@/types";
import { eventsActions, MAX_TASKS } from "../src/modules/events";
import { auditFor, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const events = caller("events", eventsActions);

function eventInput(over: Record<string, unknown> = {}) {
  return {
    name: "Calourada de Teste",
    description: "Recepção dos calouros",
    objective: "Integrar as turmas",
    type: "festa",
    date: "2026-11-20",
    time: "20:00",
    location: "Quadra coberta",
    departmentId: "eventos",
    responsibleIds: ["evt", "ass"],
    notes: "Observação interna",
    budget: 150000,
    access: { scope: "department", departmentId: "eventos", roleIds: [], userIds: [] },
    ...over,
  };
}

const ALL = { scope: "all", roleIds: [], userIds: [] };

async function createEvent(uid = "evt", over: Record<string, unknown> = {}) {
  return events<AtleticaEvent>("create", uid, eventInput(over));
}

async function stored(id: string) {
  return (await db.doc(`events/${id}`).get()).data()!;
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("criação e público", () => {
  it("quem tem events.create cria; o servidor gera código, autor, datas e readers", async () => {
    const ev = await createEvent("evt", { access: { scope: "people", roleIds: [], userIds: ["fin"] } });
    expect(ev.code).toMatch(/^EVT-\d{4}-001$/);
    expect(ev.createdBy).toBe("evt");
    expect(ev.status).toBe("planning");
    expect(ev.history).toHaveLength(1);
    expect(ev).not.toHaveProperty("readers");
    const data = await stored(ev.id);
    // criador + responsáveis + público
    expect(data.readers).toEqual(["u:ass", "u:evt", "u:fin"]);
    const index = (await db.doc(`searchIndex/event__${ev.id}`).get()).data()!;
    expect(index.readers).toEqual(data.readers);
    expect(index.terms).toContain("calourada");
  });

  it("perfis sem events.create não criam eventos", async () => {
    await expectCode(createEvent("sec"), "forbidden");
    await expectCode(createEvent("ass"), "forbidden");
  });

  it("campos enviados pelo cliente como createdBy, readers ou id são recusados", async () => {
    await expectCode(events("create", "evt", { ...eventInput(), createdBy: "pres" }), "invalid");
    await expectCode(events("create", "evt", { ...eventInput(), readers: ["all"] }), "invalid");
    await expectCode(events("create", "evt", { ...eventInput(), access: { ...ALL, extra: true } }), "invalid");
  });

  it("responsável e departamento são conferidos no servidor", async () => {
    await createMember("inativo", "Inativo Teste", "assessor-eventos", { status: "inactive" });
    const e1 = await expectCode(createEvent("evt", { responsibleIds: ["evt", "ninguem"] }), "invalid");
    expect(e1.message).toMatch(/não é integrante/);
    const e2 = await expectCode(createEvent("evt", { responsibleIds: ["inativo"] }), "invalid");
    expect(e2.message).toMatch(/desativada/);
    await expectCode(createEvent("evt", { departmentId: "nao-existe" }), "invalid");
    await expectCode(createEvent("evt", { responsibleIds: [] }), "invalid");
    await expectCode(createEvent("evt", { responsibleIds: ["../members/pres"] }), "invalid");

    const ev = await createEvent("evt", { access: ALL });
    await expectCode(events("addTask", "evt", { eventId: ev.id, input: { title: "Tarefa X", departmentId: "eventos", status: "todo", responsibleId: "inativo" } }), "invalid");
    await expectCode(events("addTask", "evt", { eventId: ev.id, input: { title: "Tarefa X", departmentId: "nao-existe", status: "todo" } }), "invalid");
  });

  it("módulo desativado recusa as operações", async () => {
    await db.doc("settings/system").update({ "modules.events": false });
    await expectCode(createEvent("evt"), "unavailable");
  });
});

describe("edição, tarefas e programação", () => {
  it("assessor com events.edit não edita dados do evento nem fornecedores, mas edita tarefas e programação", async () => {
    const ev = await createEvent("evt");
    await expectCode(events("update", "ass", { id: ev.id, input: { name: "Outro nome" } }), "forbidden");
    await expectCode(events("addSupplier", "ass", { eventId: ev.id, input: { name: "Som", service: "Som e luz", status: "quoted" } }), "forbidden");
    await expectCode(events("setStatus", "ass", { id: ev.id, status: "confirmed" }), "forbidden");

    const task = await events<EventTask>("addTask", "ass", { eventId: ev.id, input: { title: "Comprar copos", departmentId: "eventos", status: "todo", responsibleId: null, dueDate: null } });
    expect(task.title).toBe("Comprar copos");
    expect(task).not.toHaveProperty("responsibleId");
    const moved = await events<EventTask>("updateTask", "ass", { eventId: ev.id, taskId: task.id, input: { status: "doing" } });
    expect(moved.status).toBe("doing");
    const withItem = await events<AtleticaEvent>("addScheduleItem", "ass", { eventId: ev.id, input: { time: "21:00", title: "Abertura" } });
    expect(withItem.schedule.map((s) => s.title)).toEqual(["Abertura"]);
    const removed = await events<AtleticaEvent>("removeScheduleItem", "ass", { eventId: ev.id, itemId: withItem.schedule[0].id });
    expect(removed.schedule).toHaveLength(0);
    expect((await stored(ev.id)).name).toBe("Calourada de Teste");
  });

  it("o responsável por uma tarefa altera a situação dela (e só ela)", async () => {
    const ev = await createEvent("evt", { access: ALL });
    const own = await events<EventTask>("addTask", "evt", { eventId: ev.id, input: { title: "Conferir atas", departmentId: "secretaria", status: "todo", responsibleId: "sec" } });
    const other = await events<EventTask>("addTask", "evt", { eventId: ev.id, input: { title: "Montar palco", departmentId: "eventos", status: "todo" } });

    // "sec" só tem events.view: não edita tarefas em geral…
    await expectCode(events("addTask", "sec", { eventId: ev.id, input: { title: "Nova", departmentId: "eventos", status: "todo" } }), "forbidden");
    await expectCode(events("updateTask", "sec", { eventId: ev.id, taskId: other.id, input: { status: "done" } }), "forbidden");
    // …mas move a própria tarefa.
    const done = await events<EventTask>("updateTask", "sec", { eventId: ev.id, taskId: own.id, input: { status: "done", notes: "Feito" } });
    expect(done.status).toBe("done");
    expect(done.notes).toBe("Feito");
    // Não pode renomear nem repassar a tarefa.
    await expectCode(events("updateTask", "sec", { eventId: ev.id, taskId: own.id, input: { title: "Outro título" } }), "forbidden");
    await expectCode(events("updateTask", "sec", { eventId: ev.id, taskId: own.id, input: { responsibleId: "fin" } }), "forbidden");
    const history = (await stored(ev.id)).history as { summary: string }[];
    expect(history.at(-1)!.summary).toContain("movida para Concluída");
  });

  it("edição recalcula readers, limpa campos esvaziados e avisa o público (menos quem editou)", async () => {
    const ev = await createEvent("evt");
    const updated = await events<AtleticaEvent>("update", "evt", {
      id: ev.id,
      input: { access: { scope: "people", roleIds: [], userIds: ["mkt"] }, responsibleIds: ["evt"], budget: null, notes: "" },
    });
    expect(updated.budget).toBeUndefined();
    expect(updated.notes).toBeUndefined();
    const data = await stored(ev.id);
    expect(data.readers).toEqual(["u:evt", "u:mkt"]);
    expect(data).not.toHaveProperty("budget");
    expect(updated.history.map((h) => h.action)).toEqual(["created", "updated", "shared"]);

    // Campos ausentes não são alterados.
    await events("update", "evt", { id: ev.id, input: { budget: 5000 } });
    await events("update", "evt", { id: ev.id, input: { name: "Calourada Renomeada" } });
    expect((await stored(ev.id)).budget).toBe(5000);
    expect((await db.doc(`searchIndex/event__${ev.id}`).get()).data()!.title).toBe("Calourada Renomeada");

    const notes = await db.collection("notifications").where("kind", "==", "event_updated").get();
    const recipients = notes.docs.map((d) => d.data().recipientId);
    expect(recipients).toContain("mkt");
    expect(recipients).not.toContain("evt");
    expect(recipients).not.toContain("sec");
  });

  it("quem não vê o evento não consegue alterá-lo", async () => {
    const ev = await createEvent("evt");
    await expectCode(events("addTask", "sec", { eventId: ev.id, input: { title: "Tarefa", departmentId: "eventos", status: "todo" } }), "forbidden");
    await expectCode(events("update", "mkt", { id: ev.id, input: { name: "Invasão" } }), "forbidden");
    await expectCode(events("update", "evt", { id: "nao-existe", input: { name: "Nada" } }), "not_found");
    // events.admin vê e edita qualquer evento, mesmo fora do público.
    const byAdmin = await events<AtleticaEvent>("update", "pres", { id: ev.id, input: { location: "Ginásio" } });
    expect(byAdmin.location).toBe("Ginásio");
    expect((await stored(ev.id)).readers).toEqual(["d:eventos", "u:ass", "u:evt"]);
  });

  it("limites de tarefas e bloqueio de evento cancelado", async () => {
    const ev = await createEvent("evt", { access: ALL });
    const full = (await stored(ev.id)) as Omit<AtleticaEvent, "id">;
    const now = new Date().toISOString();
    const tasks: EventTask[] = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `tsk-${i}`, title: `Tarefa ${i}`, departmentId: "eventos", status: "todo", createdAt: now, updatedAt: now }));
    await db.doc(`events/${ev.id}`).set(eventDoc({ ...full, id: ev.id, tasks }));
    const e = await expectCode(events("addTask", "evt", { eventId: ev.id, input: { title: "Mais uma", departmentId: "eventos", status: "todo" } }), "conflict");
    expect(e.message).toContain(String(MAX_TASKS));

    await events("setStatus", "evt", { id: ev.id, status: "cancelled" });
    await expectCode(events("updateTask", "evt", { eventId: ev.id, taskId: "tsk-1", input: { status: "done" } }), "conflict");
    await expectCode(events("addSupplier", "evt", { eventId: ev.id, input: { name: "Som", service: "Som", status: "quoted" } }), "conflict");
  });
});

describe("situação do evento", () => {
  it("concluir ou cancelar exige events.archive ou ser o criador", async () => {
    const ev = await createEvent("pres", { access: ALL, responsibleIds: ["ext"] });
    // "ext" é responsável, mas não tem events.archive.
    await expectCode(events("setStatus", "ext", { id: ev.id, status: "done" }), "forbidden");
    await expectCode(events("setStatus", "ass", { id: ev.id, status: "cancelled" }), "forbidden");
    const confirmed = await events<AtleticaEvent>("setStatus", "evt", { id: ev.id, status: "confirmed" });
    expect(confirmed.status).toBe("confirmed");
    const done = await events<AtleticaEvent>("setStatus", "evt", { id: ev.id, status: "done" });
    expect(done.status).toBe("done");
    expect((await db.doc(`searchIndex/event__${ev.id}`).get()).data()!.archived).toBe(true);
    // Transição inexistente.
    await expectCode(events("setStatus", "evt", { id: ev.id, status: "confirmed" }), "conflict");

    // O criador sem events.archive pode encerrar o próprio evento.
    const own = await createEvent("ext", { access: ALL, responsibleIds: ["ext"] });
    const cancelled = await events<AtleticaEvent>("setStatus", "ext", { id: own.id, status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect((await auditFor(own.id)).some((a) => a.action === "events.setStatus" && a.details.to === "cancelled")).toBe(true);
  });
});

describe("duplicação", () => {
  it("copia só a estrutura de planejamento, com novo código e histórico nos dois registros", async () => {
    const src = await createEvent("evt", { access: ALL });
    await events("addScheduleItem", "evt", { eventId: src.id, input: { time: "20:00", title: "Abertura dos portões" } });
    await events("addSupplier", "evt", { eventId: src.id, input: { name: "Som Total", service: "Som e luz", contact: "(11) 99999-0000", status: "hired" } });
    const t = await events<EventTask>("addTask", "evt", {
      eventId: src.id,
      input: { title: "Contratar segurança", departmentId: "eventos", status: "doing", responsibleId: "ass", dueDate: "2026-11-10", notes: "Pedir 3 orçamentos" },
    });
    await events("updateTask", "evt", { eventId: src.id, taskId: t.id, input: { status: "done" } });

    await expectCode(events("duplicate", "sec", { id: src.id, name: "Cópia", date: "2027-03-10" }), "forbidden");
    const copy = await events<AtleticaEvent>("duplicate", "evt", { id: src.id, name: "Calourada 2027.1", date: "2027-03-10" });

    expect(copy.id).not.toBe(src.id);
    expect(copy.code).toMatch(/^EVT-\d{4}-002$/);
    expect(copy.name).toBe("Calourada 2027.1");
    expect(copy.date).toBe("2027-03-10");
    expect(copy.status).toBe("planning");
    expect(copy.duplicatedFromId).toBe(src.id);
    expect(copy.budget).toBeUndefined();
    expect(copy.notes).toBeUndefined();
    expect(copy.schedule).toHaveLength(1);
    expect(copy.schedule[0].title).toBe("Abertura dos portões");
    expect(copy.suppliers).toEqual([{ id: expect.any(String), name: "Som Total", service: "Som e luz", status: "quoted" }]);
    expect(copy.tasks).toHaveLength(1);
    expect(copy.tasks[0]).toMatchObject({ title: "Contratar segurança", status: "todo", responsibleId: "ass" });
    expect(copy.tasks[0].dueDate).toBeUndefined();
    expect(copy.tasks[0].notes).toBeUndefined();
    expect(copy.tasks[0].id).not.toBe(t.id);
    expect(copy.history).toHaveLength(1);
    expect(copy.history[0].action).toBe("duplicated");
    const rawCopy = await stored(copy.id);
    expect(rawCopy).not.toHaveProperty("budget");
    expect(JSON.stringify(rawCopy)).not.toContain("99999");
    expect(rawCopy.readers).toEqual(["all", "u:ass", "u:evt"]);

    const source = await stored(src.id);
    expect(source.budget).toBe(150000);
    expect((source.history as { action: string; summary: string }[]).at(-1)).toMatchObject({ action: "duplicated", summary: expect.stringContaining("Calourada 2027.1") });
    expect((await db.doc(`searchIndex/event__${copy.id}`).get()).exists).toBe(true);
    expect((await auditFor(copy.id)).some((a) => a.action === "events.duplicate" && a.details.sourceId === src.id)).toBe(true);
  });
});

describe("integridade e auditoria", () => {
  it("repetir a mesma requisição não duplica o evento nem a tarefa", async () => {
    const rid = "req-evento-idempotente-01";
    const a = await events<AtleticaEvent>("create", "evt", eventInput(), rid);
    const b = await events<AtleticaEvent>("create", "evt", eventInput(), rid);
    expect(b.id).toBe(a.id);
    expect((await db.collection("events").get()).size).toBe(1);
    expect((await db.doc(`counters/${a.code.slice(0, 8)}`).get()).data()!.value).toBe(1);

    const tid = "req-tarefa-idempotente-01";
    const input = { eventId: a.id, input: { title: "Única tarefa", departmentId: "eventos", status: "todo" } };
    const t1 = await events<EventTask>("addTask", "evt", input, tid);
    const t2 = await events<EventTask>("addTask", "evt", input, tid);
    expect(t2.id).toBe(t1.id);
    expect((await stored(a.id)).tasks).toHaveLength(1);
  });

  it("toda alteração gera auditoria, sem nomes ou contatos de fornecedores", async () => {
    const ev = await createEvent("evt", { access: ALL });
    await events("update", "evt", { id: ev.id, input: { location: "Ginásio" } });
    const t = await events<EventTask>("addTask", "evt", { eventId: ev.id, input: { title: "Tarefa auditada", departmentId: "eventos", status: "todo" } });
    await events("updateTask", "evt", { eventId: ev.id, taskId: t.id, input: { status: "blocked" } });
    const withSupplier = await events<AtleticaEvent>("addSupplier", "evt", { eventId: ev.id, input: { name: "Buffet da Maria", service: "Alimentação", contact: "maria@example.org", status: "quoted" } });
    await events("updateSupplier", "evt", { eventId: ev.id, supplierId: withSupplier.suppliers[0].id, input: { status: "hired" } });
    await events("addScheduleItem", "evt", { eventId: ev.id, input: { time: "19:00", title: "Credenciamento" } });
    await events("setStatus", "evt", { id: ev.id, status: "confirmed" });

    const logs = await auditFor(ev.id);
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(
      ["events.addScheduleItem", "events.addSupplier", "events.addTask", "events.create", "events.setStatus", "events.update", "events.updateSupplier", "events.updateTask"].sort(),
    );
    expect(logs.every((l) => l.actorId === "evt" && l.outcome === "success" && l.requestId)).toBe(true);
    const text = JSON.stringify(logs);
    expect(text).not.toContain("Maria");
    expect(text).not.toContain("maria@example.org");
  });
});

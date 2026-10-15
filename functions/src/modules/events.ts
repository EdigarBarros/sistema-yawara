/**
 * EVENTOS E PROJETOS: eventos, tarefas, programação e fornecedores.
 * ---------------------------------------------------------------------------
 * Armazenamento: `events/{id}` = eventDoc(evento) — tarefas, programação e
 * fornecedores ficam no próprio documento (limites: 300 tarefas, 100 itens de
 * programação, 100 fornecedores), junto com `readers` (criador + responsáveis
 * + público), sempre recalculado aqui.
 *
 * Regras (as mesmas do serviço de demonstração e de src/lib/policies.ts):
 *  - Ver: `canSeeEvent` (público, criador, responsáveis ou events.admin).
 *  - Dados do evento e fornecedores: `canEditEvent` (assessores com
 *    events.edit NÃO editam dados do evento).
 *  - Tarefas e programação: `canEditTasks` (inclui assessores com events.edit
 *    e responsáveis designados). O responsável por uma tarefa pode alterar a
 *    situação e as observações da própria tarefa.
 *  - Concluir ou cancelar (arquivar): criador ou events.archive (`canCloseEvent`).
 *  - Duplicar: copia SOMENTE a estrutura de planejamento (programação, tarefas
 *    reiniciadas, fornecedores como orçamento e sem contato). Nunca copia
 *    orçamento, lançamentos, vendas, compradores, observações ou histórico.
 *  - Evento cancelado: tarefas, programação e fornecedores ficam bloqueados até
 *    o evento voltar para planejamento.
 *
 * A auditoria não registra nomes de fornecedores, contatos ou textos livres —
 * apenas identificadores, códigos e contagens.
 */
import { randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { eventDoc } from "@/lib/firestore-model";
import { EVENT_STATUS, TASK_STATUS } from "@/lib/labels";
import { canCloseEvent, canEditEvent, canEditTasks, canSeeEvent } from "@/lib/policies";
import { eventReaders } from "@/lib/record-readers";
import type { AtleticaEvent, Audience, AudienceScope, EventStatus, EventTask, EventType, HistoryAction, HistoryEntry, ScheduleItem, Supplier, TaskStatus } from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { nextCode } from "../core/counters";
import { mutation, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { appendHistory, historyEntry } from "../core/history";
import { notify } from "../core/notify";
import { requireDoc, toDTO } from "../core/records";
import { indexRecord, searchEntryFor } from "../core/search-index";

/* ------------------------------- limites -------------------------------- */

export const MAX_TASKS = 300;
export const MAX_SCHEDULE = 100;
export const MAX_SUPPLIERS = 100;
export const MAX_RESPONSIBLES = 20;

/* ------------------------------- esquemas ------------------------------- */

const EVENT_TYPES = ["festa", "esportivo", "academico", "integracao", "arrecadacao", "projeto", "outro"] as const satisfies readonly EventType[];
const EVENT_STATUSES = ["planning", "confirmed", "done", "cancelled"] as const satisfies readonly EventStatus[];
const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const satisfies readonly TaskStatus[];
const SUPPLIER_STATUSES = ["quoted", "hired", "declined"] as const satisfies readonly Supplier["status"][];
const AUDIENCE_SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const satisfies readonly AudienceScope[];

/** Objeto que recusa campos desconhecidos (com mensagem em português). */
function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? "Alguns campos enviados não são aceitos nesta operação. Atualize a página e tente novamente." : undefined),
  });
}

/** Identificadores usados em caminhos do Firestore: sem barras ou caracteres especiais. */
const docId = z.string({ error: "Identificador inválido." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Identificador inválido.");

function isRealDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const dateOnly = (message: string) =>
  z
    .string({ error: message })
    .regex(/^\d{4}-\d{2}-\d{2}$/, message)
    .refine(isRealDate, "Data inválida.");

const timeOnly = (message: string) => z.string({ error: message }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, message);

/** Texto opcional: `null`/vazio limpa o campo. */
const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label} pode ter no máximo ${max} caracteres.`).nullish();

const audienceSchema = strict({
  scope: z.enum(AUDIENCE_SCOPES, { error: "Escolha quem pode ver o evento." }),
  departmentId: z.union([docId, z.literal("")]).nullish(),
  roleIds: z.array(docId).max(50, "Escolha no máximo 50 cargos.").default([]),
  userIds: z.array(docId).max(100, "Escolha no máximo 100 pessoas.").default([]),
}).superRefine((a, ctx) => {
  if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos um cargo." });
  if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos uma pessoa." });
});

const eventFields = {
  name: z.string({ error: "Informe o nome do evento (mínimo de 3 caracteres)." }).trim().min(3, "Informe o nome do evento (mínimo de 3 caracteres).").max(120, "O nome do evento pode ter no máximo 120 caracteres."),
  description: z.string().trim().max(800, "A descrição pode ter no máximo 800 caracteres."),
  objective: z.string().trim().max(400, "O objetivo pode ter no máximo 400 caracteres."),
  type: z.enum(EVENT_TYPES, { error: "Escolha um tipo de evento válido." }),
  date: dateOnly("Informe a data do evento."),
  time: timeOnly("Informe o horário do evento."),
  location: z.string({ error: "Informe o local do evento." }).trim().min(1, "Informe o local do evento.").max(200, "O local pode ter no máximo 200 caracteres."),
  departmentId: docId,
  responsibleIds: z
    .array(docId)
    .min(1, "Designe pelo menos um responsável.")
    .max(MAX_RESPONSIBLES, `Designe no máximo ${MAX_RESPONSIBLES} responsáveis.`),
  notes: optionalText(600, "As observações"),
  budget: z
    .number({ error: "Informe o orçamento em centavos." })
    .int("Informe o orçamento em centavos.")
    .min(0, "O orçamento não pode ser negativo.")
    .max(1_000_000_000, "O orçamento informado é alto demais.")
    .nullish(),
  access: audienceSchema,
};

/** Campos editáveis do evento (os nomes entram na auditoria; os valores, não). */
const EVENT_FIELDS = ["name", "description", "objective", "type", "date", "time", "location", "departmentId", "responsibleIds", "notes", "budget", "access"] as const;

const createSchema = strict({
  ...eventFields,
  description: eventFields.description.default(""),
  objective: eventFields.objective.default(""),
});

const updateSchema = strict({ id: docId, input: strict(eventFields).partial() });

const statusSchema = strict({ id: docId, status: z.enum(EVENT_STATUSES, { error: "Situação inválida." }) });

const duplicateSchema = strict({
  id: docId,
  name: z.string({ error: "Informe o nome do novo evento." }).trim().min(3, "Informe o nome do novo evento.").max(120, "O nome do evento pode ter no máximo 120 caracteres."),
  date: dateOnly("Informe a data do novo evento."),
});

/** Responsável opcional: vazio ou `null` = sem responsável. */
const optionalMember = z.union([docId, z.literal("")]).nullish();

const taskFields = {
  title: z.string({ error: "Informe o nome da tarefa (mínimo de 3 caracteres)." }).trim().min(3, "Informe o nome da tarefa (mínimo de 3 caracteres).").max(120, "O nome da tarefa pode ter no máximo 120 caracteres."),
  description: optionalText(400, "A descrição da tarefa"),
  responsibleId: optionalMember,
  departmentId: docId,
  dueDate: z.union([dateOnly("Prazo inválido."), z.literal("")]).nullish(),
  status: z.enum(TASK_STATUSES, { error: "Situação da tarefa inválida." }),
  notes: optionalText(400, "As observações da tarefa"),
};

const addTaskSchema = strict({ eventId: docId, input: strict(taskFields) });
const updateTaskSchema = strict({ eventId: docId, taskId: docId, input: strict(taskFields).partial() });

const scheduleSchema = strict({
  eventId: docId,
  input: strict({
    time: timeOnly("Informe horário e atividade."),
    title: z.string({ error: "Informe horário e atividade." }).trim().min(1, "Informe horário e atividade.").max(120, "A atividade pode ter no máximo 120 caracteres."),
    description: optionalText(300, "A descrição da atividade"),
  }),
});

const removeScheduleSchema = strict({ eventId: docId, itemId: docId });

const supplierFields = {
  name: z.string({ error: "Informe o nome e o serviço do fornecedor." }).trim().min(1, "Informe o nome e o serviço do fornecedor.").max(120, "O nome do fornecedor pode ter no máximo 120 caracteres."),
  service: z.string({ error: "Informe o nome e o serviço do fornecedor." }).trim().min(1, "Informe o nome e o serviço do fornecedor.").max(120, "O serviço pode ter no máximo 120 caracteres."),
  contact: optionalText(120, "O contato"),
  status: z.enum(SUPPLIER_STATUSES, { error: "Situação do fornecedor inválida." }),
};

const addSupplierSchema = strict({ eventId: docId, input: strict(supplierFields) });
const updateSupplierSchema = strict({ eventId: docId, supplierId: docId, input: strict(supplierFields).partial() });

/* ------------------------------- auxiliares ------------------------------ */

const CANCELLED_LOCK = "Este evento está cancelado. Volte-o para planejamento antes de alterar tarefas, programação ou fornecedores.";

function itemId(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeEvent(ev: AtleticaEvent): AtleticaEvent {
  return {
    ...ev,
    responsibleIds: ev.responsibleIds ?? [],
    schedule: ev.schedule ?? [],
    tasks: ev.tasks ?? [],
    suppliers: ev.suppliers ?? [],
    history: ev.history ?? [],
  };
}

async function loadEvent(tx: Transaction, eventId: string): Promise<{ ref: DocumentReference; event: AtleticaEvent }> {
  const ref = db.doc(`events/${eventId}`);
  const snap = requireDoc(await tx.get(ref), "Evento");
  return { ref, event: normalizeEvent(toDTO<AtleticaEvent>(snap)) };
}

function requireVisible(actor: Actor, ev: AtleticaEvent) {
  if (!canSeeEvent(actor.ctx, ev)) fail("forbidden", "Este evento não está disponível para o seu perfil.");
}

/** Mantém só os campos que valem para o escopo escolhido (como o serviço de demonstração). */
function sanitizeAudience(audience: { scope: AudienceScope; departmentId?: string | null; roleIds?: string[]; userIds?: string[] }): Audience {
  return {
    scope: audience.scope,
    departmentId: audience.scope === "department" ? audience.departmentId || undefined : undefined,
    roleIds: audience.scope === "roles" ? [...new Set(audience.roleIds ?? [])] : [],
    userIds: audience.scope === "people" ? [...new Set(audience.userIds ?? [])] : [],
  };
}

function sameAudience(a: Audience, b: Audience) {
  const norm = (x: Audience) => JSON.stringify([x.scope, x.departmentId ?? null, [...x.roleIds].sort(), [...x.userIds].sort()]);
  return norm(a) === norm(b);
}

/** Situação de cada integrante consultado (ausente = não existe). Leitura na transação. */
async function loadMemberStatus(tx: Transaction, ids: (string | undefined | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const snaps = await tx.getAll(...unique.map((id) => db.doc(`members/${id}`)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, String(s.data()!.status ?? "")]));
}

/**
 * Responsáveis precisam ser integrantes da Central. Quem é incluído agora
 * precisa estar ativo; quem já era responsável pode permanecer mesmo que a
 * conta tenha sido desativada depois (sem acesso efetivo: contas desativadas
 * não têm marcadores).
 */
function assertMembers(ids: string[], previous: string[], status: Map<string, string>, label: "responsável" | "responsável pela tarefa") {
  for (const memberId of ids) {
    const s = status.get(memberId);
    if (!s) fail("invalid", `O ${label} escolhido não é integrante da Central.`);
    if (s !== "active" && !previous.includes(memberId)) fail("invalid", `O ${label} escolhido está com a conta desativada. Escolha um integrante ativo.`);
  }
}

/** Departamento precisa existir; um departamento desativado só é aceito se já era o do registro. */
async function loadDepartment(tx: Transaction, departmentId: string) {
  return tx.get(db.doc(`departments/${departmentId}`));
}

function assertDepartment(snap: FirebaseFirestore.DocumentSnapshot, previousId?: string) {
  if (!snap.exists) fail("invalid", "O departamento escolhido não existe.");
  if (snap.data()!.active === false && snap.id !== previousId) fail("invalid", "O departamento escolhido está desativado. Escolha outro departamento.");
}

function addHistory(ev: AtleticaEvent, actor: Actor, ctx: RunContext, ...entries: [HistoryAction, string][]): HistoryEntry[] {
  return appendHistory(ev.history, ...entries.map(([action, summary]) => historyEntry(actor.uid, action, summary, ctx.now)));
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, eventId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(
    tx,
    { uid: actor.uid, name: actor.name },
    { action: `events.${action}`, module: "events", resourceType: "event", resourceId: eventId, summary, details },
    ctx.requestId,
    ctx.now,
  );
}

function requireNotCancelled(ev: AtleticaEvent) {
  if (ev.status === "cancelled") fail("conflict", CANCELLED_LOCK);
}

/** Transições permitidas e quem pode fazê-las ("edit" = canEditEvent; "close" = canCloseEvent). */
const STATUS_TRANSITIONS: Record<EventStatus, Partial<Record<EventStatus, "edit" | "close">>> = {
  planning: { confirmed: "edit", done: "close", cancelled: "close" },
  confirmed: { planning: "edit", done: "close", cancelled: "close" },
  cancelled: { planning: "edit" },
  done: { planning: "close" },
};

/** Monta a resposta: o evento completo, se o autor ainda pode vê-lo. */
async function presentEvent(eventId: string, actor: Actor | null): Promise<AtleticaEvent> {
  const snap = await db.doc(`events/${eventId}`).get();
  if (!snap.exists) fail("not_found", "Evento não encontrado.");
  const ev = normalizeEvent(toDTO<AtleticaEvent>(snap));
  if (!actor || !canSeeEvent(actor.ctx, ev)) fail("forbidden", "A operação foi concluída, mas este evento não está mais disponível para o seu perfil.");
  return ev;
}

interface EventRef {
  id: string;
}

interface TaskRef {
  id: string;
  taskId: string;
}

/* -------------------------------- ações --------------------------------- */

export const eventsActions = {
  create: mutation({
    module: "events",
    schema: createSchema,
    async run(tx, actor, input, ctx): Promise<EventRef> {
      actor = actor!;
      requirePermission(actor, "events.create", "Seu perfil não pode criar eventos.");
      // Leituras
      await requireModuleEnabled(tx, "events");
      const code = await nextCode(tx, ctx, "EVT");
      const responsibleIds = [...new Set(input.responsibleIds)];
      const [depSnap, members] = await Promise.all([loadDepartment(tx, input.departmentId), loadMemberStatus(tx, responsibleIds)]);
      // Regras
      assertDepartment(depSnap);
      assertMembers(responsibleIds, [], members, "responsável");
      // Escritas
      const ref = db.collection("events").doc();
      const ev: AtleticaEvent = {
        id: ref.id,
        code,
        name: input.name,
        description: input.description,
        objective: input.objective,
        type: input.type,
        date: input.date,
        time: input.time,
        location: input.location,
        departmentId: input.departmentId,
        responsibleIds,
        notes: input.notes || undefined,
        access: sanitizeAudience(input.access),
        status: "planning",
        budget: input.budget ?? undefined,
        schedule: [],
        tasks: [],
        suppliers: [],
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", "Evento criado", ctx.now)],
      };
      tx.create(ref, eventDoc(ev));
      indexRecord(tx, searchEntryFor.event(ev));
      audit(tx, actor, ctx, "create", ref.id, `Evento criado: ${ev.name} (${code})`, { code, departmentId: ev.departmentId, scope: ev.access.scope });
      return { id: ref.id };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),

  update: mutation({
    module: "events",
    schema: updateSchema,
    async run(tx, actor, { id: eventId, input }, ctx): Promise<EventRef> {
      actor = actor!;
      // Leituras
      await requireModuleEnabled(tx, "events");
      const { ref, event: current } = await loadEvent(tx, eventId);
      requireVisible(actor, current);
      if (!canEditEvent(actor.ctx, current)) fail("forbidden", "Seu perfil não pode editar este evento.");
      const responsibleIds = input.responsibleIds ? [...new Set(input.responsibleIds)] : current.responsibleIds;
      const depChanged = input.departmentId !== undefined && input.departmentId !== current.departmentId;
      const [depSnap, members] = await Promise.all([
        depChanged ? loadDepartment(tx, input.departmentId!) : Promise.resolve(null),
        input.responsibleIds ? loadMemberStatus(tx, responsibleIds) : Promise.resolve(new Map<string, string>()),
      ]);
      // Regras
      if (depSnap) assertDepartment(depSnap, current.departmentId);
      if (input.responsibleIds) assertMembers(responsibleIds, current.responsibleIds, members, "responsável");

      const next: AtleticaEvent = { ...current, responsibleIds };
      if (input.name !== undefined) next.name = input.name;
      if (input.description !== undefined) next.description = input.description;
      if (input.objective !== undefined) next.objective = input.objective;
      if (input.type !== undefined) next.type = input.type;
      if (input.date !== undefined) next.date = input.date;
      if (input.time !== undefined) next.time = input.time;
      if (input.location !== undefined) next.location = input.location;
      if (input.departmentId !== undefined) next.departmentId = input.departmentId;
      if ("notes" in input) next.notes = input.notes || undefined;
      if ("budget" in input) next.budget = input.budget ?? undefined;
      const accessChanged = input.access !== undefined && !sameAudience(sanitizeAudience(input.access), current.access);
      if (input.access !== undefined) next.access = sanitizeAudience(input.access);
      next.updatedAt = ctx.now;
      next.history = addHistory(
        current,
        actor,
        ctx,
        ["updated", "Dados do evento editados"],
        ...(accessChanged ? [["shared", "Visibilidade do evento alterada"] as [HistoryAction, string]] : []),
      );

      // Escritas (documento completo: campos esvaziados deixam de existir)
      tx.set(ref, eventDoc(next));
      indexRecord(tx, searchEntryFor.event(next));
      const changed = EVENT_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null));
      audit(tx, actor, ctx, "update", eventId, `Evento ${next.code} editado${changed.length ? `: ${changed.join(", ")}` : ""}`, {
        accessChanged,
        responsibles: next.responsibleIds.length,
      });

      const readers = eventReaders(next);
      const title = `${next.name} atualizado`;
      const body = `${actor.name} editou os dados do evento.`;
      const actorId = actor.uid;
      ctx.after(async () => {
        await notify({ eventKey: `event_updated__${eventId}__${ctx.requestId}`, kind: "event_updated", title, body, href: `/eventos/${eventId}`, module: "events", readers, actorId });
      });
      return { id: eventId };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),

  setStatus: mutation({
    module: "events",
    schema: statusSchema,
    async run(tx, actor, { id: eventId, status }, ctx): Promise<EventRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "events");
      const { ref, event: current } = await loadEvent(tx, eventId);
      requireVisible(actor, current);
      // Concluir/cancelar (e reabrir um evento concluído) exige criador ou events.archive.
      if (status === "done" || status === "cancelled") {
        if (!canCloseEvent(actor.ctx, current)) fail("forbidden", "Seu perfil não pode concluir ou cancelar eventos.");
      } else if (!canEditEvent(actor.ctx, current)) {
        fail("forbidden", "Seu perfil não pode alterar a situação deste evento.");
      }
      if (current.status === status) return { id: eventId };
      const needed = STATUS_TRANSITIONS[current.status][status];
      if (!needed) fail("conflict", `Não é possível mudar a situação de “${EVENT_STATUS[current.status].label}” para “${EVENT_STATUS[status].label}”.`);
      if (needed === "close" && !canCloseEvent(actor.ctx, current)) fail("forbidden", "Seu perfil não pode reabrir eventos concluídos.");

      const next: AtleticaEvent = {
        ...current,
        status,
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["status", `Situação alterada para ${EVENT_STATUS[status].label}`]),
      };
      tx.update(ref, { status, updatedAt: ctx.now, history: next.history });
      indexRecord(tx, searchEntryFor.event(next));
      audit(tx, actor, ctx, "setStatus", eventId, `Evento ${current.code}: ${EVENT_STATUS[current.status].label} → ${EVENT_STATUS[status].label}`, { from: current.status, to: status });
      return { id: eventId };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),

  duplicate: mutation({
    module: "events",
    schema: duplicateSchema,
    async run(tx, actor, input, ctx): Promise<EventRef> {
      actor = actor!;
      requirePermission(actor, "events.create", "Seu perfil não pode duplicar eventos.");
      // Leituras
      await requireModuleEnabled(tx, "events");
      const { ref: sourceRef, event: source } = await loadEvent(tx, input.id);
      requireVisible(actor, source);
      const code = await nextCode(tx, ctx, "EVT");
      const members = await loadMemberStatus(tx, [...source.responsibleIds, ...source.tasks.map((t) => t.responsibleId)]);
      const isActive = (memberId: string | undefined) => !!memberId && members.get(memberId) === "active";

      // Somente a estrutura de planejamento; responsáveis com conta desativada não são copiados.
      const responsibleIds = source.responsibleIds.filter(isActive);
      const ref = db.collection("events").doc();
      const copy: AtleticaEvent = {
        id: ref.id,
        code,
        name: input.name,
        description: source.description ?? "",
        objective: source.objective ?? "",
        type: source.type,
        date: input.date,
        time: source.time,
        location: source.location,
        departmentId: source.departmentId,
        responsibleIds: responsibleIds.length > 0 ? responsibleIds : [actor.uid],
        notes: undefined,
        access: sanitizeAudience(source.access),
        status: "planning",
        // Orçamento, lançamentos financeiros, vendas, compradores e contatos NÃO são copiados.
        budget: undefined,
        schedule: source.schedule.slice(0, MAX_SCHEDULE).map((s) => ({ id: itemId("sch"), time: s.time, title: s.title, description: s.description })),
        tasks: source.tasks.slice(0, MAX_TASKS).map(
          (t): EventTask => ({
            id: itemId("tsk"),
            title: t.title,
            description: t.description,
            responsibleId: isActive(t.responsibleId) ? t.responsibleId : undefined,
            departmentId: t.departmentId,
            status: "todo",
            createdAt: ctx.now,
            updatedAt: ctx.now,
          }),
        ),
        suppliers: source.suppliers.slice(0, MAX_SUPPLIERS).map((s): Supplier => ({ id: itemId("sup"), name: s.name, service: s.service, status: "quoted" })),
        duplicatedFromId: source.id,
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "duplicated", `Criado a partir de “${source.name}” (somente estrutura de planejamento)`, ctx.now)],
      };

      // Escritas
      tx.create(ref, eventDoc(copy));
      tx.update(sourceRef, { history: addHistory(source, actor, ctx, ["duplicated", `Estrutura copiada para “${copy.name}”`]) });
      indexRecord(tx, searchEntryFor.event(copy));
      audit(tx, actor, ctx, "duplicate", ref.id, `Evento ${code} criado a partir de ${source.code} (somente estrutura de planejamento)`, {
        code,
        sourceId: source.id,
        sourceCode: source.code,
        tasks: copy.tasks.length,
        schedule: copy.schedule.length,
        suppliers: copy.suppliers.length,
      });
      return { id: ref.id };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),

  addTask: mutation({
    module: "events",
    schema: addTaskSchema,
    async run(tx, actor, { eventId, input }, ctx): Promise<TaskRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "events");
      const { ref, event: ev } = await loadEvent(tx, eventId);
      requireVisible(actor, ev);
      if (!canEditTasks(actor.ctx, ev)) fail("forbidden", "Seu perfil não pode adicionar tarefas neste evento.");
      requireNotCancelled(ev);
      if (ev.tasks.length >= MAX_TASKS) fail("conflict", `Este evento já tem ${MAX_TASKS} tarefas, o limite por evento. Conclua ou reorganize as tarefas existentes.`);
      const responsibleId = input.responsibleId || undefined;
      const [depSnap, members] = await Promise.all([loadDepartment(tx, input.departmentId), loadMemberStatus(tx, [responsibleId])]);
      assertDepartment(depSnap);
      if (responsibleId) assertMembers([responsibleId], [], members, "responsável pela tarefa");

      const task: EventTask = {
        id: itemId("tsk"),
        title: input.title,
        description: input.description || undefined,
        responsibleId,
        departmentId: input.departmentId,
        dueDate: input.dueDate || undefined,
        status: input.status,
        notes: input.notes || undefined,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      };
      const history = addHistory(ev, actor, ctx, ["updated", `Tarefa adicionada: “${task.title}”`]);
      tx.update(ref, { tasks: [...ev.tasks, task], updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "addTask", eventId, `Tarefa adicionada ao evento ${ev.code}`, { taskId: task.id, status: task.status });
      return { id: eventId, taskId: task.id };
    },
    async present(result, actor) {
      const ev = await presentEvent(result.id, actor);
      const task = ev.tasks.find((t) => t.id === result.taskId);
      if (!task) fail("not_found", "Tarefa não encontrada. Ela pode ter sido removida.");
      return task;
    },
  }),

  updateTask: mutation({
    module: "events",
    schema: updateTaskSchema,
    async run(tx, actor, { eventId, taskId, input }, ctx): Promise<TaskRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "events");
      const { ref, event: ev } = await loadEvent(tx, eventId);
      requireVisible(actor, ev);
      const task = ev.tasks.find((t) => t.id === taskId);
      if (!task) fail("not_found", "Tarefa não encontrada. Ela pode ter sido removida ou não estar disponível para o seu perfil.");
      const full = canEditTasks(actor.ctx, ev);
      if (!full && task.responsibleId !== actor.uid) fail("forbidden", "Seu perfil não pode alterar esta tarefa.");
      requireNotCancelled(ev);

      const next: EventTask = { ...task };
      if (input.title !== undefined) next.title = input.title;
      if ("description" in input) next.description = input.description || undefined;
      if ("responsibleId" in input) next.responsibleId = input.responsibleId || undefined;
      if (input.departmentId !== undefined) next.departmentId = input.departmentId;
      if ("dueDate" in input) next.dueDate = input.dueDate || undefined;
      if (input.status !== undefined) next.status = input.status;
      if ("notes" in input) next.notes = input.notes || undefined;

      const fields = ["title", "description", "responsibleId", "departmentId", "dueDate", "status", "notes"] as const;
      const changed = fields.filter((f) => (next[f] ?? null) !== (task[f] ?? null));
      // Quem só é responsável pela tarefa altera apenas a situação e as observações dela.
      if (!full && changed.some((f) => f !== "status" && f !== "notes")) {
        fail("forbidden", "Como responsável pela tarefa, você pode alterar apenas a situação e as observações dela.");
      }
      const depChanged = changed.includes("departmentId");
      const respChanged = changed.includes("responsibleId") && !!next.responsibleId;
      const [depSnap, members] = await Promise.all([
        depChanged ? loadDepartment(tx, next.departmentId) : Promise.resolve(null),
        respChanged ? loadMemberStatus(tx, [next.responsibleId]) : Promise.resolve(new Map<string, string>()),
      ]);
      if (depSnap) assertDepartment(depSnap, task.departmentId);
      if (respChanged) assertMembers([next.responsibleId!], [], members, "responsável pela tarefa");
      if (changed.length === 0) return { id: eventId, taskId };

      next.updatedAt = ctx.now;
      const statusChanged = changed.includes("status");
      const history = addHistory(ev, actor, ctx, [
        statusChanged ? "status" : "updated",
        statusChanged ? `Tarefa “${next.title}” movida para ${TASK_STATUS[next.status].label}` : `Tarefa “${next.title}” editada`,
      ]);
      tx.update(ref, { tasks: ev.tasks.map((t) => (t.id === taskId ? next : t)), updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "updateTask", eventId, statusChanged ? `Tarefa do evento ${ev.code} movida para ${TASK_STATUS[next.status].label}` : `Tarefa do evento ${ev.code} editada`, {
        taskId,
        fields: changed.join(","),
        status: next.status,
      });
      return { id: eventId, taskId };
    },
    async present(result, actor) {
      const ev = await presentEvent(result.id, actor);
      const task = ev.tasks.find((t) => t.id === result.taskId);
      if (!task) fail("not_found", "Tarefa não encontrada. Ela pode ter sido removida.");
      return task;
    },
  }),

  addScheduleItem: mutation({
    module: "events",
    schema: scheduleSchema,
    async run(tx, actor, { eventId, input }, ctx): Promise<EventRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "events");
      const { ref, event: ev } = await loadEvent(tx, eventId);
      requireVisible(actor, ev);
      if (!canEditTasks(actor.ctx, ev)) fail("forbidden", "Seu perfil não pode alterar a programação.");
      requireNotCancelled(ev);
      if (ev.schedule.length >= MAX_SCHEDULE) fail("conflict", `A programação já tem ${MAX_SCHEDULE} itens, o limite por evento. Remova itens antes de adicionar outros.`);
      const item: ScheduleItem = { id: itemId("sch"), time: input.time, title: input.title, description: input.description || undefined };
      const schedule = [...ev.schedule, item].sort((a, b) => a.time.localeCompare(b.time));
      const history = addHistory(ev, actor, ctx, ["updated", `Programação: “${item.title}” às ${item.time}`]);
      tx.update(ref, { schedule, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "addScheduleItem", eventId, `Item adicionado à programação do evento ${ev.code}`, { itemId: item.id, time: item.time });
      return { id: eventId };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),

  removeScheduleItem: mutation({
    module: "events",
    schema: removeScheduleSchema,
    async run(tx, actor, { eventId, itemId: scheduleId }, ctx): Promise<EventRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "events");
      const { ref, event: ev } = await loadEvent(tx, eventId);
      requireVisible(actor, ev);
      if (!canEditTasks(actor.ctx, ev)) fail("forbidden", "Seu perfil não pode alterar a programação.");
      requireNotCancelled(ev);
      const item = ev.schedule.find((s) => s.id === scheduleId);
      if (!item) fail("not_found", "Item da programação não encontrado. Ele pode ter sido removido.");
      const history = addHistory(ev, actor, ctx, ["updated", `Programação: “${item.title}” removido`]);
      tx.update(ref, { schedule: ev.schedule.filter((s) => s.id !== scheduleId), updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "removeScheduleItem", eventId, `Item removido da programação do evento ${ev.code}`, { itemId: scheduleId });
      return { id: eventId };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),

  addSupplier: mutation({
    module: "events",
    schema: addSupplierSchema,
    async run(tx, actor, { eventId, input }, ctx): Promise<EventRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "events");
      const { ref, event: ev } = await loadEvent(tx, eventId);
      requireVisible(actor, ev);
      if (!canEditEvent(actor.ctx, ev)) fail("forbidden", "Seu perfil não pode cadastrar fornecedores.");
      requireNotCancelled(ev);
      if (ev.suppliers.length >= MAX_SUPPLIERS) fail("conflict", `Este evento já tem ${MAX_SUPPLIERS} fornecedores, o limite por evento.`);
      const supplier: Supplier = { id: itemId("sup"), name: input.name, service: input.service, contact: input.contact || undefined, status: input.status };
      const history = addHistory(ev, actor, ctx, ["updated", `Fornecedor adicionado: ${supplier.name}`]);
      tx.update(ref, { suppliers: [...ev.suppliers, supplier], updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "addSupplier", eventId, `Fornecedor adicionado ao evento ${ev.code}`, { supplierId: supplier.id, status: supplier.status });
      return { id: eventId };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),

  updateSupplier: mutation({
    module: "events",
    schema: updateSupplierSchema,
    async run(tx, actor, { eventId, supplierId, input }, ctx): Promise<EventRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "events");
      const { ref, event: ev } = await loadEvent(tx, eventId);
      requireVisible(actor, ev);
      if (!canEditEvent(actor.ctx, ev)) fail("forbidden", "Seu perfil não pode alterar fornecedores.");
      requireNotCancelled(ev);
      const supplier = ev.suppliers.find((s) => s.id === supplierId);
      if (!supplier) fail("not_found", "Fornecedor não encontrado. Ele pode ter sido removido.");
      const next: Supplier = { ...supplier };
      if (input.name !== undefined) next.name = input.name;
      if (input.service !== undefined) next.service = input.service;
      if ("contact" in input) next.contact = input.contact || undefined;
      if (input.status !== undefined) next.status = input.status;
      const changed = (["name", "service", "contact", "status"] as const).filter((f) => (next[f] ?? null) !== (supplier[f] ?? null));
      if (changed.length === 0) return { id: eventId };
      const history = addHistory(ev, actor, ctx, ["updated", `Fornecedor ${next.name} atualizado`]);
      tx.update(ref, { suppliers: ev.suppliers.map((s) => (s.id === supplierId ? next : s)), updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "updateSupplier", eventId, `Fornecedor do evento ${ev.code} atualizado`, { supplierId, fields: changed.join(","), status: next.status });
      return { id: eventId };
    },
    async present(result, actor) {
      return presentEvent(result.id, actor);
    },
  }),
};

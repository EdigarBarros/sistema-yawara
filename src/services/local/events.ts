import type { EventInput, EventService, TaskInput } from "../contracts";
import type { AtleticaEvent, EventTask } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import type { AccessContext } from "@/lib/permissions";
import { EVENT_STATUS, TASK_STATUS } from "@/lib/labels";
import { newId } from "@/lib/utils";
import { commit, getDB } from "./db";
import {
  accessContext,
  clone,
  findOrThrow,
  historyEntry,
  latency,
  nextCode,
  now,
  pushNotification,
  requireModuleEnabled,
  requirePermission,
  sanitizeAudience,
  ServiceError,
  validateAudience,
} from "./context";
import { canEditEvent, canEditTasks, canSeeEvent } from "@/lib/policies";

function visibleEvent(db: DemoDB, ctx: AccessContext, id: string) {
  const ev = findOrThrow(db.events, id, "Evento");
  if (!canSeeEvent(ctx, ev)) throw new ServiceError("forbidden", "Este evento não está disponível para o seu perfil.");
  return ev;
}

function validate(input: Partial<EventInput>, creating: boolean) {
  if (creating || input.name !== undefined) {
    if (!input.name || input.name.trim().length < 3) throw new ServiceError("invalid", "Informe o nome do evento (mínimo de 3 caracteres).");
  }
  if (creating && !input.date) throw new ServiceError("invalid", "Informe a data do evento.");
  if (creating && !input.time) throw new ServiceError("invalid", "Informe o horário do evento.");
  if (creating && (!input.location || !input.location.trim())) throw new ServiceError("invalid", "Informe o local do evento.");
  if (input.budget !== undefined && input.budget < 0) throw new ServiceError("invalid", "O orçamento não pode ser negativo.");
  if (input.access) validateAudience(input.access, "Visibilidade");
}

function validateTask(input: Partial<TaskInput>, creating: boolean) {
  if (creating || input.title !== undefined) {
    if (!input.title || input.title.trim().length < 3) throw new ServiceError("invalid", "Informe o nome da tarefa (mínimo de 3 caracteres).");
  }
}

export const localEvents: EventService = {
  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "events");
    const ctx = accessContext(db);
    return clone(db.events.filter((e) => canSeeEvent(ctx, e)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "events");
    return clone(visibleEvent(db, accessContext(db), id));
  },

  async create(input) {
    await latency(300, 550);
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "events.create", "Seu perfil não pode criar eventos.");
      validate(input, true);
      const at = now();
      const ev: AtleticaEvent = {
        id: newId("evt"),
        code: nextCode(db, "EVT"),
        name: input.name.trim(),
        description: input.description.trim(),
        objective: input.objective.trim(),
        type: input.type,
        date: input.date,
        time: input.time,
        location: input.location.trim(),
        departmentId: input.departmentId,
        responsibleIds: input.responsibleIds,
        notes: input.notes?.trim() || undefined,
        access: sanitizeAudience(input.access),
        status: "planning",
        budget: input.budget,
        schedule: [],
        tasks: [],
        suppliers: [],
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", "Evento criado")],
      };
      db.events.unshift(ev);
      return clone(ev);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, id);
      if (!canEditEvent(ctx, ev)) throw new ServiceError("forbidden", "Seu perfil não pode editar este evento.");
      validate(input, false);
      const accessChanged = input.access && JSON.stringify(input.access) !== JSON.stringify(ev.access);
      Object.assign(ev, input, input.access ? { access: sanitizeAudience(input.access) } : {}, { updatedAt: now() });
      ev.history.push(historyEntry(ctx.user.id, "updated", "Dados do evento editados"));
      if (accessChanged) ev.history.push(historyEntry(ctx.user.id, "shared", "Visibilidade do evento alterada"));
      pushNotification(db, {
        kind: "event_updated",
        title: `${ev.name} atualizado`,
        body: `${ctx.user.name} editou os dados do evento.`,
        href: `/eventos/${ev.id}`,
        audience: ev.access,
        actorId: ctx.user.id,
      });
      return clone(ev);
    });
  },

  async setStatus(id, status) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, id);
      if (status === "done" || status === "cancelled") {
        if (ev.createdBy !== ctx.user.id) requirePermission(ctx, "events.archive", "Seu perfil não pode concluir ou cancelar eventos.");
      } else if (!canEditEvent(ctx, ev)) {
        throw new ServiceError("forbidden", "Seu perfil não pode alterar a situação deste evento.");
      }
      if (ev.status === status) return clone(ev);
      ev.status = status;
      ev.updatedAt = now();
      ev.history.push(historyEntry(ctx.user.id, "status", `Situação alterada para ${EVENT_STATUS[status].label}`));
      return clone(ev);
    });
  },

  async duplicate(id, options) {
    await latency(300, 550);
    return commit((db) => {
      const ctx = accessContext(db);
      const source = visibleEvent(db, ctx, id);
      requirePermission(ctx, "events.create", "Seu perfil não pode duplicar eventos.");
      if (!options.name || options.name.trim().length < 3) throw new ServiceError("invalid", "Informe o nome do novo evento.");
      if (!options.date) throw new ServiceError("invalid", "Informe a data do novo evento.");
      const at = now();
      const copy: AtleticaEvent = {
        id: newId("evt"),
        code: nextCode(db, "EVT"),
        name: options.name.trim(),
        description: source.description,
        objective: source.objective,
        type: source.type,
        date: options.date,
        time: source.time,
        location: source.location,
        departmentId: source.departmentId,
        responsibleIds: [...source.responsibleIds],
        notes: undefined,
        access: clone(source.access),
        status: "planning",
        // Orçamento, lançamentos financeiros, vendas e fornecedores contratados NÃO são copiados.
        budget: undefined,
        schedule: source.schedule.map((s) => ({ ...s, id: newId("sch") })),
        tasks: source.tasks.map((t) => ({
          ...t,
          id: newId("tsk"),
          status: "todo" as const,
          dueDate: undefined,
          notes: undefined,
          createdAt: at,
          updatedAt: at,
        })),
        suppliers: source.suppliers.map((s) => ({ id: newId("sup"), name: s.name, service: s.service, status: "quoted" as const })),
        duplicatedFromId: source.id,
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "duplicated", `Criado a partir de “${source.name}” (somente estrutura de planejamento)`)],
      };
      db.events.unshift(copy);
      source.history.push(historyEntry(ctx.user.id, "duplicated", `Estrutura copiada para “${copy.name}”`));
      return clone(copy);
    });
  },

  async addTask(eventId, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, eventId);
      if (!canEditTasks(ctx, ev)) throw new ServiceError("forbidden", "Seu perfil não pode adicionar tarefas neste evento.");
      validateTask(input, true);
      const at = now();
      const task: EventTask = {
        id: newId("tsk"),
        title: input.title.trim(),
        description: input.description?.trim() || undefined,
        responsibleId: input.responsibleId || undefined,
        departmentId: input.departmentId,
        dueDate: input.dueDate || undefined,
        status: input.status,
        notes: input.notes?.trim() || undefined,
        createdAt: at,
        updatedAt: at,
      };
      ev.tasks.push(task);
      ev.updatedAt = at;
      ev.history.push(historyEntry(ctx.user.id, "updated", `Tarefa adicionada: “${task.title}”`));
      return clone(task);
    });
  },

  async updateTask(eventId, taskId, input) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, eventId);
      const task = findOrThrow(ev.tasks, taskId, "Tarefa");
      if (!canEditTasks(ctx, ev) && task.responsibleId !== ctx.user.id) {
        throw new ServiceError("forbidden", "Seu perfil não pode alterar esta tarefa.");
      }
      validateTask(input, false);
      const statusChanged = input.status && input.status !== task.status;
      Object.assign(task, input, { updatedAt: now() });
      ev.updatedAt = task.updatedAt;
      ev.history.push(
        historyEntry(
          ctx.user.id,
          statusChanged ? "status" : "updated",
          statusChanged ? `Tarefa “${task.title}” movida para ${TASK_STATUS[task.status].label}` : `Tarefa “${task.title}” editada`,
        ),
      );
      return clone(task);
    });
  },

  async addScheduleItem(eventId, input) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, eventId);
      if (!canEditTasks(ctx, ev)) throw new ServiceError("forbidden", "Seu perfil não pode alterar a programação.");
      if (!input.title?.trim() || !input.time) throw new ServiceError("invalid", "Informe horário e atividade.");
      ev.schedule.push({ ...input, title: input.title.trim(), id: newId("sch") });
      ev.schedule.sort((a, b) => a.time.localeCompare(b.time));
      ev.updatedAt = now();
      ev.history.push(historyEntry(ctx.user.id, "updated", `Programação: “${input.title.trim()}” às ${input.time}`));
      return clone(ev);
    });
  },

  async removeScheduleItem(eventId, itemId) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, eventId);
      if (!canEditTasks(ctx, ev)) throw new ServiceError("forbidden", "Seu perfil não pode alterar a programação.");
      const item = findOrThrow(ev.schedule, itemId, "Item da programação");
      ev.schedule = ev.schedule.filter((s) => s.id !== itemId);
      ev.updatedAt = now();
      ev.history.push(historyEntry(ctx.user.id, "updated", `Programação: “${item.title}” removido`));
      return clone(ev);
    });
  },

  async addSupplier(eventId, input) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, eventId);
      if (!canEditEvent(ctx, ev)) throw new ServiceError("forbidden", "Seu perfil não pode cadastrar fornecedores.");
      if (!input.name?.trim() || !input.service?.trim()) throw new ServiceError("invalid", "Informe o nome e o serviço do fornecedor.");
      ev.suppliers.push({ ...input, name: input.name.trim(), service: input.service.trim(), id: newId("sup") });
      ev.updatedAt = now();
      ev.history.push(historyEntry(ctx.user.id, "updated", `Fornecedor adicionado: ${input.name.trim()}`));
      return clone(ev);
    });
  },

  async updateSupplier(eventId, supplierId, input) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const ev = visibleEvent(db, ctx, eventId);
      if (!canEditEvent(ctx, ev)) throw new ServiceError("forbidden", "Seu perfil não pode alterar fornecedores.");
      const supplier = findOrThrow(ev.suppliers, supplierId, "Fornecedor");
      Object.assign(supplier, input);
      ev.updatedAt = now();
      ev.history.push(historyEntry(ctx.user.id, "updated", `Fornecedor ${supplier.name} atualizado`));
      return clone(ev);
    });
  },
};


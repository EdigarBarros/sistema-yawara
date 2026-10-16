/**
 * Eventos e projetos (Firebase).
 *
 * Leituras: Firestore com as regras de segurança (`events/{id}` filtrado por
 * `readers`, ou tudo para quem tem events.admin). Tarefas, programação e
 * fornecedores vêm no próprio documento do evento.
 * Escritas: função chamável `eventsApi` — o servidor confere permissões,
 * responsáveis, departamento e público, grava histórico, auditoria e índice
 * de busca, e recalcula quem pode ver o evento.
 */
import { doc, getDoc } from "firebase/firestore";
import type { AtleticaEvent, EventTask } from "@/types";
import type { EventInput, EventService, TaskInput } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { mapFirestoreError } from "./convert";
import { getVisible, listVisible } from "./queries";
import { whenAccess } from "./session";

const EVENT_KEYS = ["name", "description", "objective", "type", "date", "time", "location", "departmentId", "responsibleIds", "notes", "access", "budget"] as const;
const TASK_KEYS = ["title", "description", "responsibleId", "departmentId", "dueDate", "status", "notes"] as const;
const SCHEDULE_KEYS = ["time", "title", "description"] as const;
const SUPPLIER_KEYS = ["name", "service", "contact", "status"] as const;
const AUDIENCE_KEYS = ["scope", "departmentId", "roleIds", "userIds"] as const;

/**
 * Envia só os campos do contrato. Campo presente com `undefined` vai como
 * `null` (= limpar o campo opcional, como no modo demonstração); campo
 * ausente não é alterado.
 */
function pick(input: object, keys: readonly string[]): Record<string, unknown> {
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in source) out[key] = source[key] ?? null;
  return out;
}

function eventPayload(input: Partial<EventInput>) {
  const payload = pick(input, EVENT_KEYS);
  if (input.access) payload.access = pick(input.access, AUDIENCE_KEYS);
  return payload;
}

function normalize(ev: AtleticaEvent): AtleticaEvent {
  return {
    ...ev,
    responsibleIds: ev.responsibleIds ?? [],
    schedule: ev.schedule ?? [],
    tasks: ev.tasks ?? [],
    suppliers: ev.suppliers ?? [],
    history: ev.history ?? [],
  };
}

/** Mesmo comportamento do modo demonstração: módulo desativado não é consultado. */
async function requireModuleEnabled() {
  await whenAccess();
  let disabled = false;
  try {
    const snap = await getDoc(doc(firebase().db, "settings/system"));
    disabled = snap.exists() && (snap.data() as { modules?: Record<string, boolean> }).modules?.events === false;
  } catch (error) {
    throw mapFirestoreError(error);
  }
  if (disabled) throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
}

export const firebaseEvents: EventService = {
  async list() {
    const [, items] = await Promise.all([requireModuleEnabled(), listVisible<AtleticaEvent>("events", "events")]);
    return items.map(normalize);
  },

  async get(id) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError("not_found", "Evento não encontrado.");
    const [, ev] = await Promise.all([requireModuleEnabled(), getVisible<AtleticaEvent>(`events/${id}`, "Evento")]);
    return normalize(ev);
  },

  async create(input) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "create", eventPayload(input), rid));
  },

  async update(id, input) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "update", { id, input: eventPayload(input) }, rid));
  },

  async setStatus(id, status) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "setStatus", { id, status }, rid));
  },

  async duplicate(id, options) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "duplicate", { id, name: options.name, date: options.date }, rid));
  },

  async addTask(eventId, input: TaskInput) {
    const rid = takeRequestId();
    return callApi<EventTask>("events", "addTask", { eventId, input: pick(input, TASK_KEYS) }, rid);
  },

  async updateTask(eventId, taskId, input) {
    const rid = takeRequestId();
    return callApi<EventTask>("events", "updateTask", { eventId, taskId, input: pick(input, TASK_KEYS) }, rid);
  },

  async addScheduleItem(eventId, input) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "addScheduleItem", { eventId, input: pick(input, SCHEDULE_KEYS) }, rid));
  },

  async removeScheduleItem(eventId, itemId) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "removeScheduleItem", { eventId, itemId }, rid));
  },

  async addSupplier(eventId, input) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "addSupplier", { eventId, input: pick(input, SUPPLIER_KEYS) }, rid));
  },

  async updateSupplier(eventId, supplierId, input) {
    const rid = takeRequestId();
    return normalize(await callApi<AtleticaEvent>("events", "updateSupplier", { eventId, supplierId, input: pick(input, SUPPLIER_KEYS) }, rid));
  },
};

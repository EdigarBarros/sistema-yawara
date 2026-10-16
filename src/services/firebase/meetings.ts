/**
 * Secretaria e reuniões (Firebase).
 *
 * Leituras: Firestore com as regras de segurança (`meetings/{id}` filtrado por
 * `readers` — público, criador e participantes). Pauta, decisões,
 * encaminhamentos e convidados externos vêm no próprio documento.
 * Escritas: função chamável `meetingsApi` — o servidor confere permissões,
 * participantes, evento e documentos vinculados, o fluxo de aprovação da ata,
 * grava histórico, auditoria e índice de busca, e recalcula quem pode ver a
 * reunião.
 */
import { doc, getDoc } from "firebase/firestore";
import type { Meeting } from "@/types";
import type { MeetingInput, MeetingService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { mapFirestoreError } from "./convert";
import { getVisible, listVisible } from "./queries";
import { whenAccess } from "./session";

const MEETING_KEYS = [
  "title",
  "date",
  "startTime",
  "endTime",
  "mode",
  "location",
  "participantIds",
  "guests",
  "eventId",
  "agenda",
  "summary",
  "decisions",
  "actions",
  "documentIds",
  "access",
] as const;
const ACTION_KEYS = ["id", "description", "responsibleId", "dueDate"] as const;
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

/** Itens de lista em branco não são enviados (o servidor também os descarta). */
function cleanList(items: string[] | undefined) {
  return (items ?? []).map((i) => i.trim()).filter(Boolean);
}

function meetingPayload(input: Partial<MeetingInput>) {
  const payload = pick(input, MEETING_KEYS);
  if (input.agenda) payload.agenda = cleanList(input.agenda);
  if (input.decisions) payload.decisions = cleanList(input.decisions);
  if (input.guests) payload.guests = cleanList(input.guests);
  if (input.actions) payload.actions = input.actions.filter((a) => a.description.trim()).map((a) => pick(a, ACTION_KEYS));
  if (input.access) payload.access = pick(input.access, AUDIENCE_KEYS);
  return payload;
}

function normalize(m: Meeting): Meeting {
  return {
    ...m,
    participantIds: m.participantIds ?? [],
    guests: m.guests ?? [],
    agenda: m.agenda ?? [],
    summary: m.summary ?? "",
    decisions: m.decisions ?? [],
    actions: m.actions ?? [],
    documentIds: m.documentIds ?? [],
    history: m.history ?? [],
  };
}

/** Mesmo comportamento do modo demonstração: módulo desativado não é consultado. */
async function requireModuleEnabled() {
  await whenAccess();
  let disabled = false;
  try {
    const snap = await getDoc(doc(firebase().db, "settings/system"));
    disabled = snap.exists() && (snap.data() as { modules?: Record<string, boolean> }).modules?.meetings === false;
  } catch (error) {
    throw mapFirestoreError(error);
  }
  if (disabled) throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
}

export const firebaseMeetings: MeetingService = {
  async list() {
    const [, items] = await Promise.all([requireModuleEnabled(), listVisible<Meeting>("meetings", "meetings")]);
    return items.map(normalize);
  },

  async get(id) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError("not_found", "Reunião não encontrada.");
    const [, m] = await Promise.all([requireModuleEnabled(), getVisible<Meeting>(`meetings/${id}`, "Reunião")]);
    return normalize(m);
  },

  async create(input) {
    const rid = takeRequestId();
    return normalize(await callApi<Meeting>("meetings", "create", meetingPayload(input), rid));
  },

  async update(id, input) {
    const rid = takeRequestId();
    return normalize(await callApi<Meeting>("meetings", "update", { id, input: meetingPayload(input) }, rid));
  },

  async setStatus(id, status) {
    const rid = takeRequestId();
    return normalize(await callApi<Meeting>("meetings", "setStatus", { id, status }, rid));
  },
};

/**
 * Ensino e Extensão (Firebase).
 *
 * Leituras: Firestore com as regras de segurança.
 *  - `projects/{id}`: dados do projeto, filtrados por `readers` (ou tudo para
 *    quem tem extension.admin). Traz `attendeeCount`, mas NUNCA os nomes.
 *  - `projects/{id}/private/attendance`: lista de presença (dados pessoais).
 *    As regras só liberam a leitura para quem pode editar o projeto; para os
 *    demais perfis a leitura é recusada e o projeto vem com `attendees: []` e
 *    `attendeesRestricted: true` (nada é "mascarado" no navegador).
 *  - Na listagem a lista de presença não é lida (apenas a contagem).
 * Escritas: função chamável `extensionApi` — o servidor confere permissões,
 * responsável, evento e documento vinculados, grava histórico, auditoria e
 * índice de busca, e devolve o projeto já filtrado para quem chamou.
 */
import { doc, getDoc } from "firebase/firestore";
import type { Attendee, ExtensionProject } from "@/types";
import { projectFromDocs, type ProjectDoc } from "@/lib/firestore-model";
import type { ExtensionService, ProjectInput } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { firebaseErrorCode, mapFirestoreError } from "./convert";
import { getVisible, listVisible } from "./queries";
import { whenAccess } from "./session";

type ProjectData = Omit<ProjectDoc, "readers"> & { id: string };

const PROJECT_KEYS = ["name", "description", "objective", "activityType", "responsibleId", "date", "time", "location", "eventId", "certificateHours", "access", "report"] as const;
const AUDIENCE_KEYS = ["scope", "departmentId", "roleIds", "userIds"] as const;
const SPEAKER_KEYS = ["name", "affiliation", "topic"] as const;
const SCHEDULE_KEYS = ["time", "title", "description"] as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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

function projectPayload(input: Partial<ProjectInput> & { report?: string }) {
  const payload = pick(input, PROJECT_KEYS);
  if (input.access) payload.access = pick(input.access, AUDIENCE_KEYS);
  return payload;
}

function normalize(p: ExtensionProject): ExtensionProject {
  return {
    ...p,
    speakers: p.speakers ?? [],
    schedule: p.schedule ?? [],
    attendees: p.attendees ?? [],
    documentIds: p.documentIds ?? [],
    history: p.history ?? [],
  };
}

/** Mesmo comportamento do modo demonstração: módulo desativado não é consultado. */
async function requireModuleEnabled() {
  await whenAccess();
  let disabled = false;
  try {
    const snap = await getDoc(doc(firebase().db, "settings/system"));
    disabled = snap.exists() && (snap.data() as { modules?: Record<string, boolean> }).modules?.extension === false;
  } catch (error) {
    throw mapFirestoreError(error);
  }
  if (disabled) throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
}

/**
 * Lista de presença do projeto. `null` = o perfil não pode vê-la (as regras
 * recusaram a leitura). Outros erros (conexão, sessão) são repassados.
 */
async function readAttendance(projectId: string): Promise<{ attendees: Attendee[] } | null> {
  try {
    const snap = await getDoc(doc(firebase().db, `projects/${projectId}/private/attendance`));
    if (!snap.exists()) return { attendees: [] };
    return { attendees: ((snap.data() as { attendees?: Attendee[] }).attendees ?? []).map((a) => ({ id: a.id, name: a.name, present: !!a.present })) };
  } catch (error) {
    if (firebaseErrorCode(error) === "permission-denied") return null;
    throw mapFirestoreError(error, "Não foi possível carregar a lista de presença.");
  }
}

function project(action: string, payload: unknown, rid: string) {
  return callApi<ExtensionProject>("extension", action, payload, rid).then(normalize);
}

export const firebaseExtension: ExtensionService = {
  async list() {
    const [, items] = await Promise.all([requireModuleEnabled(), listVisible<ProjectData>("projects", "extension")]);
    // A listagem não lê as listas de presença (só a contagem gravada no projeto).
    return items.map((p) => normalize(projectFromDocs(p.id, p, null)));
  },

  async get(id) {
    if (!ID_PATTERN.test(id)) throw new ServiceError("not_found", "Projeto não encontrado.");
    const [, data, attendance] = await Promise.all([requireModuleEnabled(), getVisible<ProjectData>(`projects/${id}`, "Projeto"), readAttendance(id)]);
    return normalize(projectFromDocs(data.id, data, attendance));
  },

  async create(input) {
    const rid = takeRequestId();
    return project("create", projectPayload(input), rid);
  },

  async update(id, input) {
    const rid = takeRequestId();
    return project("update", { id, input: projectPayload(input) }, rid);
  },

  async setStatus(id, status) {
    const rid = takeRequestId();
    return project("setStatus", { id, status }, rid);
  },

  async addSpeaker(id, speaker) {
    const rid = takeRequestId();
    return project("addSpeaker", { id, speaker: pick(speaker, SPEAKER_KEYS) }, rid);
  },

  async removeSpeaker(id, speakerId) {
    const rid = takeRequestId();
    return project("removeSpeaker", { id, speakerId }, rid);
  },

  async addScheduleItem(id, item) {
    const rid = takeRequestId();
    return project("addScheduleItem", { id, item: pick(item, SCHEDULE_KEYS) }, rid);
  },

  async removeScheduleItem(id, itemId) {
    const rid = takeRequestId();
    return project("removeScheduleItem", { id, itemId }, rid);
  },

  async addAttendee(id, name) {
    const rid = takeRequestId();
    return project("addAttendee", { id, name }, rid);
  },

  async setAttendance(id, attendeeId, present) {
    const rid = takeRequestId();
    return project("setAttendance", { id, attendeeId, present }, rid);
  },

  async setCertificateStatus(id, status) {
    const rid = takeRequestId();
    return project("setCertificateStatus", { id, status }, rid);
  },

  async linkDocument(id, documentId) {
    const rid = takeRequestId();
    return project("linkDocument", { id, documentId }, rid);
  },
};

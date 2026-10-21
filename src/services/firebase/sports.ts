/**
 * Esportes (Firebase).
 *
 * Leituras: Firestore com as regras de segurança — `sportsTeams/{id}`
 * filtrado por `readers` (ou tudo para quem tem sports.admin), com treinos,
 * elenco, jogos e competições no próprio documento.
 * Escritas: função chamável `sportsApi` — o servidor confere permissões e
 * responsável, grava histórico, auditoria e índice de busca, e devolve a
 * modalidade já filtrada para quem chamou.
 */
import { doc, getDoc } from "firebase/firestore";
import type { SportTeam } from "@/types";
import type { TeamInput, SportsService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { mapFirestoreError } from "./convert";
import { getVisible, listVisible } from "./queries";
import { whenAccess } from "./session";

type TeamData = SportTeam & { readers?: string[] };

const TEAM_KEYS = ["name", "sport", "category", "description", "coach", "responsibleId", "access"] as const;
const AUDIENCE_KEYS = ["scope", "departmentId", "roleIds", "userIds"] as const;
const TRAINING_KEYS = ["id", "weekday", "start", "end", "location"] as const;
const ATHLETE_KEYS = ["id", "name", "number", "position", "captain"] as const;
const MATCH_KEYS = ["id", "date", "time", "opponent", "location", "competitionId", "scoreFor", "scoreAgainst", "status", "notes"] as const;
const COMPETITION_KEYS = ["id", "name", "startDate", "endDate", "location", "placement", "status", "notes"] as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Envia só os campos do contrato. Campo presente com `undefined` vai como
 * `null` (= limpar o campo opcional); campo ausente não é alterado.
 */
function pick(input: object, keys: readonly string[]): Record<string, unknown> {
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in source) out[key] = source[key] ?? null;
  return out;
}

function teamPayload(input: Partial<TeamInput>) {
  const payload = pick(input, TEAM_KEYS);
  if (input.access) payload.access = pick(input.access, AUDIENCE_KEYS);
  return payload;
}

function normalize(t: TeamData): SportTeam {
  const { readers: _r, ...team } = t;
  void _r;
  return { ...team, trainings: t.trainings ?? [], athletes: t.athletes ?? [], matches: t.matches ?? [], competitions: t.competitions ?? [], history: t.history ?? [] };
}

/** Mesmo comportamento do modo demonstração: módulo desativado não é consultado. */
async function requireModuleEnabled() {
  await whenAccess();
  let disabled = false;
  try {
    const snap = await getDoc(doc(firebase().db, "settings/system"));
    disabled = snap.exists() && (snap.data() as { modules?: Record<string, boolean> }).modules?.sports === false;
  } catch (error) {
    throw mapFirestoreError(error);
  }
  if (disabled) throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
}

function team(action: string, payload: unknown, rid: string) {
  return callApi<TeamData>("sports", action, payload, rid).then(normalize);
}

export const firebaseSports: SportsService = {
  async list() {
    const [, items] = await Promise.all([requireModuleEnabled(), listVisible<TeamData>("sportsTeams", "sports")]);
    return items.map(normalize);
  },

  async get(id) {
    if (!ID_PATTERN.test(id)) throw new ServiceError("not_found", "Modalidade não encontrada.");
    const [, data] = await Promise.all([requireModuleEnabled(), getVisible<TeamData>(`sportsTeams/${id}`, "Modalidade")]);
    return normalize(data);
  },

  async create(input) {
    const rid = takeRequestId();
    return team("create", teamPayload(input), rid);
  },

  async update(id, input) {
    const rid = takeRequestId();
    return team("update", { id, input: teamPayload(input) }, rid);
  },

  async setStatus(id, status) {
    const rid = takeRequestId();
    return team("setStatus", { id, status }, rid);
  },

  async saveTraining(id, item) {
    const rid = takeRequestId();
    return team("saveTraining", { id, item: pick(item, TRAINING_KEYS) }, rid);
  },

  async saveAthlete(id, item) {
    const rid = takeRequestId();
    return team("saveAthlete", { id, item: pick(item, ATHLETE_KEYS) }, rid);
  },

  async saveMatch(id, item) {
    const rid = takeRequestId();
    return team("saveMatch", { id, item: pick(item, MATCH_KEYS) }, rid);
  },

  async saveCompetition(id, item) {
    const rid = takeRequestId();
    return team("saveCompetition", { id, item: pick(item, COMPETITION_KEYS) }, rid);
  },

  async removeItem(id, list, itemId) {
    const rid = takeRequestId();
    return team("removeItem", { id, list, itemId }, rid);
  },
};

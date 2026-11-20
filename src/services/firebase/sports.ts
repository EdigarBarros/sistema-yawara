/**
 * Esportes (Firebase).
 *
 * Leituras: Firestore com as regras de segurança (`sportTeams/{id}` filtrado
 * por `readers`, ou tudo para quem tem sports.admin). Elenco, escalação,
 * treinos e jogos vêm no próprio documento do time.
 * Escritas: função `sportsApi` — o servidor confere permissões, elenco,
 * escalação e placares, grava histórico e auditoria e recalcula o público.
 */
import { doc, getDoc } from "firebase/firestore";
import type { SportTeam } from "@/types";
import type { SportsService, TeamInput } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { mapFirestoreError } from "./convert";
import { getVisible, listVisible } from "./queries";
import { whenAccess } from "./session";

const TEAM_KEYS = ["name", "modality", "category", "color", "departmentId", "coachIds", "access", "notes"] as const;
const AUDIENCE_KEYS = ["scope", "departmentId", "roleIds", "userIds"] as const;

/** Só os campos do contrato; `undefined` vai como `null` (= limpar o campo opcional). */
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

function normalize(t: SportTeam): SportTeam {
  return {
    ...t,
    coachIds: t.coachIds ?? [],
    athletes: t.athletes ?? [],
    lineup: t.lineup ?? { formation: "", slots: [] },
    sessions: t.sessions ?? [],
    history: t.history ?? [],
  };
}

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

const call = async (action: string, payload: unknown) => normalize(await callApi<SportTeam>("sports", action, payload, takeRequestId()));

export const firebaseSports: SportsService = {
  async list() {
    const [, items] = await Promise.all([requireModuleEnabled(), listVisible<SportTeam>("sportTeams", "sports")]);
    return items.map(normalize);
  },

  async get(id) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError("not_found", "Time não encontrado.");
    const [, team] = await Promise.all([requireModuleEnabled(), getVisible<SportTeam>(`sportTeams/${id}`, "Time")]);
    return normalize(team);
  },

  create: (input) => call("create", teamPayload(input)),
  update: (id, input) => call("update", { id, input: teamPayload(input) }),
  setStatus: (id, status) => call("setStatus", { id, status }),
  saveAthlete: (teamId, input, athleteId) =>
    call("saveAthlete", {
      teamId,
      athleteId: athleteId ?? null,
      input: { name: input.name, number: input.number, position: input.position, course: input.course ?? null, memberId: input.memberId ?? null, active: input.active },
    }),
  removeAthlete: (teamId, athleteId) => call("removeAthlete", { teamId, athleteId }),
  saveLineup: (teamId, lineup) => call("saveLineup", { teamId, formation: lineup.formation, slots: lineup.slots.map((s) => ({ athleteId: s.athleteId, x: s.x, z: s.z })) }),
  saveSession: (teamId, input, sessionId) =>
    call("saveSession", {
      teamId,
      sessionId: sessionId ?? null,
      input: {
        kind: input.kind,
        date: input.date,
        time: input.time,
        location: input.location,
        opponent: input.opponent ?? null,
        competition: input.competition ?? null,
        status: input.status,
        score: input.score ?? null,
        notes: input.notes ?? null,
      },
    }),
};

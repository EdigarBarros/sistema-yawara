/**
 * ESPORTES: regras puras (sem acesso a banco), usadas pelo serviço de
 * demonstração, pelo servidor (functions/src/modules/sports.ts) e pelas telas.
 * Testadas em sports.test.ts.
 *
 * Coordenadas da quadra em metros a partir do centro: x = comprimento
 * (negativo = lado do nosso gol/cesta/rede), z = largura.
 */
import type { DateOnly, LineupSlot, SessionKind, SessionStatus, SportModality, SportSession, SportTeam, TeamAthlete, TeamCategory, TeamLineup, TeamStatus } from "@/types";
import type { StatusMeta } from "./labels";

export const SPORT_LIMITS = { athletes: 40, sessions: 300, coaches: 10 } as const;

export interface PositionDef {
  key: string;
  label: string;
  short: string;
}

export interface FormationDef {
  key: string;
  label: string;
  /** Uma vaga por titular, na ordem das posições sugeridas. */
  spots: { x: number; z: number; position: string }[];
}

export interface SportRules {
  label: string;
  starters: number;
  /** Medidas oficiais aproximadas, em metros. */
  length: number;
  width: number;
  positions: PositionDef[];
  formations: FormationDef[];
}

const pos = (key: string, label: string, short: string): PositionDef => ({ key, label, short });

export const SPORT_RULES: Record<SportModality, SportRules> = {
  futsal: {
    label: "Futsal",
    starters: 5,
    length: 40,
    width: 20,
    positions: [pos("goleiro", "Goleiro(a)", "GOL"), pos("fixo", "Fixo", "FIX"), pos("ala", "Ala", "ALA"), pos("pivo", "Pivô", "PIV")],
    formations: [
      {
        key: "1-2-1",
        label: "1-2-1 (losango)",
        spots: [
          { x: -18, z: 0, position: "goleiro" },
          { x: -12, z: 0, position: "fixo" },
          { x: -7, z: -6, position: "ala" },
          { x: -7, z: 6, position: "ala" },
          { x: -2, z: 0, position: "pivo" },
        ],
      },
      {
        key: "2-2",
        label: "2-2 (quadrado)",
        spots: [
          { x: -18, z: 0, position: "goleiro" },
          { x: -12, z: -4, position: "fixo" },
          { x: -12, z: 4, position: "fixo" },
          { x: -4, z: -5, position: "ala" },
          { x: -4, z: 5, position: "pivo" },
        ],
      },
      {
        key: "3-1",
        label: "3-1",
        spots: [
          { x: -18, z: 0, position: "goleiro" },
          { x: -11, z: -6.5, position: "ala" },
          { x: -12, z: 0, position: "fixo" },
          { x: -11, z: 6.5, position: "ala" },
          { x: -3, z: 0, position: "pivo" },
        ],
      },
    ],
  },
  volei: {
    label: "Vôlei",
    starters: 6,
    length: 18,
    width: 9,
    positions: [pos("levantador", "Levantador(a)", "LEV"), pos("oposto", "Oposto(a)", "OPO"), pos("central", "Central", "CEN"), pos("ponteiro", "Ponteiro(a)", "PON"), pos("libero", "Líbero", "LIB")],
    formations: [
      {
        key: "5-1",
        label: "5-1 (rodízio 1)",
        spots: [
          { x: -7, z: 3, position: "levantador" },
          { x: -2, z: 3, position: "ponteiro" },
          { x: -2, z: 0, position: "central" },
          { x: -2, z: -3, position: "oposto" },
          { x: -7, z: -3, position: "ponteiro" },
          { x: -7, z: 0, position: "libero" },
        ],
      },
      {
        key: "4-2",
        label: "4-2",
        spots: [
          { x: -2, z: 3, position: "levantador" },
          { x: -2, z: 0, position: "central" },
          { x: -2, z: -3, position: "ponteiro" },
          { x: -7, z: -3, position: "levantador" },
          { x: -7, z: 0, position: "central" },
          { x: -7, z: 3, position: "ponteiro" },
        ],
      },
    ],
  },
  basquete: {
    label: "Basquete",
    starters: 5,
    length: 28,
    width: 15,
    positions: [pos("armador", "Armador(a)", "ARM"), pos("ala-armador", "Ala-armador(a)", "A-A"), pos("ala", "Ala", "ALA"), pos("ala-pivo", "Ala-pivô", "A-P"), pos("pivo", "Pivô", "PIV")],
    formations: [
      {
        key: "2-3",
        label: "Zona 2-3",
        spots: [
          { x: -7.5, z: -2.5, position: "armador" },
          { x: -7.5, z: 2.5, position: "ala-armador" },
          { x: -11, z: -5, position: "ala" },
          { x: -12, z: 0, position: "pivo" },
          { x: -11, z: 5, position: "ala-pivo" },
        ],
      },
      {
        key: "1-3-1",
        label: "Zona 1-3-1",
        spots: [
          { x: -5.5, z: 0, position: "armador" },
          { x: -9, z: -5, position: "ala-armador" },
          { x: -9, z: 0, position: "ala-pivo" },
          { x: -9, z: 5, position: "ala" },
          { x: -12.5, z: 0, position: "pivo" },
        ],
      },
      {
        key: "individual",
        label: "Individual (ataque aberto)",
        spots: [
          { x: 4, z: 0, position: "armador" },
          { x: 7, z: -5.5, position: "ala-armador" },
          { x: 7, z: 5.5, position: "ala" },
          { x: 11, z: -2.5, position: "ala-pivo" },
          { x: 11.5, z: 2.5, position: "pivo" },
        ],
      },
    ],
  },
  handebol: {
    label: "Handebol",
    starters: 7,
    length: 40,
    width: 20,
    positions: [
      pos("goleiro", "Goleiro(a)", "GOL"),
      pos("central", "Armador(a) central", "ARC"),
      pos("armador", "Armador(a) lateral", "ARM"),
      pos("ponta", "Ponta", "PON"),
      pos("pivo", "Pivô", "PIV"),
    ],
    formations: [
      {
        key: "6-0",
        label: "Defesa 6-0",
        spots: [
          { x: -19, z: 0, position: "goleiro" },
          { x: -13.5, z: -7.5, position: "ponta" },
          { x: -12.8, z: -4.5, position: "armador" },
          { x: -12.5, z: -1.5, position: "central" },
          { x: -12.5, z: 1.5, position: "pivo" },
          { x: -12.8, z: 4.5, position: "armador" },
          { x: -13.5, z: 7.5, position: "ponta" },
        ],
      },
      {
        key: "5-1",
        label: "Defesa 5-1",
        spots: [
          { x: -19, z: 0, position: "goleiro" },
          { x: -13.5, z: -7, position: "ponta" },
          { x: -12.8, z: -3.5, position: "armador" },
          { x: -12.5, z: 0, position: "pivo" },
          { x: -12.8, z: 3.5, position: "armador" },
          { x: -13.5, z: 7, position: "ponta" },
          { x: -9, z: 0, position: "central" },
        ],
      },
    ],
  },
};

export const MODALITIES = Object.keys(SPORT_RULES) as SportModality[];

export const CATEGORY_LABELS: Record<TeamCategory, string> = {
  masculino: "Masculino",
  feminino: "Feminino",
  misto: "Misto",
};

export const TEAM_STATUS: Record<TeamStatus, StatusMeta> = {
  active: { label: "Ativo", tone: "ok" },
  archived: { label: "Arquivado", tone: "neutral" },
};

export const SESSION_KIND_LABELS: Record<SessionKind, string> = {
  treino: "Treino",
  amistoso: "Amistoso",
  campeonato: "Campeonato",
};

export const SESSION_STATUS: Record<SessionStatus, StatusMeta> = {
  scheduled: { label: "Marcado", tone: "info" },
  done: { label: "Realizado", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

/** Cores sugeridas para o uniforme. */
export const TEAM_COLORS = ["#e1af37", "#134cb6", "#3fcf8e", "#e5484d", "#b6a9ff", "#f2a93b", "#e88ab5", "#f4f6fb"];

export function positionLabel(modality: SportModality, key: string) {
  return SPORT_RULES[modality].positions.find((p) => p.key === key)?.label ?? key;
}

export function positionShort(modality: SportModality, key: string) {
  return SPORT_RULES[modality].positions.find((p) => p.key === key)?.short ?? key.slice(0, 3).toUpperCase();
}

/* ------------------------------- validações ------------------------------ */

export interface AthleteInput {
  name: string;
  number: number;
  position: string;
  course?: string;
  memberId?: string;
  active: boolean;
}

/** Erro de regra (mensagem para a pessoa) ou `null`. */
export function athleteError(team: Pick<SportTeam, "modality" | "athletes">, input: AthleteInput, athleteId?: string): string | null {
  if (!input.name || input.name.trim().length < 2) return "Informe o nome do(a) atleta.";
  if (input.name.trim().length > 80) return "O nome pode ter no máximo 80 caracteres.";
  if (!Number.isInteger(input.number) || input.number < 0 || input.number > 99) return "O número da camisa vai de 0 a 99.";
  if (!SPORT_RULES[team.modality].positions.some((p) => p.key === input.position)) return "Escolha uma posição desta modalidade.";
  if (input.course && input.course.trim().length > 80) return "O curso pode ter no máximo 80 caracteres.";
  if (!athleteId && team.athletes.length >= SPORT_LIMITS.athletes) return `O elenco pode ter no máximo ${SPORT_LIMITS.athletes} atletas.`;
  if (athleteId && !team.athletes.some((a) => a.id === athleteId)) return "Atleta não encontrado(a) neste time.";
  const clash = team.athletes.find((a) => a.id !== athleteId && a.active && input.active && a.number === input.number);
  if (clash) return `A camisa ${input.number} já é de ${clash.name}.`;
  return null;
}

/** Aplica o cadastro/edição de atleta. Quem fica inativo sai da escalação. */
export function withAthlete(team: SportTeam, input: AthleteInput, athleteId: string): SportTeam {
  const athlete: TeamAthlete = {
    id: athleteId,
    name: input.name.trim(),
    number: input.number,
    position: input.position,
    course: input.course?.trim() || undefined,
    memberId: input.memberId || undefined,
    active: input.active,
  };
  const exists = team.athletes.some((a) => a.id === athleteId);
  const athletes = exists ? team.athletes.map((a) => (a.id === athleteId ? athlete : a)) : [...team.athletes, athlete];
  const lineup = input.active ? team.lineup : { ...team.lineup, slots: team.lineup.slots.filter((s) => s.athleteId !== athleteId) };
  return { ...team, athletes, lineup };
}

/** Remove o(a) atleta do elenco e da escalação. */
export function withoutAthlete(team: SportTeam, athleteId: string): SportTeam {
  return {
    ...team,
    athletes: team.athletes.filter((a) => a.id !== athleteId),
    lineup: { ...team.lineup, slots: team.lineup.slots.filter((s) => s.athleteId !== athleteId) },
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Confere e ajusta a escalação: só atletas ativos do elenco, sem repetir,
 * no máximo o número de titulares da modalidade e dentro da quadra.
 */
export function cleanLineup(team: Pick<SportTeam, "modality" | "athletes">, lineup: Pick<TeamLineup, "formation" | "slots">): { lineup: Pick<TeamLineup, "formation" | "slots"> } | { error: string } {
  const rules = SPORT_RULES[team.modality];
  if (lineup.slots.length > rules.starters) return { error: `No ${rules.label.toLowerCase()} entram no máximo ${rules.starters} titulares.` };
  const seen = new Set<string>();
  const halfL = rules.length / 2;
  const halfW = rules.width / 2;
  const slots: LineupSlot[] = [];
  for (const slot of lineup.slots) {
    const athlete = team.athletes.find((a) => a.id === slot.athleteId);
    if (!athlete) return { error: "A escalação tem um(a) atleta que não está no elenco." };
    if (!athlete.active) return { error: `${athlete.name} está inativo(a) e não pode ser escalado(a).` };
    if (seen.has(slot.athleteId)) return { error: `${athlete.name} aparece duas vezes na escalação.` };
    if (!Number.isFinite(slot.x) || !Number.isFinite(slot.z)) return { error: "Posição inválida na quadra." };
    seen.add(slot.athleteId);
    slots.push({ athleteId: slot.athleteId, x: round(Math.max(-halfL, Math.min(halfL, slot.x))), z: round(Math.max(-halfW, Math.min(halfW, slot.z))) });
  }
  const formation = (lineup.formation ?? "").trim().slice(0, 40) || "livre";
  return { lineup: { formation, slots } };
}

export interface SessionInput {
  kind: SessionKind;
  date: DateOnly;
  time: string;
  location: string;
  opponent?: string;
  competition?: string;
  status: SessionStatus;
  score?: { us: number; them: number } | null;
  notes?: string;
}

export function sessionError(input: SessionInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return "Informe a data.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time ?? "")) return "Informe o horário.";
  if (!input.location || !input.location.trim()) return "Informe o local.";
  if (input.location.trim().length > 120) return "O local pode ter no máximo 120 caracteres.";
  if (input.kind !== "treino" && (!input.opponent || !input.opponent.trim())) return "Informe o adversário.";
  if ((input.opponent ?? "").length > 80 || (input.competition ?? "").length > 80) return "Adversário e competição podem ter no máximo 80 caracteres.";
  if ((input.notes ?? "").length > 500) return "As observações podem ter no máximo 500 caracteres.";
  if (input.score) {
    if (input.kind === "treino") return "Treinos não têm placar.";
    if (input.status !== "done") return "O placar só pode ser registrado em jogos realizados.";
    const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= 999;
    if (!ok(input.score.us) || !ok(input.score.them)) return "Placar inválido.";
  }
  return null;
}

/** Mantém só os campos que valem para o tipo de sessão. */
export function cleanSession(input: SessionInput): Omit<SportSession, "id" | "createdBy" | "createdAt" | "updatedAt"> {
  const game = input.kind !== "treino";
  return {
    kind: input.kind,
    date: input.date,
    time: input.time,
    location: input.location.trim(),
    opponent: game ? input.opponent?.trim() || undefined : undefined,
    competition: input.kind === "campeonato" ? input.competition?.trim() || undefined : undefined,
    score: game && input.status === "done" && input.score ? { us: input.score.us, them: input.score.them } : undefined,
    status: input.status,
    notes: input.notes?.trim() || undefined,
  };
}

/* ------------------------------- consultas ------------------------------- */

export type SessionWithTeam = SportSession & { team: SportTeam };

export function allSessions(teams: SportTeam[]): SessionWithTeam[] {
  return teams.flatMap((team) => team.sessions.map((s) => ({ ...s, team })));
}

const when = (s: Pick<SportSession, "date" | "time">) => `${s.date}T${s.time}`;

export function upcomingSessions(teams: SportTeam[], today: DateOnly) {
  return allSessions(teams)
    .filter((s) => s.status === "scheduled" && s.date >= today)
    .sort((a, b) => when(a).localeCompare(when(b)));
}

export function recentResults(teams: SportTeam[]) {
  return allSessions(teams)
    .filter((s) => s.status === "done" && s.kind !== "treino" && s.score)
    .sort((a, b) => when(b).localeCompare(when(a)));
}

export type Outcome = "win" | "draw" | "loss";

export function outcome(score: { us: number; them: number }): Outcome {
  return score.us > score.them ? "win" : score.us < score.them ? "loss" : "draw";
}

/** Vitórias, empates e derrotas do time em jogos realizados com placar. */
export function teamRecord(team: Pick<SportTeam, "sessions">) {
  const r = { win: 0, draw: 0, loss: 0 };
  for (const s of team.sessions) if (s.status === "done" && s.score && s.kind !== "treino") r[outcome(s.score)]++;
  return r;
}

export function nextSession(team: Pick<SportTeam, "sessions">, today: DateOnly) {
  return [...team.sessions].filter((s) => s.status === "scheduled" && s.date >= today).sort((a, b) => when(a).localeCompare(when(b)))[0];
}

/** Cor do texto sobre a cor do uniforme: escuro em cores claras, branco em cores escuras. */
export function inkOn(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? "#06102e" : "#ffffff";
}

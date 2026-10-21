import type { DateOnly, Match, SportTeam, TrainingSlot } from "@/types";
import { SPORT_CATEGORY_LABELS, WEEKDAY_LABELS } from "@/lib/labels";

/** Cor da área de Esportes (a mesma do menu e dos cartões da Diretoria). */
export const SPORTS_COLOR = "#f07a5a";

export function teamSubtitle(t: Pick<SportTeam, "sport" | "category">) {
  return `${t.sport} · ${SPORT_CATEGORY_LABELS[t.category]}`;
}

export interface TeamRecord {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scored: number;
  conceded: number;
}

/** Campanha da modalidade: jogos realizados com placar informado. */
export function teamRecord(matches: Match[]): TeamRecord {
  const r: TeamRecord = { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0 };
  for (const m of matches) {
    if (m.status !== "played" || m.scoreFor == null || m.scoreAgainst == null) continue;
    r.played += 1;
    r.scored += m.scoreFor;
    r.conceded += m.scoreAgainst;
    if (m.scoreFor > m.scoreAgainst) r.wins += 1;
    else if (m.scoreFor < m.scoreAgainst) r.losses += 1;
    else r.draws += 1;
  }
  return r;
}

export type MatchOutcome = "win" | "draw" | "loss" | null;

export function matchOutcome(m: Match): MatchOutcome {
  if (m.status !== "played" || m.scoreFor == null || m.scoreAgainst == null) return null;
  return m.scoreFor > m.scoreAgainst ? "win" : m.scoreFor < m.scoreAgainst ? "loss" : "draw";
}

export const OUTCOME_META: Record<Exclude<MatchOutcome, null>, { label: string; short: string; tone: "ok" | "warn" | "danger" }> = {
  win: { label: "Vitória", short: "V", tone: "ok" },
  draw: { label: "Empate", short: "E", tone: "warn" },
  loss: { label: "Derrota", short: "D", tone: "danger" },
};

/** Próximos jogos agendados (a partir de hoje), em ordem. */
export function upcomingMatches(team: SportTeam, today: DateOnly) {
  return team.matches.filter((m) => m.status === "scheduled" && m.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

function weekdayOf(date: DateOnly) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** Próximo treino a partir de hoje (inclusive): o horário e em quantos dias. */
export function nextTraining(trainings: TrainingSlot[], today: DateOnly): { slot: TrainingSlot; inDays: number } | null {
  if (trainings.length === 0) return null;
  const todayDow = weekdayOf(today);
  let best: { slot: TrainingSlot; inDays: number } | null = null;
  for (const slot of trainings) {
    const inDays = (slot.weekday - todayDow + 7) % 7;
    if (!best || inDays < best.inDays || (inDays === best.inDays && slot.start < best.slot.start)) best = { slot, inDays };
  }
  return best;
}

/** "Hoje", "Amanhã" ou o dia da semana do próximo treino. */
export function whenLabel(next: { slot: TrainingSlot; inDays: number }) {
  return next.inDays === 0 ? "Hoje" : next.inDays === 1 ? "Amanhã" : WEEKDAY_LABELS[next.slot.weekday];
}

export function trainingLabel(slot: TrainingSlot) {
  return `${WEEKDAY_LABELS[slot.weekday]}, ${slot.start}${slot.end ? `–${slot.end}` : ""}`;
}

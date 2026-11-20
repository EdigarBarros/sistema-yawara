/**
 * Tela do(a) Diretor(a) de Esportes: próximo jogo, semana e números da
 * temporada. Funções puras (testadas em home-rules.test.ts).
 */
import type { DateOnly, Match, SportTeam, TrainingSlot } from "@/types";
import { daysBetween } from "@/lib/format";
import { teamRecord } from "./utils";

function addDays(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10) as DateOnly;
}

function weekdayOf(date: DateOnly) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

const active = (teams: SportTeam[]) => teams.filter((t) => t.status === "active");

export interface NextGame {
  team: SportTeam;
  match: Match;
  inDays: number;
}

/** Próximo jogo marcado (de hoje em diante) entre as modalidades em atividade. */
export function nextGame(teams: SportTeam[], today: DateOnly): NextGame | null {
  let best: NextGame | null = null;
  for (const team of active(teams))
    for (const match of team.matches) {
      if (match.status !== "scheduled" || match.date < today) continue;
      const key = `${match.date}${match.time ?? ""}`;
      if (!best || key < `${best.match.date}${best.match.time ?? ""}`) best = { team, match, inDays: daysBetween(today, match.date) };
    }
  return best;
}

export type WeekItem =
  | { kind: "training"; date: DateOnly; time: string; team: SportTeam; slot: TrainingSlot }
  | { kind: "match"; date: DateOnly; time: string; team: SportTeam; match: Match };

/** Treinos (pelos horários fixos) e jogos dos próximos 7 dias, em ordem. */
export function weekAgenda(teams: SportTeam[], today: DateOnly, days = 7): WeekItem[] {
  const items: WeekItem[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const dow = weekdayOf(date);
    for (const team of active(teams)) {
      for (const slot of team.trainings) if (slot.weekday === dow) items.push({ kind: "training", date, time: slot.start, team, slot });
      for (const match of team.matches) if (match.status === "scheduled" && match.date === date) items.push({ kind: "match", date, time: match.time ?? "", team, match });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export interface SeasonNumbers {
  /** Jogos do mês atual (realizados + marcados). */
  monthGames: number;
  monthPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  /** Aproveitamento: pontos ganhos / pontos possíveis (vitória 3, empate 1). `null` sem jogos com placar. */
  efficiency: number | null;
  scored: number;
  conceded: number;
  athletes: number;
  trainingsThisWeek: number;
}

export function seasonNumbers(teams: SportTeam[], today: DateOnly): SeasonNumbers {
  const list = active(teams);
  const month = today.slice(0, 7);
  const matches = list.flatMap((t) => t.matches).filter((m) => m.status !== "cancelled");
  const monthMatches = matches.filter((m) => m.date.startsWith(month));
  const r = teamRecord(list.flatMap((t) => t.matches));
  return {
    monthGames: monthMatches.length,
    monthPlayed: monthMatches.filter((m) => m.status === "played").length,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    efficiency: r.played ? (r.wins * 3 + r.draws) / (r.played * 3) : null,
    scored: r.scored,
    conceded: r.conceded,
    athletes: list.reduce((n, t) => n + t.athletes.length, 0),
    trainingsThisWeek: weekAgenda(teams, today).filter((i) => i.kind === "training").length,
  };
}

/** "É hoje!", "Amanhã", "Em 5 dias". */
export function countdown(inDays: number) {
  return inDays <= 0 ? "É hoje!" : inDays === 1 ? "Amanhã" : `Em ${inDays} dias`;
}

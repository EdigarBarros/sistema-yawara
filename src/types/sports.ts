import type { Audience, DateOnly, HistoryEntry, ID, ISODateTime, TimeOnly } from "./common";

/** Naipe da modalidade. */
export type SportCategory = "feminino" | "masculino" | "misto";

export type TeamStatus = "active" | "paused" | "archived";

/** Horário fixo de treino na semana (0 = domingo … 6 = sábado). */
export interface TrainingSlot {
  id: ID;
  weekday: number;
  start: TimeOnly;
  end?: TimeOnly;
  location: string;
}

/** Integrante do elenco. Só nome e dados de jogo: nada de contato ou documento. */
export interface Athlete {
  id: ID;
  name: string;
  /** Número da camisa. */
  number?: string;
  position?: string;
  captain?: boolean;
}

export type MatchStatus = "scheduled" | "played" | "cancelled";

export interface Match {
  id: ID;
  date: DateOnly;
  time?: TimeOnly;
  opponent: string;
  location: string;
  /** Competição da modalidade em que o jogo acontece (opcional). */
  competitionId?: ID;
  scoreFor?: number;
  scoreAgainst?: number;
  status: MatchStatus;
  notes?: string;
}

export type CompetitionStatus = "upcoming" | "ongoing" | "finished";

export interface Competition {
  id: ID;
  name: string;
  startDate: DateOnly;
  endDate?: DateOnly;
  location: string;
  /** Resultado final (ex.: "Campeã", "3º lugar"). */
  placement?: string;
  status: CompetitionStatus;
  notes?: string;
}

/** Modalidade esportiva da Atlética (ex.: Futsal Feminino). */
export interface SportTeam {
  id: ID;
  code: string;
  name: string;
  /** Esporte (ex.: Futsal, Vôlei, Handebol). */
  sport: string;
  category: SportCategory;
  description: string;
  /** Técnico(a) ou treinador(a); pode ser alguém de fora da Central. */
  coach?: string;
  /** Integrante da Central que coordena a modalidade. */
  responsibleId: ID;
  status: TeamStatus;
  trainings: TrainingSlot[];
  athletes: Athlete[];
  matches: Match[];
  competitions: Competition[];
  access: Audience;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}

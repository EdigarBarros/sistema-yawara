import type { Audience, DateOnly, HistoryEntry, ID, ISODateTime, TimeOnly } from "./common";

/** Modalidades com quadra desenhada (a quadra 3D sabe montar cada uma). */
export type SportModality = "futsal" | "volei" | "basquete" | "handebol";

export type TeamCategory = "masculino" | "feminino" | "misto";

export type TeamStatus = "active" | "archived";

export interface TeamAthlete {
  id: ID;
  name: string;
  /** Integrante da Central (opcional: a maioria dos atletas não faz parte da diretoria). */
  memberId?: ID;
  number: number;
  /** Chave da posição em SPORT_RULES[modalidade].positions. */
  position: string;
  course?: string;
  active: boolean;
}

/**
 * Posição de um titular na quadra, em metros, a partir do centro.
 * x = comprimento (negativo = nossa defesa), z = largura.
 */
export interface LineupSlot {
  athleteId: ID;
  x: number;
  z: number;
}

export interface TeamLineup {
  formation: string;
  slots: LineupSlot[];
  updatedAt?: ISODateTime;
  updatedBy?: ID;
}

export type SessionKind = "treino" | "amistoso" | "campeonato";

export type SessionStatus = "scheduled" | "done" | "cancelled";

export interface SportSession {
  id: ID;
  kind: SessionKind;
  date: DateOnly;
  time: TimeOnly;
  location: string;
  /** Adversário (amistoso e campeonato). */
  opponent?: string;
  /** Nome da competição (campeonato). */
  competition?: string;
  /** Placar final (só jogos realizados). */
  score?: { us: number; them: number };
  status: SessionStatus;
  notes?: string;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SportTeam {
  id: ID;
  code: string;
  name: string;
  modality: SportModality;
  category: TeamCategory;
  /** Cor do uniforme (hex). */
  color: string;
  departmentId: ID;
  /** Técnicos e responsáveis (integrantes): veem e editam o time. */
  coachIds: ID[];
  access: Audience;
  status: TeamStatus;
  athletes: TeamAthlete[];
  lineup: TeamLineup;
  /** Treinos e jogos ficam no próprio time (limite em SPORT_LIMITS). */
  sessions: SportSession[];
  notes?: string;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  history: HistoryEntry[];
}

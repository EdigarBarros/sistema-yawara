import type { SessionKind, SessionStatus, SportModality, SportSession, SportTeam, TeamAthlete } from "@/types";
import { SPORT_RULES } from "@/lib/sports";
import { audience, h, type Clock } from "./helpers";
import { DEP, USR } from "./organization";

export const TEAM = {
  futsal: "tim-futsal-masc",
  volei: "tim-volei-fem",
  basquete: "tim-basquete-misto",
} as const;

/** Atletas fictícios: [nome, número, posição]. */
type Row = [string, number, string];

function athletes(prefix: string, rows: Row[], course = "Psicologia"): TeamAthlete[] {
  return rows.map(([name, number, position], i) => ({ id: `${prefix}-a${i + 1}`, name, number, position, course, active: true }));
}

/** Escala os primeiros atletas na formação indicada. */
function lineupFor(modality: SportModality, formation: string, roster: TeamAthlete[], clock: Clock) {
  const f = SPORT_RULES[modality].formations.find((x) => x.key === formation)!;
  return {
    formation,
    slots: f.spots.map((spot, i) => ({ athleteId: roster[i].id, x: spot.x, z: spot.z })),
    updatedAt: clock.at(-2, 21, 10),
    updatedBy: USR.gabriel,
  };
}

let seq = 0;
function session(
  clock: Clock,
  kind: SessionKind,
  days: number,
  time: string,
  location: string,
  status: SessionStatus,
  extra: Partial<SportSession> = {},
): SportSession {
  const at = clock.at(Math.min(days, 0) - 3, 18, 0);
  return { id: `ses-seed-${++seq}`, kind, date: clock.date(days), time, location, status, createdBy: USR.gabriel, createdAt: at, updatedAt: at, ...extra };
}

export function buildTeams(clock: Clock): SportTeam[] {
  const futsal = athletes(TEAM.futsal, [
    ["Rafael Nunes", 1, "goleiro"],
    ["Diego Amaral", 4, "fixo"],
    ["Matheus Lira", 7, "ala"],
    ["Vitor Campos", 11, "ala"],
    ["Igor Batista", 9, "pivo"],
    ["Caíque Dantas", 12, "goleiro"],
    ["André Fontes", 5, "fixo"],
    ["Breno Sales", 8, "ala"],
    ["Henrique Paiva", 10, "pivo"],
    ["Samuel Rocha", 14, "ala"],
  ]);
  const volei = athletes(TEAM.volei, [
    ["Larissa Menezes", 2, "levantador"],
    ["Bianca Torres", 9, "ponteiro"],
    ["Camila Freitas", 6, "central"],
    ["Natália Rios", 11, "oposto"],
    ["Jéssica Prado", 7, "ponteiro"],
    ["Paula Antunes", 5, "libero"],
    ["Amanda Lopes", 3, "central"],
    ["Fernanda Reis", 10, "levantador"],
    ["Yasmin Duarte", 12, "ponteiro"],
  ]);
  const basquete = athletes(TEAM.basquete, [
    ["Thiago Moura", 4, "armador"],
    ["Beatriz Lemos", 7, "ala-armador"],
    ["Rodrigo Vale", 10, "ala"],
    ["Clara Bastos", 13, "ala-pivo"],
    ["Eduardo Sena", 15, "pivo"],
    ["Mariana Castro", 8, "ala"],
    ["Felipe Moraes", 21, "armador"],
  ]);

  const base = (id: string, code: string, created: number) => ({
    id,
    code,
    departmentId: DEP.esportes,
    coachIds: [USR.gabriel],
    access: audience.all(),
    status: "active" as const,
    createdBy: USR.gabriel,
    createdAt: clock.at(created, 19, 0),
    updatedAt: clock.at(-2, 21, 10),
    history: [h(clock.at(created, 19, 0), USR.gabriel, "created", "Time criado"), h(clock.at(-2, 21, 10), USR.gabriel, "updated", "Escalação salva")],
  });

  return [
    {
      ...base(TEAM.futsal, "TIM-2026-001", -120),
      name: "Futsal Masculino",
      modality: "futsal",
      category: "masculino",
      color: "#e1af37",
      athletes: futsal,
      lineup: lineupFor("futsal", "1-2-1", futsal, clock),
      notes: "Treinos às terças e quintas. Prioridade: Jogos Interatléticas.",
      sessions: [
        session(clock, "treino", -12, "19:00", "Quadra do campus", "done"),
        session(clock, "amistoso", -9, "15:00", "Quadra do campus", "done", { opponent: "Atlética de Direito", score: { us: 4, them: 2 } }),
        session(clock, "treino", -5, "19:00", "Quadra do campus", "done"),
        session(clock, "amistoso", -2, "16:00", "Ginásio municipal", "done", { opponent: "Atlética de Medicina", score: { us: 3, them: 3 } }),
        session(clock, "treino", 2, "19:00", "Quadra do campus", "scheduled"),
        session(clock, "treino", 4, "19:00", "Quadra do campus", "scheduled"),
        session(clock, "campeonato", 30, "10:00", "Ginásio (local de demonstração)", "scheduled", { opponent: "Atlética de Engenharia", competition: "Jogos Interatléticas" }),
      ],
    },
    {
      ...base(TEAM.volei, "TIM-2026-002", -100),
      name: "Vôlei Feminino",
      modality: "volei",
      category: "feminino",
      color: "#134cb6",
      athletes: volei,
      lineup: lineupFor("volei", "5-1", volei, clock),
      sessions: [
        session(clock, "treino", -6, "18:30", "Ginásio poliesportivo", "done"),
        session(clock, "campeonato", -3, "14:00", "Ginásio poliesportivo", "done", { opponent: "Atlética de Enfermagem", competition: "Copa Universitária", score: { us: 2, them: 1 } }),
        session(clock, "treino", 1, "18:30", "Ginásio poliesportivo", "scheduled"),
        session(clock, "amistoso", 6, "15:30", "Ginásio poliesportivo", "scheduled", { opponent: "Atlética de Nutrição" }),
      ],
    },
    {
      ...base(TEAM.basquete, "TIM-2026-003", -40),
      name: "Basquete Misto",
      modality: "basquete",
      category: "misto",
      color: "#3fcf8e",
      athletes: basquete,
      lineup: { formation: "", slots: [] },
      sessions: [session(clock, "treino", 3, "20:00", "Quadra externa", "scheduled"), session(clock, "treino", -4, "20:00", "Quadra externa", "cancelled", { notes: "Chuva forte." })],
    },
  ];
}

import type { Athlete, SportTeam } from "@/types";
import { audience, h, type Clock } from "./helpers";
import { USR } from "./organization";

/** Elenco fictício: "Atleta Demo 01"… (nenhum nome real). */
function roster(prefix: string, positions: string[], captainIndex = 0): Athlete[] {
  return positions.map((position, i) => ({
    id: `${prefix}-ath-${i + 1}`,
    name: `Atleta Demo ${String(i + 1).padStart(2, "0")}`,
    number: String(i + 1 === 1 ? 1 : i * 2 + 3),
    position,
    captain: i === captainIndex || undefined,
  }));
}

export function buildSportsTeams(clock: Clock): SportTeam[] {
  return [
    {
      id: "esp-futsal-fem",
      code: "ESP-2026-001",
      name: "Futsal Feminino",
      sport: "Futsal",
      category: "feminino",
      description: "Time de futsal feminino da Yawara. Treinos abertos a todas as estudantes de Psicologia.",
      coach: "Técnica convidada (exemplo)",
      responsibleId: USR.gabriel,
      status: "active",
      trainings: [
        { id: "trn-ff-1", weekday: 2, start: "19:00", end: "20:30", location: "Quadra do campus (local de demonstração)" },
        { id: "trn-ff-2", weekday: 4, start: "19:00", end: "20:30", location: "Quadra do campus (local de demonstração)" },
      ],
      athletes: roster("ff", ["Goleira", "Fixo", "Ala", "Ala", "Pivô", "Ala", "Fixo", "Goleira"], 2),
      competitions: [
        { id: "cmp-ff-1", name: "Jogos Universitários da Saúde (exemplo)", startDate: clock.date(-60), endDate: clock.date(-57), location: "Ginásio municipal (exemplo)", placement: "3º lugar", status: "finished" },
        { id: "cmp-ff-2", name: "Copa Intercursos 2026.2 (exemplo)", startDate: clock.date(9), endDate: clock.date(30), location: "Ginásio do campus (exemplo)", status: "upcoming" },
      ],
      matches: [
        { id: "mch-ff-1", date: clock.date(-59), time: "15:00", opponent: "Atlética de Medicina (exemplo)", location: "Ginásio municipal (exemplo)", competitionId: "cmp-ff-1", scoreFor: 3, scoreAgainst: 1, status: "played" },
        { id: "mch-ff-2", date: clock.date(-58), time: "10:00", opponent: "Atlética de Enfermagem (exemplo)", location: "Ginásio municipal (exemplo)", competitionId: "cmp-ff-1", scoreFor: 2, scoreAgainst: 2, status: "played" },
        { id: "mch-ff-3", date: clock.date(-57), time: "16:00", opponent: "Atlética de Odontologia (exemplo)", location: "Ginásio municipal (exemplo)", competitionId: "cmp-ff-1", scoreFor: 1, scoreAgainst: 2, status: "played", notes: "Disputa de 3º lugar vencida no dia seguinte." },
        { id: "mch-ff-4", date: clock.date(4), time: "20:00", opponent: "Atlética de Direito (exemplo)", location: "Quadra do campus (exemplo)", status: "scheduled", notes: "Amistoso de preparação." },
        { id: "mch-ff-5", date: clock.date(10), time: "18:30", opponent: "Atlética de Fisioterapia (exemplo)", location: "Ginásio do campus (exemplo)", competitionId: "cmp-ff-2", status: "scheduled" },
      ],
      access: audience.all(),
      createdBy: USR.gabriel,
      createdAt: clock.at(-120, 10, 0),
      updatedAt: clock.at(-2, 18, 0),
      history: [
        h(clock.at(-120, 10, 0), USR.gabriel, "created", "Modalidade criada"),
        h(clock.at(-56, 9, 0), USR.gabriel, "updated", "Competição atualizado(a)"),
        h(clock.at(-2, 18, 0), USR.gabriel, "updated", "Jogo adicionado(a)"),
      ],
    },
    {
      id: "esp-volei-misto",
      code: "ESP-2026-002",
      name: "Vôlei Misto",
      sport: "Vôlei",
      category: "misto",
      description: "Equipe mista de vôlei de quadra.",
      coach: "Treinador voluntário (exemplo)",
      responsibleId: USR.gabriel,
      status: "active",
      trainings: [{ id: "trn-vm-1", weekday: 6, start: "09:00", end: "11:00", location: "Ginásio do campus (local de demonstração)" }],
      athletes: roster("vm", ["Levantador(a)", "Oposto(a)", "Ponteiro(a)", "Ponteiro(a)", "Central", "Central", "Líbero"], 0),
      competitions: [{ id: "cmp-vm-1", name: "Copa Intercursos 2026.2 (exemplo)", startDate: clock.date(9), endDate: clock.date(30), location: "Ginásio do campus (exemplo)", status: "upcoming" }],
      matches: [
        { id: "mch-vm-1", date: clock.date(-12), time: "10:00", opponent: "Atlética de Engenharia (exemplo)", location: "Ginásio do campus (exemplo)", scoreFor: 3, scoreAgainst: 1, status: "played", notes: "Placar em sets." },
        { id: "mch-vm-2", date: clock.date(12), time: "10:00", opponent: "Atlética de Arquitetura (exemplo)", location: "Ginásio do campus (exemplo)", competitionId: "cmp-vm-1", status: "scheduled" },
      ],
      access: audience.all(),
      createdBy: USR.gabriel,
      createdAt: clock.at(-90, 10, 0),
      updatedAt: clock.at(-12, 12, 0),
      history: [h(clock.at(-90, 10, 0), USR.gabriel, "created", "Modalidade criada")],
    },
    {
      id: "esp-handebol-masc",
      code: "ESP-2026-003",
      name: "Handebol Masculino",
      sport: "Handebol",
      category: "masculino",
      description: "Equipe em formação; treinos suspensos até fechar o elenco mínimo.",
      responsibleId: USR.gabriel,
      status: "paused",
      trainings: [],
      athletes: roster("hm", ["Goleiro", "Armador", "Ponta"], 1),
      competitions: [],
      matches: [],
      access: audience.board(),
      createdBy: USR.gabriel,
      createdAt: clock.at(-40, 10, 0),
      updatedAt: clock.at(-20, 10, 0),
      history: [h(clock.at(-40, 10, 0), USR.gabriel, "created", "Modalidade criada"), h(clock.at(-20, 10, 0), USR.gabriel, "status", "Situação alterada para Pausada")],
    },
  ];
}

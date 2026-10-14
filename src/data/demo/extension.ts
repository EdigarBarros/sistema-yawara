import type { Attendee, ExtensionProject } from "@/types";
import { audience, h, type Clock } from "./helpers";
import { USR } from "./organization";
import { EVT } from "./events";
import { DOC } from "./documents";

const ATTENDEE_NAMES = [
  "Participante Demo 01", "Participante Demo 02", "Participante Demo 03", "Participante Demo 04",
  "Participante Demo 05", "Participante Demo 06", "Participante Demo 07", "Participante Demo 08",
  "Participante Demo 09", "Participante Demo 10", "Participante Demo 11", "Participante Demo 12",
];

function attendees(prefix: string, count: number, presentEvery = 1): Attendee[] {
  return ATTENDEE_NAMES.slice(0, count).map((name, i) => ({ id: `${prefix}-att-${i + 1}`, name, present: presentEvery > 0 && i % presentEvery !== presentEvery - 1 }));
}

export function buildProjects(clock: Clock): ExtensionProject[] {
  return [
    {
      id: "prj-semana-psicologo",
      code: "ENS-2026-005",
      name: "Semana do Psicólogo 2026",
      description: "Ciclo de palestras e rodas de conversa sobre os campos de atuação da Psicologia.",
      objective: "Aproximar os estudantes de profissionais de diferentes áreas.",
      activityType: "palestra",
      responsibleId: USR.marina,
      date: clock.date(5),
      time: "19:00",
      location: "Auditório (local de demonstração)",
      speakers: [
        { id: "spk-1", name: "Palestrante Convidada A", affiliation: "Psicologia Clínica (exemplo)", topic: "Escuta e acolhimento na clínica" },
        { id: "spk-2", name: "Palestrante Convidado B", affiliation: "Psicologia Organizacional (exemplo)", topic: "Saúde mental no trabalho" },
      ],
      schedule: [
        { id: "sch-1", time: "19:00", title: "Abertura e boas-vindas" },
        { id: "sch-2", time: "19:20", title: "Palestra: Escuta e acolhimento na clínica" },
        { id: "sch-3", time: "20:30", title: "Roda de conversa" },
      ],
      attendees: attendees("prj1", 8, 0),
      certificateStatus: "not_started",
      certificateHours: 4,
      documentIds: [DOC.relSemana],
      eventId: EVT.semanaPsi,
      status: "open",
      access: audience.all(),
      createdBy: USR.marina,
      createdAt: clock.at(-28, 10, 0),
      updatedAt: clock.at(-3, 10, 0),
      history: [
        h(clock.at(-28, 10, 0), USR.marina, "created", "Projeto criado e vinculado ao evento “Semana do Psicólogo”"),
        h(clock.at(-12, 10, 0), USR.marina, "status", "Inscrições abertas"),
      ],
    },
    {
      id: "prj-minicurso-avaliacao",
      code: "ENS-2026-003",
      name: "Minicurso de Avaliação Psicológica",
      description: "Introdução aos instrumentos e à ética na avaliação psicológica.",
      objective: "Complementar a formação com atividade prática supervisionada (exemplo).",
      activityType: "minicurso",
      responsibleId: USR.anabia,
      date: clock.date(-40),
      time: "14:00",
      location: "Laboratório (local de demonstração)",
      speakers: [{ id: "spk-3", name: "Docente Convidada C", affiliation: "Avaliação Psicológica (exemplo)" }],
      schedule: [
        { id: "sch-4", time: "14:00", title: "Conceitos e ética" },
        { id: "sch-5", time: "16:00", title: "Atividade prática" },
      ],
      attendees: attendees("prj2", 12, 4),
      certificateStatus: "issued",
      certificateHours: 6,
      report: "Relatório demonstrativo: atividade realizada com boa participação. Sugestão de nova turma no próximo semestre.",
      documentIds: [DOC.modeloCertificado],
      status: "done",
      access: audience.all(),
      createdBy: USR.anabia,
      createdAt: clock.at(-70, 10, 0),
      updatedAt: clock.at(-35, 10, 0),
      history: [
        h(clock.at(-70, 10, 0), USR.anabia, "created", "Projeto criado"),
        h(clock.at(-40, 18, 0), USR.anabia, "status", "Atividade realizada"),
        h(clock.at(-35, 10, 0), USR.marina, "status", "Certificados marcados como emitidos (demonstração)"),
      ],
    },
    {
      id: "prj-roda-saude-mental",
      code: "ENS-2026-006",
      name: "Roda de conversa: saúde mental na graduação",
      description: "Espaço de diálogo sobre rotina acadêmica, ansiedade e rede de apoio.",
      objective: "Promover acolhimento e divulgar serviços de apoio da universidade.",
      activityType: "roda_conversa",
      responsibleId: USR.marina,
      date: clock.date(21),
      time: "17:30",
      location: "Sala 12 (local de demonstração)",
      speakers: [],
      schedule: [],
      attendees: [],
      certificateStatus: "not_started",
      documentIds: [],
      status: "planning",
      access: audience.all(),
      createdBy: USR.marina,
      createdAt: clock.at(-4, 15, 0),
      updatedAt: clock.at(-4, 15, 0),
      history: [h(clock.at(-4, 15, 0), USR.marina, "created", "Projeto criado")],
    },
    {
      id: "prj-grupo-estudos",
      code: "ENS-2026-004",
      name: "Grupo de estudos em Psicanálise",
      description: "Encontros quinzenais de leitura e discussão de textos clássicos.",
      objective: "Aprofundar a leitura de textos com mediação de estudantes veteranos.",
      activityType: "grupo_estudos",
      responsibleId: USR.anabia,
      date: clock.date(8),
      time: "18:00",
      location: "Biblioteca (local de demonstração)",
      speakers: [{ id: "spk-4", name: "Mediador(a) Estudante D", affiliation: "8º período (exemplo)" }],
      schedule: [{ id: "sch-6", time: "18:00", title: "Leitura dirigida" }],
      attendees: attendees("prj4", 6, 0),
      certificateStatus: "in_progress",
      certificateHours: 20,
      documentIds: [],
      status: "open",
      access: audience.all(),
      createdBy: USR.anabia,
      createdAt: clock.at(-50, 10, 0),
      updatedAt: clock.at(-10, 10, 0),
      history: [h(clock.at(-50, 10, 0), USR.anabia, "created", "Projeto criado")],
    },
  ];
}

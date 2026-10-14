import type { Department, Member, Permission, Role } from "@/types";
import { allPermissions, permissionsFor } from "@/lib/modules";
import type { Clock } from "./helpers";

export const DEP = {
  presidencia: "dep-presidencia",
  secretaria: "dep-secretaria",
  financeiro: "dep-financeiro",
  marketing: "dep-marketing",
  eventos: "dep-eventos",
  extensao: "dep-extensao",
  esportes: "dep-esportes",
} as const;

export const ROLE = {
  presidente: "role-presidente",
  vice: "role-vice",
  secretaria: "role-secretaria",
  financeiro: "role-dir-financeiro",
  marketing: "role-dir-marketing",
  eventos: "role-dir-eventos",
  extensao: "role-dir-extensao",
  esportes: "role-dir-esportes",
  assEventos: "role-ass-eventos",
  assMarketing: "role-ass-marketing",
  assFinanceiro: "role-ass-financeiro",
  assExtensao: "role-ass-extensao",
  assEsportes: "role-ass-esportes",
} as const;

export const USR = {
  rebeca: "usr-rebeca",
  tomas: "usr-tomas",
  helena: "usr-helena",
  caio: "usr-caio",
  livia: "usr-livia",
  bruno: "usr-bruno",
  marina: "usr-marina",
  gabriel: "usr-gabriel",
  pedro: "usr-pedro",
  lucas: "usr-lucas",
  julia: "usr-julia",
  davi: "usr-davi",
  anabia: "usr-anabia",
  sofia: "usr-sofia",
} as const;

export function buildDepartments(clock: Clock): Department[] {
  const createdAt = clock.at(-400);
  return [
    { id: DEP.presidencia, name: "Presidência", shortName: "PRE", description: "Representação institucional e coordenação geral da Atlética.", active: true, createdAt },
    { id: DEP.secretaria, name: "Secretaria", shortName: "SEC", description: "Reuniões, atas, documentos e comunicação oficial.", active: true, createdAt },
    { id: DEP.financeiro, name: "Financeiro", shortName: "FIN", description: "Caixa, receitas, despesas e prestação de contas.", active: true, createdAt },
    { id: DEP.marketing, name: "Marketing", shortName: "MKT", description: "Identidade visual, redes sociais e divulgação.", active: true, createdAt },
    { id: DEP.eventos, name: "Eventos", shortName: "EVT", description: "Festas, integrações e ações de arrecadação.", active: true, createdAt },
    { id: DEP.extensao, name: "Ensino e Extensão", shortName: "ENS", description: "Atividades acadêmicas, palestras e projetos de extensão.", active: true, createdAt },
    { id: DEP.esportes, name: "Esportes", shortName: "ESP", description: "Modalidades esportivas e competições.", active: true, createdAt },
  ];
}

const p = permissionsFor;

function role(
  clock: Clock,
  data: Omit<Role, "createdAt" | "updatedAt" | "active"> & { active?: boolean },
): Role {
  const at = clock.at(-380);
  return { active: true, ...data, createdAt: at, updatedAt: at };
}

export function buildRoles(clock: Clock): Role[] {
  const presidencyPermissions: Permission[] = allPermissions();
  return [
    role(clock, {
      id: ROLE.presidente, name: "Presidente", departmentId: DEP.presidencia, level: "presidency", isBoard: true, homePreset: "presidency",
      description: "Coordena a Atlética e administra cargos, permissões e configurações.",
      permissions: presidencyPermissions,
    }),
    role(clock, {
      id: ROLE.vice, name: "Vice-presidente", departmentId: DEP.presidencia, level: "presidency", isBoard: true, homePreset: "presidency",
      description: "Apoia a presidência e a substitui quando necessário.",
      permissions: presidencyPermissions.filter((perm) => perm !== "settings.admin"),
    }),
    role(clock, {
      id: ROLE.secretaria, name: "Secretário(a)-geral", departmentId: DEP.secretaria, level: "director", isBoard: true, homePreset: "secretary",
      description: "Registra reuniões, mantém as atas e organiza os documentos institucionais.",
      permissions: [
        ...p("meetings", ["view", "create", "edit", "approve", "archive", "export"]),
        ...p("documents", ["view", "create", "edit", "approve", "archive", "admin"]),
        ...p("events", ["view"]),
        ...p("campaigns", ["view", "register"]),
        ...p("extension", ["view"]),
        ...p("organization", ["view"]),
        ...p("settings", ["view"]),
      ],
    }),
    role(clock, {
      id: ROLE.financeiro, name: "Diretor(a) Financeiro(a)", departmentId: DEP.financeiro, level: "director", isBoard: true, homePreset: "finance",
      description: "Responsável pelo caixa, pelos lançamentos e pelos relatórios financeiros.",
      permissions: [
        ...p("finance", ["view", "register", "edit", "approve", "archive", "export"]),
        ...p("campaigns", ["view", "create", "register", "edit", "approve", "archive", "export"]),
        ...p("events", ["view"]),
        ...p("documents", ["view", "create", "edit"]),
        ...p("meetings", ["view"]),
        ...p("organization", ["view"]),
        ...p("settings", ["view"]),
      ],
    }),
    role(clock, {
      id: ROLE.marketing, name: "Diretor(a) de Marketing", departmentId: DEP.marketing, level: "director", isBoard: true, homePreset: "marketing",
      description: "Coordena a produção de conteúdo, a identidade visual e a divulgação.",
      permissions: [
        ...p("marketing", ["view", "create", "edit", "approve", "archive"]),
        ...p("campaigns", ["view", "create", "register"]),
        ...p("events", ["view"]),
        ...p("documents", ["view", "create", "edit"]),
        ...p("meetings", ["view"]),
        ...p("organization", ["view"]),
      ],
    }),
    role(clock, {
      id: ROLE.eventos, name: "Diretor(a) de Eventos", departmentId: DEP.eventos, level: "director", isBoard: true, homePreset: "events",
      description: "Planeja e executa os eventos, com cronogramas, tarefas e fornecedores.",
      permissions: [
        ...p("events", ["view", "create", "edit", "archive", "export"]),
        ...p("campaigns", ["view", "create", "register", "edit", "archive", "export"]),
        ...p("marketing", ["view", "create"]),
        ...p("documents", ["view", "create", "edit"]),
        ...p("meetings", ["view"]),
        ...p("organization", ["view"]),
      ],
    }),
    role(clock, {
      id: ROLE.extensao, name: "Diretor(a) de Ensino e Extensão", departmentId: DEP.extensao, level: "director", isBoard: true, homePreset: "extension",
      description: "Organiza palestras, minicursos, projetos de extensão e certificados.",
      permissions: [
        ...p("extension", ["view", "create", "edit", "approve", "archive", "export"]),
        ...p("events", ["view", "create"]),
        ...p("documents", ["view", "create", "edit"]),
        ...p("marketing", ["view", "create"]),
        ...p("campaigns", ["view", "register"]),
        ...p("meetings", ["view"]),
        ...p("organization", ["view"]),
      ],
    }),
    role(clock, {
      id: ROLE.esportes, name: "Diretor(a) de Esportes", departmentId: DEP.esportes, level: "director", isBoard: true, homePreset: "events",
      description: "Coordena as modalidades esportivas e a participação em competições.",
      permissions: [
        ...p("events", ["view", "create", "edit"]),
        ...p("campaigns", ["view", "create", "register"]),
        ...p("documents", ["view", "create"]),
        ...p("meetings", ["view"]),
        ...p("organization", ["view"]),
      ],
    }),
    role(clock, {
      id: ROLE.assEventos, name: "Assessor(a) de Eventos", departmentId: DEP.eventos, level: "advisor", isBoard: false, homePreset: "advisor",
      description: "Apoia a diretoria de Eventos nas tarefas e nas vendas.",
      permissions: [...p("events", ["view", "edit"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
    }),
    role(clock, {
      id: ROLE.assMarketing, name: "Assessor(a) de Marketing", departmentId: DEP.marketing, level: "advisor", isBoard: false, homePreset: "advisor",
      description: "Produz artes, vídeos e textos para a divulgação.",
      permissions: [...p("marketing", ["view", "create", "edit"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
    }),
    role(clock, {
      id: ROLE.assFinanceiro, name: "Assessor(a) Financeiro(a)", departmentId: DEP.financeiro, level: "advisor", isBoard: false, homePreset: "advisor",
      description: "Auxilia no registro de lançamentos e na conferência de comprovantes.",
      permissions: [...p("finance", ["view", "register"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
    }),
    role(clock, {
      id: ROLE.assExtensao, name: "Assessor(a) de Ensino e Extensão", departmentId: DEP.extensao, level: "advisor", isBoard: false, homePreset: "advisor",
      description: "Apoia a organização das atividades acadêmicas e listas de presença.",
      permissions: [...p("extension", ["view", "edit"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
    }),
    role(clock, {
      id: ROLE.assEsportes, name: "Assessor(a) de Esportes", departmentId: DEP.esportes, level: "advisor", isBoard: false, homePreset: "advisor", active: true,
      description: "Apoia a organização dos treinos e das competições.",
      permissions: [...p("events", ["view"]), ...p("campaigns", ["view", "register"])],
    }),
  ];
}

function member(
  clock: Clock,
  id: string,
  name: string,
  roleId: string,
  daysAgo: number,
  extra: Partial<Member> = {},
): Member {
  const email = `${id.replace("usr-", "")}@example.org`;
  return { id, name, email, roleId, status: "active", joinedAt: clock.at(-daysAgo), ...extra };
}

/** Integrantes fictícios. Os que têm `demoProfile` aparecem na escolha de perfil da tela de login. */
export function buildMembers(clock: Clock): Member[] {
  return [
    member(clock, USR.rebeca, "Rebeca Laís", ROLE.presidente, 300, {
      demoProfile: { label: "Presidência", description: "Visão institucional, cargos, permissões e configurações.", order: 1 },
    }),
    member(clock, USR.tomas, "Tomás Andrade", ROLE.vice, 300),
    member(clock, USR.helena, "Helena Prado", ROLE.secretaria, 290, {
      demoProfile: { label: "Secretaria", description: "Reuniões, atas em PDF e documentos institucionais.", order: 2 },
    }),
    member(clock, USR.caio, "Caio Menezes", ROLE.financeiro, 290, {
      demoProfile: { label: "Direção Financeira", description: "Receitas, despesas, comprovantes e relatórios.", order: 3 },
    }),
    member(clock, USR.livia, "Lívia Moraes", ROLE.marketing, 280, {
      demoProfile: { label: "Direção de Marketing", description: "Briefings, artes, vídeos e calendário de conteúdo.", order: 4 },
    }),
    member(clock, USR.bruno, "Bruno Teles", ROLE.eventos, 280, {
      demoProfile: { label: "Direção de Eventos", description: "Eventos, tarefas, programação e fornecedores.", order: 5 },
    }),
    member(clock, USR.marina, "Marina Saraiva", ROLE.extensao, 270, {
      demoProfile: { label: "Ensino e Extensão", description: "Projetos, palestrantes, presença e certificados.", order: 6 },
    }),
    member(clock, USR.gabriel, "Gabriel Souto", ROLE.esportes, 260),
    member(clock, USR.pedro, "Pedro Lins", ROLE.assEventos, 200, {
      demoProfile: { label: "Assessor", description: "Acesso restrito: tarefas de eventos e registro de vendas.", order: 7 },
    }),
    member(clock, USR.lucas, "Lucas Farias", ROLE.assEventos, 150),
    member(clock, USR.julia, "Júlia Rocha", ROLE.assMarketing, 190),
    member(clock, USR.davi, "Davi Campos", ROLE.assFinanceiro, 180),
    member(clock, USR.anabia, "Ana Beatriz Nunes", ROLE.assExtensao, 170),
    member(clock, USR.sofia, "Sofia Ventura", ROLE.assEsportes, 240, { status: "inactive" }),
  ];
}

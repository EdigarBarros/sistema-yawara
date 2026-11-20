/**
 * ESTRUTURA INSTITUCIONAL INICIAL (sem pessoas e sem registros)
 * ---------------------------------------------------------------------------
 * Departamentos, cargos com permissões, categorias e configurações usados na
 * implantação inicial de um ambiente real (scripts/bootstrap.ts) e nos testes.
 * Nada aqui é dado fictício de operação: são apenas modelos que a presidência
 * pode renomear, desativar ou ampliar depois, pela própria Central.
 *
 * Os cargos NÃO são fixos no código: a autorização usa sempre as permissões
 * gravadas no cargo, nunca o nome dele.
 */
import type { Department, DocumentCategory, FinanceCategory, Permission, Role, SystemSettings } from "@/types";
import { allPermissions, permissionsFor as p } from "@/lib/modules";

type DepartmentSeed = Omit<Department, "createdAt">;
type RoleSeed = Omit<Role, "createdAt" | "updatedAt">;

export const DEFAULT_DEPARTMENTS: DepartmentSeed[] = [
  { id: "presidencia", name: "Presidência", shortName: "PRE", description: "Representação institucional e coordenação geral da Atlética.", active: true },
  { id: "secretaria", name: "Secretaria", shortName: "SEC", description: "Reuniões, atas, documentos e comunicação oficial.", active: true },
  { id: "financeiro", name: "Financeiro", shortName: "FIN", description: "Caixa, receitas, despesas e prestação de contas.", active: true },
  { id: "marketing", name: "Marketing", shortName: "MKT", description: "Identidade visual, redes sociais e divulgação.", active: true },
  { id: "eventos", name: "Eventos", shortName: "EVT", description: "Festas, integrações e ações de arrecadação.", active: true },
  { id: "extensao", name: "Ensino e Extensão", shortName: "ENS", description: "Atividades acadêmicas, palestras e projetos de extensão.", active: true },
  { id: "esportes", name: "Esportes", shortName: "ESP", description: "Modalidades esportivas, treinos e competições.", active: true },
];

const presidency: Permission[] = allPermissions();

export const DEFAULT_ROLES: RoleSeed[] = [
  {
    id: "presidente", name: "Presidente", departmentId: "presidencia", level: "presidency", isBoard: true, active: true, homePreset: "presidency",
    description: "Coordena a Atlética e administra cargos, permissões e configurações.",
    permissions: presidency,
  },
  {
    id: "vice-presidente", name: "Vice-presidente", departmentId: "presidencia", level: "presidency", isBoard: true, active: true, homePreset: "presidency",
    description: "Apoia a presidência e a substitui quando necessário.",
    permissions: presidency.filter((perm) => perm !== "settings.admin"),
  },
  {
    id: "secretario", name: "Secretário(a)", departmentId: "secretaria", level: "director", isBoard: true, active: true, homePreset: "secretary",
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
  },
  {
    id: "diretor-financeiro", name: "Diretor(a) Financeiro(a)", departmentId: "financeiro", level: "director", isBoard: true, active: true, homePreset: "finance",
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
  },
  {
    id: "diretor-marketing", name: "Diretor(a) de Marketing", departmentId: "marketing", level: "director", isBoard: true, active: true, homePreset: "marketing",
    description: "Coordena a produção de conteúdo, a identidade visual e a divulgação.",
    permissions: [
      ...p("marketing", ["view", "create", "edit", "approve", "archive"]),
      ...p("campaigns", ["view", "create", "register"]),
      ...p("events", ["view"]),
      ...p("documents", ["view", "create", "edit"]),
      ...p("meetings", ["view"]),
      ...p("organization", ["view"]),
    ],
  },
  {
    id: "diretor-eventos", name: "Diretor(a) de Eventos", departmentId: "eventos", level: "director", isBoard: true, active: true, homePreset: "events",
    description: "Planeja e executa os eventos, com cronogramas, tarefas e fornecedores.",
    permissions: [
      ...p("events", ["view", "create", "edit", "archive", "export"]),
      ...p("campaigns", ["view", "create", "register", "edit", "archive", "export"]),
      ...p("marketing", ["view", "create"]),
      ...p("documents", ["view", "create", "edit"]),
      ...p("meetings", ["view"]),
      ...p("organization", ["view"]),
    ],
  },
  {
    id: "diretor-extensao", name: "Diretor(a) de Ensino e Extensão", departmentId: "extensao", level: "director", isBoard: true, active: true, homePreset: "extension",
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
  },
  {
    id: "diretor-esportes", name: "Diretor(a) de Esportes", departmentId: "esportes", level: "director", isBoard: true, active: true, homePreset: "sports",
    description: "Coordena as modalidades esportivas, os treinos e a participação em competições.",
    permissions: [
      ...p("sports", ["view", "create", "edit", "archive", "export"]),
      ...p("events", ["view", "create"]),
      ...p("campaigns", ["view", "create", "register"]),
      ...p("documents", ["view", "create", "edit"]),
      ...p("marketing", ["view", "create"]),
      ...p("meetings", ["view"]),
      ...p("organization", ["view"]),
    ],
  },
  {
    id: "assessor-eventos", name: "Assessor(a) de Eventos", departmentId: "eventos", level: "advisor", isBoard: false, active: true, homePreset: "advisor",
    description: "Apoia a diretoria de Eventos nas tarefas e nas vendas.",
    permissions: [...p("events", ["view", "edit"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
  },
  {
    id: "assessor-marketing", name: "Assessor(a) de Marketing", departmentId: "marketing", level: "advisor", isBoard: false, active: true, homePreset: "advisor",
    description: "Produz artes, vídeos e textos para a divulgação.",
    permissions: [...p("marketing", ["view", "create", "edit"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
  },
  {
    id: "assessor-financeiro", name: "Assessor(a) Financeiro(a)", departmentId: "financeiro", level: "advisor", isBoard: false, active: true, homePreset: "advisor",
    description: "Auxilia no registro de lançamentos e na conferência de comprovantes.",
    permissions: [...p("finance", ["view", "register"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
  },
  {
    id: "assessor-extensao", name: "Assessor(a) de Ensino e Extensão", departmentId: "extensao", level: "advisor", isBoard: false, active: true, homePreset: "advisor",
    description: "Apoia a organização das atividades acadêmicas e listas de presença.",
    permissions: [...p("extension", ["view", "edit"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
  },
  {
    id: "assessor-esportes", name: "Assessor(a) de Esportes", departmentId: "esportes", level: "advisor", isBoard: false, active: true, homePreset: "advisor",
    description: "Apoia a diretoria de Esportes nos treinos, no elenco e nos jogos.",
    permissions: [...p("sports", ["view", "edit"]), ...p("campaigns", ["view", "register"]), ...p("documents", ["view"])],
  },
];

export const DEFAULT_DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "Estatuto",
  "Ata de fundação",
  "Atas de reuniões",
  "Documentos administrativos",
  "Relatórios financeiros",
  "Relatórios de eventos",
  "Relatórios de Ensino e Extensão",
  "Contratos",
  "Propostas",
  "Certificados",
  "Identidade visual",
  "Outros",
].map((name) => ({ id: slug(name), name }));

export const DEFAULT_FINANCE_CATEGORIES: FinanceCategory[] = [
  ...["Rifas e campanhas", "Ingressos de eventos", "Patrocínios e parcerias", "Venda de produtos", "Doações", "Outras receitas"].map((name) => ({ id: `rec-${slug(name)}`, name, type: "income" as const })),
  ...["Locação de espaço", "Materiais e insumos", "Impressão e brindes", "Alimentação", "Transporte", "Serviços de terceiros", "Taxas e tarifas", "Outras despesas"].map((name) => ({ id: `desp-${slug(name)}`, name, type: "expense" as const })),
];

export function defaultSystemSettings(): SystemSettings {
  return {
    institution: {
      legalName: "Associação Atlética Acadêmica de Psicologia Yawara",
      shortName: "Atlética Yawara",
      systemName: "Central Yawara",
      course: "Psicologia",
      institution: "",
      city: "",
      email: "",
      instagram: "",
      motto: "",
    },
    modules: { campaigns: true, events: true, documents: true, meetings: true, finance: true, marketing: true, extension: true, sports: true, organization: true, settings: true, audit: true },
  };
}

function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

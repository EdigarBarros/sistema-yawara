import type { ModuleKey, Permission, PermissionAction } from "@/types";

export interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  /** Ações que fazem sentido no módulo, com a explicação mostrada na tela de permissões. */
  actions: Partial<Record<PermissionAction, string>>;
  /** Módulos essenciais não podem ser desativados nas configurações. */
  core?: boolean;
}

export const MODULES: ModuleDefinition[] = [
  {
    key: "campaigns",
    label: "Campanhas e vendas",
    description: "Rifas e campanhas de arrecadação.",
    actions: {
      view: "Ver campanhas autorizadas",
      create: "Criar novas rifas",
      register: "Registrar vendas e reservas",
      edit: "Editar campanhas e dados de vendas",
      approve: "Confirmar recebimentos",
      archive: "Encerrar e reabrir campanhas",
      export: "Exportar relatórios com dados de vendas",
      admin: "Gerenciar acesso de qualquer campanha",
    },
  },
  {
    key: "events",
    label: "Eventos e projetos",
    description: "Planejamento de eventos, tarefas e cronogramas.",
    actions: {
      view: "Ver eventos autorizados",
      create: "Criar e duplicar eventos",
      edit: "Editar eventos, tarefas e programação",
      archive: "Concluir ou cancelar eventos",
      export: "Exportar dados de eventos",
      admin: "Gerenciar acesso de qualquer evento",
    },
  },
  {
    key: "documents",
    label: "Documentos",
    description: "Biblioteca institucional de arquivos.",
    actions: {
      view: "Ver documentos autorizados",
      create: "Adicionar documentos",
      edit: "Alterar dados e enviar novas versões",
      approve: "Marcar documentos como vigentes",
      archive: "Arquivar e restaurar documentos",
      admin: "Gerenciar acesso de qualquer documento",
    },
  },
  {
    key: "meetings",
    label: "Secretaria e reuniões",
    description: "Reuniões, atas e encaminhamentos.",
    actions: {
      view: "Ver reuniões autorizadas",
      create: "Registrar reuniões",
      edit: "Editar atas",
      approve: "Aprovar atas",
      archive: "Arquivar atas",
      export: "Gerar PDF das atas",
    },
  },
  {
    key: "finance",
    label: "Financeiro",
    description: "Receitas, despesas e relatórios.",
    actions: {
      view: "Ver lançamentos e indicadores",
      register: "Registrar receitas e despesas",
      edit: "Editar lançamentos",
      approve: "Confirmar recebimentos e pagamentos",
      archive: "Cancelar lançamentos",
      export: "Exportar e compartilhar relatórios",
    },
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Produção de conteúdo e calendário editorial.",
    actions: {
      view: "Ver conteúdos",
      create: "Criar conteúdos e briefings",
      edit: "Editar conteúdos e mudar etapas",
      approve: "Aprovar materiais",
      archive: "Cancelar conteúdos",
    },
  },
  {
    key: "extension",
    label: "Ensino e Extensão",
    description: "Projetos e atividades acadêmicas.",
    actions: {
      view: "Ver projetos",
      create: "Criar projetos",
      edit: "Editar projetos, presença e programação",
      approve: "Emitir certificados (demonstração)",
      archive: "Concluir ou cancelar projetos",
      export: "Exportar listas e certificados",
    },
  },
  {
    key: "organization",
    label: "Diretoria e organização",
    description: "Integrantes, cargos, departamentos e permissões.",
    core: true,
    actions: {
      view: "Ver integrantes e cargos",
      create: "Convidar integrantes e criar cargos e departamentos",
      edit: "Editar integrantes, cargos e departamentos; desativar contas",
      admin: "Alterar permissões dos cargos e atribuir cargos com permissões administrativas",
    },
  },
  {
    key: "settings",
    label: "Configurações",
    description: "Dados institucionais e preferências do sistema.",
    core: true,
    actions: {
      view: "Ver configurações",
      edit: "Editar configurações institucionais",
      admin: "Ativar e desativar módulos",
    },
  },
  {
    key: "audit",
    label: "Auditoria",
    description: "Registro oficial das operações importantes, gravado pelo servidor.",
    core: true,
    actions: {
      view: "Consultar a auditoria",
      export: "Exportar registros de auditoria",
    },
  },
];

export const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<ModuleKey, ModuleDefinition>;

export function permissionsFor(module: ModuleKey, actions: PermissionAction[]): Permission[] {
  return actions.map((a) => `${module}.${a}` as Permission);
}

export function allPermissions(): Permission[] {
  return MODULES.flatMap((m) => Object.keys(m.actions).map((a) => `${m.key}.${a}` as Permission));
}

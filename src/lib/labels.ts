/**
 * Rótulos em português e "tons" visuais de todos os enums do domínio.
 * Centralizados aqui para que a mesma situação tenha sempre o mesmo nome e
 * a mesma cor em qualquer tela.
 */
import type {
  ActivityType,
  AudienceScope,
  CampaignStatus,
  CertificateStatus,
  Channel,
  ContentStatus,
  ContentType,
  DocumentStatus,
  EntryStatus,
  EntryType,
  EventStatus,
  EventType,
  HistoryAction,
  MeetingMode,
  MeetingStatus,
  ModuleKey,
  NumberStatus,
  PaymentMethod,
  PermissionAction,
  ProjectStatus,
  RoleLevel,
  SaleStatus,
  TaskStatus,
} from "@/types";

export type Tone = "neutral" | "gold" | "ok" | "warn" | "danger" | "info" | "ice";

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export const MODULE_LABELS: Record<ModuleKey, string> = {
  campaigns: "Campanhas e vendas",
  events: "Eventos e projetos",
  documents: "Documentos",
  meetings: "Secretaria e reuniões",
  finance: "Financeiro",
  marketing: "Marketing",
  extension: "Ensino e Extensão",
  organization: "Diretoria e organização",
  settings: "Configurações",
};

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Visualizar",
  create: "Criar",
  register: "Registrar",
  edit: "Editar",
  approve: "Aprovar",
  archive: "Arquivar",
  export: "Exportar",
  admin: "Administrar",
};

export const ROLE_LEVEL_LABELS: Record<RoleLevel, string> = {
  presidency: "Presidência",
  director: "Diretoria",
  advisor: "Assessoria",
  member: "Integrante",
};

export const AUDIENCE_SCOPE_LABELS: Record<AudienceScope, string> = {
  department: "Meu departamento",
  board: "Somente diretoria",
  directors: "Somente diretores",
  directors_advisors: "Diretores e assessores",
  all: "Todos os integrantes da Central",
  roles: "Cargos específicos",
  people: "Pessoas específicas",
};

export const AUDIENCE_SCOPE_HINTS: Record<AudienceScope, string> = {
  department: "Apenas integrantes do departamento responsável.",
  board: "Presidência, vice-presidência, secretaria e diretores.",
  directors: "Presidência e diretores de todos os departamentos.",
  directors_advisors: "Diretores e assessores de todos os departamentos.",
  all: "Qualquer integrante ativo da Central.",
  roles: "Escolha um ou mais cargos.",
  people: "Escolha pessoas pelo nome.",
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, StatusMeta> = {
  active: { label: "Ativa", tone: "ok" },
  closed: { label: "Encerrada", tone: "neutral" },
};

export const NUMBER_STATUS: Record<NumberStatus, StatusMeta & { symbol: string; description: string }> = {
  available: { label: "Disponível", tone: "neutral", symbol: "", description: "Pode ser vendido" },
  reserved: { label: "Reservado", tone: "ice", symbol: "◷", description: "Separado para um comprador, ainda não vendido" },
  pending: { label: "Vendido, pagamento pendente", tone: "warn", symbol: "!", description: "Venda registrada, aguardando pagamento" },
  paid: { label: "Pago", tone: "ok", symbol: "✓", description: "Venda registrada e pagamento confirmado" },
  cancelled: { label: "Cancelado", tone: "danger", symbol: "×", description: "Venda cancelada; precisa ser liberado para voltar à venda" },
};

export const SALE_STATUS: Record<SaleStatus, StatusMeta> = {
  reserved: { label: "Reservado", tone: "ice" },
  pending: { label: "Pagamento pendente", tone: "warn" },
  paid: { label: "Pago", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  card: "Cartão",
  transfer: "Transferência",
  other: "Outra",
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  festa: "Festa",
  esportivo: "Esportivo",
  academico: "Acadêmico",
  integracao: "Integração",
  arrecadacao: "Arrecadação",
  projeto: "Projeto",
  outro: "Outro",
};

export const EVENT_STATUS: Record<EventStatus, StatusMeta> = {
  planning: { label: "Em planejamento", tone: "info" },
  confirmed: { label: "Confirmado", tone: "ok" },
  done: { label: "Concluído", tone: "neutral" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export const TASK_STATUS: Record<TaskStatus, StatusMeta> = {
  todo: { label: "A fazer", tone: "neutral" },
  doing: { label: "Em andamento", tone: "info" },
  blocked: { label: "Bloqueada", tone: "warn" },
  done: { label: "Concluída", tone: "ok" },
};

export const SUPPLIER_STATUS: Record<"quoted" | "hired" | "declined", StatusMeta> = {
  quoted: { label: "Orçamento", tone: "info" },
  hired: { label: "Contratado", tone: "ok" },
  declined: { label: "Descartado", tone: "neutral" },
};

export const DOCUMENT_STATUS: Record<DocumentStatus, StatusMeta> = {
  current: { label: "Vigente", tone: "ok" },
  draft: { label: "Em elaboração", tone: "info" },
  archived: { label: "Arquivado", tone: "neutral" },
};

export const MEETING_STATUS: Record<MeetingStatus, StatusMeta> = {
  draft: { label: "Rascunho", tone: "neutral" },
  pending_approval: { label: "Aguardando aprovação", tone: "warn" },
  approved: { label: "Aprovada", tone: "ok" },
  archived: { label: "Arquivada", tone: "ice" },
};

export const MEETING_MODE_LABELS: Record<MeetingMode, string> = {
  presencial: "Presencial",
  online: "Online",
  hibrida: "Híbrida",
};

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  income: "Receita",
  expense: "Despesa",
};

export function entryStatusMeta(type: EntryType, status: EntryStatus): StatusMeta {
  if (status === "cancelled") return { label: "Cancelado", tone: "neutral" };
  if (status === "settled") return { label: type === "income" ? "Recebido" : "Pago", tone: "ok" };
  return { label: type === "income" ? "A receber" : "A pagar", tone: "warn" };
}

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  arte: "Arte",
  video: "Vídeo",
  reels: "Reels",
  story: "Story",
  carrossel: "Carrossel",
  texto: "Texto",
  outro: "Outro",
};

export const CONTENT_STATUS: Record<ContentStatus, StatusMeta> = {
  briefing: { label: "Briefing", tone: "neutral" },
  production: { label: "Em produção", tone: "info" },
  review: { label: "Em revisão", tone: "warn" },
  approved: { label: "Aprovado", tone: "gold" },
  published: { label: "Publicado", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export const CONTENT_FLOW: ContentStatus[] = ["briefing", "production", "review", "approved", "published"];

export const CHANNEL_LABELS: Record<Channel, string> = {
  instagram_feed: "Instagram (feed)",
  instagram_stories: "Instagram (stories)",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  mural: "Mural / impresso",
  outro: "Outro",
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  palestra: "Palestra",
  workshop: "Workshop",
  roda_conversa: "Roda de conversa",
  minicurso: "Minicurso",
  projeto_extensao: "Projeto de extensão",
  grupo_estudos: "Grupo de estudos",
  outro: "Outro",
};

export const PROJECT_STATUS: Record<ProjectStatus, StatusMeta> = {
  planning: { label: "Em planejamento", tone: "info" },
  open: { label: "Inscrições abertas", tone: "gold" },
  done: { label: "Realizado", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export const CERTIFICATE_STATUS: Record<CertificateStatus, StatusMeta> = {
  not_started: { label: "Não iniciados", tone: "neutral" },
  in_progress: { label: "Em preparação", tone: "info" },
  issued: { label: "Emitidos (demonstração)", tone: "ok" },
};

export const HISTORY_ACTION_LABELS: Record<HistoryAction, string> = {
  created: "Criação",
  updated: "Edição",
  status: "Alteração de situação",
  shared: "Compartilhamento",
  archived: "Arquivamento",
  restored: "Restauração",
  sale: "Venda registrada",
  payment: "Pagamento",
  cancelled: "Cancelamento",
  released: "Liberação",
  closed: "Encerramento",
  reopened: "Reabertura",
  version: "Nova versão",
  duplicated: "Duplicação",
  attachment: "Anexo",
};

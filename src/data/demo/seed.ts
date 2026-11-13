/**
 * Ponto único de criação dos dados de demonstração.
 * Todos os módulos leem destes registros — nenhum componente define dados
 * fictícios por conta própria.
 */
import type {
  AppNotification,
  AtleticaEvent,
  Campaign,
  ContentItem,
  Department,
  DocumentCategory,
  ExtensionProject,
  SportTeam,
  FinanceCategory,
  FinanceEntry,
  InstitutionalDocument,
  Meeting,
  Member,
  Role,
  Sale,
  SystemSettings,
} from "@/types";
import { audience, createClock, createRng, type Clock } from "./helpers";
import { buildDepartments, buildMembers, buildRoles, DEP, USR } from "./organization";
import { buildCampaigns, buildSales, CMP } from "./campaigns";
import { buildEvents, EVT } from "./events";
import { buildDocumentCategories, buildDocuments, DOC } from "./documents";
import { buildMeetings } from "./meetings";
import { buildFinanceCategories, buildFinanceEntries } from "./finance";
import { buildContents } from "./marketing";
import { buildProjects } from "./extension";
import { buildSportsTeams } from "./sports";

export const DEMO_DB_VERSION = 3;

export interface DemoDB {
  version: number;
  seededAt: string;
  settings: SystemSettings;
  departments: Department[];
  roles: Role[];
  members: Member[];
  campaigns: Campaign[];
  sales: Sale[];
  events: AtleticaEvent[];
  documentCategories: DocumentCategory[];
  documents: InstitutionalDocument[];
  meetings: Meeting[];
  financeCategories: FinanceCategory[];
  financeEntries: FinanceEntry[];
  contents: ContentItem[];
  projects: ExtensionProject[];
  sportsTeams: SportTeam[];
  notifications: AppNotification[];
  /** Contadores para gerar códigos legíveis (RIFA-2026-011, EVT-2026-019…). */
  counters: Record<string, number>;
}

export function defaultSettings(): SystemSettings {
  return {
    institution: {
      legalName: "Associação Atlética Acadêmica de Psicologia Yawara",
      shortName: "Atlética Yawara",
      systemName: "Central Yawara",
      course: "Psicologia",
      institution: "Instituição de ensino (a preencher)",
      city: "Cidade (a preencher)",
      email: "contato@example.org",
      instagram: "@atleticayawara",
      motto: "#SomosYawara",
    },
    modules: {
      campaigns: true,
      events: true,
      documents: true,
      meetings: true,
      finance: true,
      marketing: true,
      extension: true,
      sports: true,
      organization: true,
      settings: true,
      audit: true,
    },
  };
}

function buildNotifications(clock: Clock): AppNotification[] {
  const n = (
    id: string,
    kind: AppNotification["kind"],
    title: string,
    body: string,
    href: string,
    daysAgo: number,
    aud = audience.all(),
    actorId?: string,
  ): AppNotification => ({ id, kind, title, body, href, createdAt: clock.at(-daysAgo, 9 + (daysAgo % 9), 15), audience: aud, actorId, readBy: [] });

  return [
    n("ntf-1", "document_shared", "Arte aprovada compartilhada com a diretoria", "Lívia Moraes compartilhou “Arte oficial — Calourada 2026.2”.", `/documentos/${DOC.arteCalourada}`, 1, audience.board(), USR.livia),
    n("ntf-2", "event_updated", "Calourada 2026.2 atualizada", "Novas tarefas e fornecedores foram registrados.", `/eventos/${EVT.calourada}`, 2, audience.all(), USR.bruno),
    n("ntf-3", "meeting_registered", "Ata aguardando aprovação", "“Planejamento da Calourada 2026.2” foi enviada para aprovação.", "/secretaria/mtg-planejamento-calourada", 5, audience.board(), USR.helena),
    n("ntf-4", "campaign_shared", "Nova rifa disponível para vendas", "Você pode registrar vendas na “Rifa do Moletom Oficial”.", `/campanhas/${CMP.moletom}`, 3, audience.directorsAdvisors(), USR.livia),
    n("ntf-5", "campaign_closed", "Rifa encerrada", "A “Rifa de Boas-vindas 2026.1” foi encerrada para novas vendas.", `/campanhas/${CMP.boasVindas}`, 89, audience.all(), USR.rebeca),
    n("ntf-6", "report_shared", "Relatório financeiro compartilhado", "Caio Menezes compartilhou o relatório do 1º semestre com a diretoria.", `/documentos/${DOC.relFinanceiro}`, 95, audience.board(), USR.caio),
    n("ntf-7", "campaign_shared", "Campanha restrita compartilhada com você", "Você tem acesso à “Rifa do Ingresso VIP — Calourada”.", `/campanhas/${CMP.vip}`, 6, audience.roles("role-presidente", "role-vice", "role-dir-eventos"), USR.caio),
    n("ntf-8", "event_updated", "Semana do Psicólogo confirmada", "Programação e palestrantes definidos.", `/eventos/${EVT.semanaPsi}`, 3, audience.all(), USR.marina),
  ];
}

export function buildSeed(now = new Date(), seed = 2026): DemoDB {
  const clock = createClock(now);
  const rng = createRng(seed);
  return {
    version: DEMO_DB_VERSION,
    seededAt: now.toISOString(),
    settings: defaultSettings(),
    departments: buildDepartments(clock),
    roles: buildRoles(clock),
    members: buildMembers(clock),
    campaigns: buildCampaigns(clock),
    sales: buildSales(rng, clock),
    events: buildEvents(clock),
    documentCategories: buildDocumentCategories(),
    documents: buildDocuments(clock),
    meetings: buildMeetings(clock),
    financeCategories: buildFinanceCategories(),
    financeEntries: buildFinanceEntries(clock),
    contents: buildContents(clock),
    projects: buildProjects(clock),
    sportsTeams: buildSportsTeams(clock),
    notifications: buildNotifications(clock),
    counters: { RIFA: 10, EVT: 18, REU: 22, LAN: 30, MKT: 50, ENS: 6, ESP: 3 },
  };
}

export { DEP, USR };

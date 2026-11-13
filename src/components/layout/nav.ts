import { CalendarDays, ClipboardList, FolderOpen, GraduationCap, House, Megaphone, ScrollText, Settings, Ticket, Trophy, Users, Wallet, type LucideIcon } from "lucide-react";
import type { ModuleKey } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Sem módulo = sempre visível (Início). */
  module?: ModuleKey;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/** Navegação agrupada; cada perfil vê apenas os módulos autorizados. */
export const NAV: NavGroup[] = [
  { items: [{ label: "Início", href: "/inicio", icon: House }] },
  {
    label: "Operação",
    items: [
      { label: "Campanhas e vendas", href: "/campanhas", icon: Ticket, module: "campaigns" },
      { label: "Eventos e projetos", href: "/eventos", icon: CalendarDays, module: "events" },
      { label: "Financeiro", href: "/financeiro", icon: Wallet, module: "finance" },
      { label: "Marketing", href: "/marketing", icon: Megaphone, module: "marketing" },
      { label: "Esportes", href: "/esportes", icon: Trophy, module: "sports" },
    ],
  },
  {
    label: "Institucional",
    items: [
      { label: "Documentos", href: "/documentos", icon: FolderOpen, module: "documents" },
      { label: "Secretaria e reuniões", href: "/secretaria", icon: ClipboardList, module: "meetings" },
      { label: "Ensino e Extensão", href: "/extensao", icon: GraduationCap, module: "extension" },
    ],
  },
  {
    label: "Administração",
    items: [
      { label: "Diretoria e organização", href: "/diretoria", icon: Users, module: "organization" },
      { label: "Configurações", href: "/configuracoes", icon: Settings, module: "settings" },
      { label: "Auditoria", href: "/auditoria", icon: ScrollText, module: "audit" },
    ],
  },
];

/** Cor de cada área (o ícone fica num "chip" colorido). */
export const AREA_COLORS: Record<string, string> = {
  "/campanhas": "#e1af37",
  "/eventos": "#f2a93b",
  "/financeiro": "#5b86d9",
  "/marketing": "#e88ab5",
  "/documentos": "#3fcf8e",
  "/secretaria": "#8fb0ec",
  "/extensao": "#7fd9b0",
  "/esportes": "#f07a5a",
  "/diretoria": "#b6a9ff",
  "/configuracoes": "#c5cde6",
  "/auditoria": "#e9b4cf",
};

/** Rótulos fixos usados nos breadcrumbs. */
export const ROUTE_LABELS: Record<string, string> = {
  inicio: "Início",
  perfil: "Meu perfil",
  agenda: "Agenda",
  avisos: "Avisos",
  mais: "Todas as áreas",
  campanhas: "Campanhas e vendas",
  nova: "Nova rifa",
  eventos: "Eventos e projetos",
  novo: "Novo",
  documentos: "Documentos",
  secretaria: "Secretaria e reuniões",
  registrar: "Registrar reunião",
  editar: "Editar",
  financeiro: "Financeiro",
  lancamentos: "Lançamentos",
  relatorios: "Relatórios",
  marketing: "Marketing",
  extensao: "Ensino e Extensão",
  esportes: "Esportes",
  diretoria: "Diretoria e organização",
  cargos: "Cargos",
  configuracoes: "Configurações",
  auditoria: "Auditoria",
};

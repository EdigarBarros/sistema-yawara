"use client";

import { CalendarPlus, ClipboardPlus, FilePlus2, GraduationCap, KeyRound, Megaphone, MinusCircle, PlusCircle, Settings, Ticket, Users } from "lucide-react";
import type { HomePreset } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { firstName, formatLongDate, greeting } from "@/lib/format";
import { PageHeader, Panel } from "@/components/shared/page";
import { ListRow } from "@/components/shared/list-row";
import {
  ActiveCampaignsPanel,
  CampaignCollectionPanel,
  CampaignStats,
  DocumentStats,
  EventStats,
  ExtensionStats,
  FinanceStats,
  MarketingStats,
  MeetingStats,
  MeetingsPanel,
  NoticesPanel,
  ProjectsPanel,
  QuickAction,
  RecentDocumentsPanel,
  RecentEntriesPanel,
  StatsRow,
  TasksPanel,
  TaskStats,
  UpcomingContentPanel,
  UpcomingEventsPanel,
} from "@/features/home/widgets";

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>;
}

function AdminShortcuts() {
  const access = useAccess();
  return (
    <Panel title="Ferramentas administrativas" description="Disponíveis para o seu cargo" bodyClassName="py-1.5">
      <ul className="divide-y divide-line">
        {access.can("organization.view") && (
          <li>
            <ListRow href="/diretoria" leading={<Users className="size-4 text-fg-muted" />} title="Integrantes e cargos" subtitle="Quem faz parte da Atlética e em qual departamento" />
          </li>
        )}
        {access.can("organization.admin") && (
          <li>
            <ListRow href="/diretoria?aba=permissoes" leading={<KeyRound className="size-4 text-fg-muted" />} title="Permissões por cargo" subtitle="Defina o que cada cargo pode ver e fazer" />
          </li>
        )}
        {access.canModule("settings") && (
          <li>
            <ListRow href="/configuracoes" leading={<Settings className="size-4 text-fg-muted" />} title="Configurações" subtitle="Dados institucionais, módulos e categorias" />
          </li>
        )}
      </ul>
    </Panel>
  );
}

/** Conteúdo da página inicial para cada perfil. */
function HomeContent({ preset }: { preset: HomePreset }) {
  const access = useAccess();
  const can = access.can;
  const has = access.canModule;

  switch (preset) {
    case "presidency":
      return (
        <div className="space-y-4">
          <StatsRow>
            {has("campaigns") && <CampaignStats />}
            {has("events") && <EventStats />}
            {has("finance") ? <FinanceStats compact /> : has("meetings") && <MeetingStats kinds={["pending"]} />}
          </StatsRow>
          <Grid>
            {has("campaigns") && <ActiveCampaignsPanel />}
            {has("events") && <UpcomingEventsPanel />}
            {has("documents") && <RecentDocumentsPanel sharedOnly />}
            <NoticesPanel />
            {has("meetings") && <MeetingsPanel mode="pending" />}
            <AdminShortcuts />
          </Grid>
        </div>
      );
    case "secretary":
      return (
        <div className="space-y-4">
          <StatsRow>
            {has("meetings") && <MeetingStats kinds={["upcoming", "draft", "pending"]} />}
            {has("documents") && <DocumentStats />}
          </StatsRow>
          <Grid>
            {has("meetings") && <MeetingsPanel mode="upcoming" />}
            {has("meetings") && <MeetingsPanel mode="pending" />}
            {has("documents") && <RecentDocumentsPanel />}
            <NoticesPanel />
          </Grid>
        </div>
      );
    case "finance":
      return (
        <div className="space-y-4">
          <StatsRow>{has("finance") && <FinanceStats />}</StatsRow>
          <Grid>
            {has("finance") && <RecentEntriesPanel />}
            {has("campaigns") && <CampaignCollectionPanel />}
            {has("events") && <UpcomingEventsPanel limit={4} />}
            {has("documents") && <RecentDocumentsPanel sharedOnly />}
          </Grid>
        </div>
      );
    case "marketing":
      return (
        <div className="space-y-4">
          <StatsRow>{has("marketing") && <MarketingStats />}</StatsRow>
          <Grid>
            {has("marketing") && <UpcomingContentPanel />}
            {has("campaigns") && <ActiveCampaignsPanel title="Campanhas para divulgar" />}
            {has("events") && <UpcomingEventsPanel limit={4} />}
            {has("documents") && <RecentDocumentsPanel />}
          </Grid>
        </div>
      );
    case "events":
      return (
        <div className="space-y-4">
          <StatsRow>
            {has("events") && <EventStats />}
            {has("events") && <TaskStats />}
            {has("campaigns") && can("campaigns.create") && <CampaignStats />}
          </StatsRow>
          <Grid>
            {has("events") && <UpcomingEventsPanel />}
            {has("events") && <TasksPanel />}
            {has("campaigns") && <ActiveCampaignsPanel />}
            {has("documents") && <RecentDocumentsPanel sharedOnly />}
          </Grid>
        </div>
      );
    case "extension":
      return (
        <div className="space-y-4">
          <StatsRow>{has("extension") && <ExtensionStats />}</StatsRow>
          <Grid>
            {has("extension") && <ProjectsPanel />}
            {has("events") && <UpcomingEventsPanel limit={4} />}
            {has("documents") && <RecentDocumentsPanel />}
            <NoticesPanel />
          </Grid>
        </div>
      );
    case "advisor":
    default:
      return (
        <Grid>
          {has("events") && <TasksPanel mine />}
          {has("campaigns") && <ActiveCampaignsPanel sellOnly title="Campanhas para vender" />}
          {has("events") && <UpcomingEventsPanel limit={4} />}
          <NoticesPanel />
        </Grid>
      );
  }
}

function QuickActions({ preset }: { preset: HomePreset }) {
  const access = useAccess();
  const can = (p: Parameters<typeof access.can>[0]) => access.can(p) && access.moduleEnabled(p.split(".")[0] as never);
  const actions: { href: string; icon: React.ReactNode; label: string; show: boolean }[] = {
    presidency: [
      { href: "/campanhas/nova", icon: <Ticket />, label: "Nova rifa", show: can("campaigns.create") },
      { href: "/eventos?novo=1", icon: <CalendarPlus />, label: "Novo evento", show: can("events.create") },
      { href: "/diretoria?aba=permissoes", icon: <KeyRound />, label: "Cargos e permissões", show: can("organization.admin") },
    ],
    secretary: [
      { href: "/secretaria/registrar", icon: <ClipboardPlus />, label: "Registrar reunião", show: can("meetings.create") },
      { href: "/documentos?novo=1", icon: <FilePlus2 />, label: "Adicionar documento", show: can("documents.create") },
    ],
    finance: [
      { href: "/financeiro/lancamentos?novo=income", icon: <PlusCircle />, label: "Nova receita", show: can("finance.register") },
      { href: "/financeiro/lancamentos?novo=expense", icon: <MinusCircle />, label: "Nova despesa", show: can("finance.register") },
      { href: "/financeiro/relatorios", icon: <FilePlus2 />, label: "Relatórios", show: can("finance.view") },
    ],
    marketing: [
      { href: "/marketing?novo=1", icon: <Megaphone />, label: "Novo conteúdo", show: can("marketing.create") },
      { href: "/marketing?visao=calendario", icon: <CalendarPlus />, label: "Calendário", show: can("marketing.view") },
    ],
    events: [
      { href: "/eventos?novo=1", icon: <CalendarPlus />, label: "Novo evento", show: can("events.create") },
      { href: "/campanhas/nova", icon: <Ticket />, label: "Nova rifa", show: can("campaigns.create") },
    ],
    extension: [
      { href: "/extensao?novo=1", icon: <GraduationCap />, label: "Novo projeto", show: can("extension.create") },
      { href: "/documentos?novo=1", icon: <FilePlus2 />, label: "Adicionar documento", show: can("documents.create") },
    ],
    advisor: [
      { href: "/campanhas", icon: <Ticket />, label: "Registrar venda", show: can("campaigns.register") },
      { href: "/eventos", icon: <CalendarPlus />, label: "Ver eventos", show: can("events.view") },
    ],
  }[preset];
  const visible = actions.filter((a) => a.show);
  return (
    <>
      {visible.map((a, i) => (
        <QuickAction key={a.href + a.label} href={a.href} icon={a.icon} label={a.label} primary={i === 0} />
      ))}
    </>
  );
}

export default function HomePage() {
  const access = useAccess();
  if (!access.user || !access.role) return null;
  const preset = access.role.homePreset;
  return (
    <>
      <PageHeader
        eyebrow={`${access.department?.name ?? "Atlética"} · ${formatLongDate(new Date())}`}
        title={`${greeting()}, ${firstName(access.user.name)}`}
        description={`${access.role.name}. Veja o que precisa da sua atenção hoje.`}
        actions={<QuickActions preset={preset} />}
      />
      <HomeContent preset={preset} />
    </>
  );
}

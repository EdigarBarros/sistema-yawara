"use client";

import { CalendarPlus, ClipboardPlus, FilePlus2, GraduationCap, KeyRound, Megaphone, MinusCircle, PlusCircle, Ticket, UserX } from "lucide-react";
import type { HomePreset } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { firstName, formatLongDate, greeting } from "@/lib/format";
import { PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
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
import { HeroCards } from "@/features/home/hero-cards";
import { Calendar3D } from "@/features/agenda/calendar-3d";
import { WeekStrip } from "@/features/agenda/week-strip";
import { PresidencyMobileHome } from "@/features/home/presidency-mobile";
import { PresidencyDesktopHome } from "@/features/home/presidency-desktop";
import { useIsDesktop } from "@/hooks/use-media";

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:[animation:rise_.5s_cubic-bezier(.2,1.2,.4,1)_.15s_both]">{children}</div>;
}

/** Conteúdo da página inicial para cada perfil. */
function HomeContent({ preset }: { preset: HomePreset }) {
  const access = useAccess();
  const can = access.can;
  const has = access.canModule;

  switch (preset) {
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
  const isDesktop = useIsDesktop();
  if (!access.user) return null;
  if (!access.role) {
    return (
      <EmptyState
        icon={<UserX />}
        title="Seu cargo não foi encontrado"
        description="O cargo associado à sua conta não está disponível. Procure a presidência para revisar o seu cadastro."
      />
    );
  }
  const preset = access.role.homePreset;
  // Celular da presidência: tela própria, simples e direta (o computador mantém o painel completo).
  if (preset === "presidency") return isDesktop ? <PresidencyDesktopHome actions={<QuickActions preset={preset} />} /> : <PresidencyMobileHome />;
  return (
    <>
      <PageHeader
        eyebrow={`${access.department?.name ?? "Atlética"} · ${formatLongDate(new Date())}`}
        title={`${greeting()}, ${firstName(access.user.name)}`}
        description={`${access.role.name}. Veja o que precisa da sua atenção hoje.`}
        actions={<QuickActions preset={preset} />}
      />
      <div className="mb-6 flex flex-col gap-6 lg:hidden">
        <HeroCards />
        <WeekStrip className="anim-rise" />
      </div>
      <Calendar3D className="mb-6 hidden lg:block" />
      <HomeContent preset={preset} />
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, ClipboardList, FileText, GraduationCap, Megaphone, Ticket, Trophy, Wallet } from "lucide-react";
import type { AppNotification } from "@/types";
import {
  useAllSales,
  useCampaigns,
  useContents,
  useDocuments,
  useDocumentCategories,
  useDirectory,
  useEvents,
  useFinanceEntries,
  useMeetings,
  useNotifications,
  useProjects,
  useSportsTeams,
} from "@/hooks/use-data";
import { useAccess } from "@/hooks/use-access";
import { useSession } from "@/stores/session";
import { summarize } from "@/lib/raffle";
import { summarizeFinance } from "@/features/finance/utils";
import { canSellIn, canSeeEventFinance } from "@/lib/policies";
import { formatDate, formatDayMonth, formatMoneyCompact, formatRelative, formatTime, todayDateOnly } from "@/lib/format";
import { CONTENT_STATUS, CONTENT_TYPE_LABELS, EVENT_STATUS, MEETING_STATUS, PROJECT_STATUS, TASK_STATUS, entryStatusMeta } from "@/lib/labels";
import { Panel, Stat } from "@/components/shared/page";
import { DateChip, ListRow } from "@/components/shared/list-row";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { Progress, Skeleton, Badge } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/mode";
import { errorMessage } from "@/lib/notify";

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

/** Falha ao carregar os dados de um painel: nunca aparece como "vazio". */
function PanelError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <ErrorState className="py-8" message={errorMessage(error)} onRetry={onRetry} />;
}

/** Rodapé de indicador quando a consulta falhou (o valor fica "—"). */
function StatError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <span role="alert" className="flex min-w-0 items-center gap-1.5 text-danger" title={errorMessage(error)}>
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">Não foi possível carregar.</span>
      <button type="button" onClick={onRetry} className="shrink-0 font-medium underline-offset-2 hover:underline">
        Tentar de novo
      </button>
    </span>
  );
}

/** Primeiro erro entre as consultas usadas por um widget, com a ação de repetir todas. */
function firstError(...queries: { isError: boolean; error: unknown; refetch: () => unknown }[]) {
  const failed = queries.find((q) => q.isError);
  return failed ? { error: failed.error, retry: () => queries.filter((q) => q.isError).forEach((q) => void q.refetch()) } : null;
}

function SeeAll({ href, label = "Ver tudo" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-gold-fg hover:underline">
      {label} <ArrowRight className="size-3.5" />
    </Link>
  );
}

/* ---------------------------------- Indicadores ---------------------------------- */

export function StatsRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function CampaignStats() {
  const campaignsQuery = useCampaigns();
  const salesQuery = useAllSales();
  const { data: campaigns } = campaignsQuery;
  const { data: sales } = salesQuery;
  const failed = firstError(campaignsQuery, salesQuery);
  const totals = useMemo(() => {
    const active = (campaigns ?? []).filter((c) => c.status === "active");
    let received = 0;
    let receivable = 0;
    for (const c of active) {
      const s = summarize(c, (sales ?? []).filter((x) => x.campaignId === c.id));
      received += s.receivedCents;
      receivable += s.receivableCents;
    }
    return { active: active.length, received, receivable };
  }, [campaigns, sales]);
  return (
    <>
      <Stat
        label="Campanhas ativas"
        value={campaigns && !campaignsQuery.isError ? totals.active : "—"}
        footer={campaignsQuery.isError ? <StatError error={campaignsQuery.error} onRetry={() => void campaignsQuery.refetch()} /> : <span>Rifas autorizadas para você</span>}
      />
      <Stat
        label="Recebido em rifas ativas"
        value={sales && !failed ? formatMoneyCompact(totals.received) : "—"}
        footer={failed ? <StatError error={failed.error} onRetry={failed.retry} /> : <span>{sales ? `${formatMoneyCompact(totals.receivable)} a receber` : "Carregando…"}</span>}
      />
    </>
  );
}

export function EventStats() {
  const { data, isError, error, refetch } = useEvents();
  const today = todayDateOnly();
  const upcoming = (data ?? []).filter((e) => e.date >= today && e.status !== "cancelled" && e.status !== "done");
  if (isError) return <Stat label="Próximos eventos" value="—" footer={<StatError error={error} onRetry={() => void refetch()} />} />;
  return <Stat label="Próximos eventos" value={data ? upcoming.length : "—"} footer={<span>{!data ? "Carregando…" : upcoming[0] ? `Próximo: ${formatDayMonth(upcoming.sort((a, b) => a.date.localeCompare(b.date))[0].date)}` : "Nenhum agendado"}</span>} />;
}

export function MeetingStats({ kinds = ["pending", "draft"] }: { kinds?: ("pending" | "draft" | "upcoming")[] }) {
  const { data, isError, error, refetch } = useMeetings();
  const today = todayDateOnly();
  const map = {
    pending: { label: "Atas aguardando aprovação", value: (data ?? []).filter((m) => m.status === "pending_approval").length, footer: "Precisam de aprovação" },
    draft: { label: "Atas em rascunho", value: (data ?? []).filter((m) => m.status === "draft" && m.date < today).length, footer: "Reuniões já realizadas" },
    upcoming: { label: "Próximas reuniões", value: (data ?? []).filter((m) => m.date >= today).length, footer: "Agendadas" },
  };
  return (
    <>
      {kinds.map((k) => (
        <Stat
          key={k}
          label={map[k].label}
          value={data && !isError ? map[k].value : "—"}
          footer={isError ? <StatError error={error} onRetry={() => void refetch()} /> : <span>{map[k].footer}</span>}
        />
      ))}
    </>
  );
}

/** No ambiente real, o saldo é o realizado (receitas recebidas − despesas pagas). */
const BALANCE_LABEL = isDemoMode ? "Saldo demonstrativo" : "Saldo realizado";

export function FinanceStats({ compact }: { compact?: boolean }) {
  const { data, isError, error, refetch } = useFinanceEntries();
  const s = summarizeFinance(data ?? []);
  const ok = !!data && !isError;
  const err = isError ? <StatError error={error} onRetry={() => void refetch()} /> : null;
  if (compact) {
    return <Stat label={BALANCE_LABEL} value={ok ? formatMoneyCompact(s.balance) : "—"} footer={err ?? <span>Receitas − despesas realizadas</span>} />;
  }
  return (
    <>
      <Stat label="Receitas recebidas" value={ok ? formatMoneyCompact(s.income) : "—"} footer={err ?? <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ok" />Valores confirmados</span>} />
      <Stat label="Despesas pagas" value={ok ? formatMoneyCompact(s.expense) : "—"} footer={err ?? <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-danger" />Valores confirmados</span>} />
      <Stat label={BALANCE_LABEL} value={ok ? formatMoneyCompact(s.balance) : "—"} footer={err ?? <span>Receitas − despesas</span>} />
      <Stat
        label="Pendentes"
        value={ok ? formatMoneyCompact(s.receivable) : "—"}
        suffix="a receber"
        footer={err ?? <span>{formatMoneyCompact(s.payable)} a pagar</span>}
      />
    </>
  );
}

export function DocumentStats() {
  const { data, isError, error, refetch } = useDocuments();
  return (
    <Stat
      label="Documentos vigentes"
      value={data && !isError ? data.filter((d) => d.status === "current").length : "—"}
      footer={isError ? <StatError error={error} onRetry={() => void refetch()} /> : <span>Na biblioteca institucional</span>}
    />
  );
}

export function MarketingStats() {
  const { data, isError, error, refetch } = useContents();
  const count = (s: keyof typeof CONTENT_STATUS) => (data && !isError ? (data ?? []).filter((c) => c.status === s).length : "—");
  const footer = (text: string) => (isError ? <StatError error={error} onRetry={() => void refetch()} /> : <span>{text}</span>);
  return (
    <>
      <Stat label="Briefings" value={count("briefing")} footer={footer("Aguardando produção")} />
      <Stat label="Em produção" value={count("production")} footer={footer("Sendo produzidos")} />
      <Stat label="Em revisão" value={count("review")} footer={footer("Precisam de aprovação")} />
      <Stat label="Aprovados" value={count("approved")} footer={footer("Prontos para publicar")} />
    </>
  );
}

export function TaskStats() {
  const { data, isError, error, refetch } = useEvents();
  const access = useAccess();
  const tasks = (data ?? []).filter((e) => e.status !== "done" && e.status !== "cancelled").flatMap((e) => e.tasks);
  const dep = tasks.filter((t) => t.departmentId === access.role?.departmentId);
  const ok = !!data && !isError;
  const err = isError ? <StatError error={error} onRetry={() => void refetch()} /> : null;
  return (
    <>
      <Stat label="Tarefas abertas do setor" value={ok ? dep.filter((t) => t.status !== "done").length : "—"} footer={err ?? <span>{access.department?.name}</span>} />
      <Stat label="Tarefas bloqueadas" value={ok ? tasks.filter((t) => t.status === "blocked").length : "—"} footer={err ?? <span>Em todos os eventos</span>} />
    </>
  );
}

export function ExtensionStats() {
  const { data, isError, error, refetch } = useProjects();
  const today = todayDateOnly();
  const list = data && !isError ? data : null;
  const footer = (text: string) => (isError ? <StatError error={error} onRetry={() => void refetch()} /> : <span>{text}</span>);
  return (
    <>
      <Stat label="Projetos em andamento" value={list ? list.filter((p) => p.status === "open" || p.status === "planning").length : "—"} footer={footer("Planejamento ou inscrições")} />
      <Stat label="Próximas atividades" value={list ? list.filter((p) => p.date >= today && p.status !== "cancelled").length : "—"} footer={footer("Agendadas")} />
      <Stat label="Certificados pendentes" value={list ? list.filter((p) => p.status === "done" && p.certificateStatus !== "issued").length : "—"} footer={footer("Atividades realizadas")} />
    </>
  );
}

/* ---------------------------------- Listas ---------------------------------- */

export function ActiveCampaignsPanel({ sellOnly, title = "Campanhas ativas" }: { sellOnly?: boolean; title?: string }) {
  const access = useAccess();
  const campaignsQuery = useCampaigns();
  const salesQuery = useAllSales();
  const { data: campaigns, isLoading } = campaignsQuery;
  const { data: sales } = salesQuery;
  const failed = firstError(campaignsQuery, salesQuery);
  const list = (campaigns ?? []).filter((c) => c.status === "active" && (!sellOnly || (access.ctx && canSellIn(access.ctx, c)))).slice(0, 5);
  return (
    <Panel title={title} description={sellOnly ? "Onde você pode registrar vendas" : undefined} actions={<SeeAll href="/campanhas" />} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton />
      ) : failed ? (
        <PanelError error={failed.error} onRetry={failed.retry} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<Ticket />} title="Nenhuma campanha ativa" description="Quando uma rifa for disponibilizada para você, ela aparecerá aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => {
            const s = summarize(c, (sales ?? []).filter((x) => x.campaignId === c.id));
            return (
              <li key={c.id}>
                <ListRow
                  href={`/campanhas/${c.id}`}
                  title={c.name}
                  subtitle={
                    <span className="flex items-center gap-3">
                      <Progress value={s.sold} max={s.total} className="w-24" label="Vendidos" />
                      <span className="tnum font-mono">
                        {s.sold}/{s.total}
                      </span>
                    </span>
                  }
                  trailing={<span className="tnum font-mono text-[12.5px] text-fg-muted">{formatMoneyCompact(s.receivedCents)}</span>}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function UpcomingEventsPanel({ limit = 5 }: { limit?: number }) {
  const { data, isLoading, isError, error, refetch } = useEvents();
  const today = todayDateOnly();
  const list = (data ?? [])
    .filter((e) => e.date >= today && e.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
  return (
    <Panel title="Próximos eventos" actions={<SeeAll href="/eventos" />} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<CalendarDays />} title="Sem eventos agendados" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((e) => {
            const done = e.tasks.filter((t) => t.status === "done").length;
            return (
              <li key={e.id}>
                <ListRow
                  href={`/eventos/${e.id}`}
                  leading={<DateChip date={e.date} />}
                  title={e.name}
                  subtitle={`${formatTime(e.time)} · ${e.location}${e.tasks.length ? ` · ${done}/${e.tasks.length} tarefas` : ""}`}
                  trailing={<StatusBadge meta={EVENT_STATUS[e.status]} className="hidden sm:inline-flex" />}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function RecentDocumentsPanel({ sharedOnly }: { sharedOnly?: boolean }) {
  const access = useAccess();
  const { data, isLoading, isError, error, refetch } = useDocuments();
  const { data: cats } = useDocumentCategories();
  const list = (data ?? [])
    .filter((d) => d.status !== "archived" && (!sharedOnly || access.ownership(d) === "shared"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  return (
    <Panel title={sharedOnly ? "Compartilhados com você" : "Documentos recentes"} actions={<SeeAll href="/documentos" />} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<FileText />} title="Nenhum documento recente" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((d) => (
            <li key={d.id}>
              <ListRow
                href={`/documentos/${d.id}`}
                leading={
                  <span className="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-fg-muted">
                    <FileText className="size-4" />
                  </span>
                }
                title={d.name}
                subtitle={`${cats?.find((c) => c.id === d.categoryId)?.name ?? "Documento"} · ${formatRelative(d.updatedAt)}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function MeetingsPanel({ mode }: { mode: "upcoming" | "pending" }) {
  const { data, isLoading, isError, error, refetch } = useMeetings();
  const today = todayDateOnly();
  const list =
    mode === "upcoming"
      ? (data ?? []).filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date))
      : (data ?? []).filter((m) => m.status === "pending_approval" || (m.status === "draft" && m.date < today)).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Panel
      title={mode === "upcoming" ? "Próximas reuniões" : "Atas que precisam de atenção"}
      actions={<SeeAll href="/secretaria" />}
      bodyClassName="py-1.5"
    >
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<ClipboardList />} title={mode === "upcoming" ? "Nenhuma reunião agendada" : "Tudo em dia"} />
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 5).map((m) => (
            <li key={m.id}>
              <ListRow
                href={`/secretaria/${m.id}`}
                leading={<DateChip date={m.date} />}
                title={m.title}
                subtitle={`${formatTime(m.startTime)} · ${m.participantIds.length} participantes`}
                trailing={<StatusBadge meta={MEETING_STATUS[m.status]} className="hidden sm:inline-flex" />}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RecentEntriesPanel() {
  const { data, isLoading, isError, error, refetch } = useFinanceEntries();
  const list = (data ?? []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return (
    <Panel
      title="Lançamentos recentes"
      description={isDemoMode ? "Valores fictícios de demonstração" : "Últimos registros de receitas e despesas"}
      actions={<SeeAll href="/financeiro/lancamentos" />}
      bodyClassName="py-1.5"
    >
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<Wallet />} title="Nenhum lançamento registrado" description="Receitas e despesas registradas aparecem aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((e) => (
            <li key={e.id}>
              <ListRow
                href={`/financeiro/lancamentos?id=${e.id}`}
                title={e.description}
                subtitle={`${formatDate(e.date)} · ${entryStatusMeta(e.type, e.status).label}`}
                trailing={
                  <span className={cn("tnum font-mono text-[13px] font-semibold", e.type === "income" ? "text-ok" : "text-fg")}>
                    {e.type === "income" ? "+" : "−"} {formatMoneyCompact(e.amount)}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function CampaignCollectionPanel() {
  const campaignsQuery = useCampaigns();
  const salesQuery = useAllSales();
  const { data: campaigns, isLoading } = campaignsQuery;
  const { data: sales } = salesQuery;
  const failed = firstError(campaignsQuery, salesQuery);
  const list = (campaigns ?? []).filter((c) => c.status === "active");
  return (
    <Panel title="Arrecadação das campanhas" description="Pagos e pendentes por rifa" actions={<SeeAll href="/campanhas" />} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton />
      ) : failed ? (
        <PanelError error={failed.error} onRetry={failed.retry} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<Ticket />} title="Nenhuma campanha ativa" description="A arrecadação das rifas ativas aparece aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => {
            const s = summarize(c, (sales ?? []).filter((x) => x.campaignId === c.id));
            return (
              <li key={c.id}>
                <ListRow
                  href={`/campanhas/${c.id}`}
                  title={c.name}
                  subtitle={`${s.paid} pagos · ${s.pending} pendentes`}
                  trailing={
                    <span className="block leading-tight">
                      <span className="tnum block font-mono text-[13px] font-semibold text-ok">{formatMoneyCompact(s.receivedCents)}</span>
                      <span className="tnum block font-mono text-[11.5px] text-warn">{formatMoneyCompact(s.receivableCents)} a receber</span>
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function UpcomingContentPanel() {
  const { data, isLoading, isError, error, refetch } = useContents();
  const today = todayDateOnly();
  const list = (data ?? [])
    .filter((c) => c.publishDate && c.publishDate >= today && c.status !== "cancelled" && c.status !== "published")
    .sort((a, b) => (a.publishDate ?? "").localeCompare(b.publishDate ?? ""))
    .slice(0, 6);
  return (
    <Panel title="Próximas publicações" actions={<SeeAll href="/marketing?visao=calendario" label="Calendário" />} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<Megaphone />} title="Nada agendado" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => (
            <li key={c.id}>
              <ListRow
                href={`/marketing?item=${c.id}`}
                leading={<DateChip date={c.publishDate!} />}
                title={c.title}
                subtitle={CONTENT_TYPE_LABELS[c.type]}
                trailing={<StatusBadge meta={CONTENT_STATUS[c.status]} />}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function TasksPanel({ mine }: { mine?: boolean }) {
  const access = useAccess();
  const dir = useDirectory();
  const { data, isLoading, isError, error, refetch } = useEvents();
  const rows = (data ?? [])
    .filter((e) => e.status !== "done" && e.status !== "cancelled")
    .flatMap((e) => e.tasks.map((t) => ({ ...t, event: e })))
    .filter((t) => t.status !== "done")
    .filter((t) => (mine ? t.responsibleId === access.user?.id : t.departmentId === access.role?.departmentId))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 6);
  return (
    <Panel
      title={mine ? "Tarefas atribuídas a você" : `Tarefas de ${access.department?.name ?? "seu setor"}`}
      description="Ordenadas pelo prazo"
      actions={<SeeAll href="/eventos" />}
      bodyClassName="py-1.5"
    >
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState compact title="Nenhuma tarefa pendente" description="Tarefas atribuídas nos eventos aparecem aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((t) => (
            <li key={t.id}>
              <ListRow
                href={`/eventos/${t.event.id}?aba=tarefas`}
                title={t.title}
                subtitle={`${t.event.name}${t.dueDate ? ` · prazo ${formatDate(t.dueDate)}` : ""}${!mine && t.responsibleId ? ` · ${dir.memberName(t.responsibleId)}` : ""}`}
                trailing={<StatusBadge meta={TASK_STATUS[t.status]} />}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ProjectsPanel() {
  const { data, isLoading, isError, error, refetch } = useProjects();
  const today = todayDateOnly();
  const list = (data ?? []).filter((p) => p.date >= today && p.status !== "cancelled").sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  return (
    <Panel title="Próximas atividades acadêmicas" actions={<SeeAll href="/extensao" />} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<GraduationCap />} title="Nenhuma atividade agendada" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((p) => (
            <li key={p.id}>
              <ListRow
                href={`/extensao/${p.id}`}
                leading={<DateChip date={p.date} />}
                title={p.name}
                subtitle={`${p.location} · ${p.speakers.length} palestrante(s)`}
                trailing={<StatusBadge meta={PROJECT_STATUS[p.status]} className="hidden sm:inline-flex" />}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function NoticesPanel() {
  const userId = useSession((s) => s.userId) ?? "";
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const list: AppNotification[] = (data ?? []).slice(0, 4);
  return (
    <Panel title="Avisos" description={isDemoMode ? "Notificações internas da demonstração" : "Notificações internas da Central"} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton rows={3} />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact title="Sem avisos" description="Quando algo for compartilhado com você, aparecerá aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((n) => (
            <li key={n.id}>
              <ListRow
                href={n.href}
                title={
                  <span className="flex items-center gap-2">
                    {!n.readBy.includes(userId) && <span className="size-1.5 shrink-0 rounded-full bg-gold" aria-label="Não lida" />}
                    {n.title}
                  </span>
                }
                subtitle={`${n.body} · ${formatRelative(n.createdAt)}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function EventBudgetHint() {
  const access = useAccess();
  const { data } = useEvents();
  const next = (data ?? []).filter((e) => e.date >= todayDateOnly() && e.budget).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next || !access.ctx || !canSeeEventFinance(access.ctx, next)) return null;
  return (
    <Badge tone="gold">
      Orçamento de {next.name}: {formatMoneyCompact(next.budget!)}
    </Badge>
  );
}

export function QuickAction({ href, icon, label, primary }: { href: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <ButtonLink href={href} variant={primary ? "primary" : "secondary"}>
      {icon}
      {label}
    </ButtonLink>
  );
}


/* --------------------------------- Esportes --------------------------------- */

export function SportsStats() {
  const { data, isError, error, refetch } = useSportsTeams();
  const today = todayDateOnly();
  const list = data && !isError ? data.filter((t) => t.status !== "archived") : null;
  const footer = (text: string) => (isError ? <StatError error={error} onRetry={() => void refetch()} /> : <span>{text}</span>);
  const upcoming = list ? list.flatMap((t) => t.matches.filter((m) => m.status === "scheduled" && m.date >= today)) : null;
  return (
    <>
      <Stat label="Modalidades em atividade" value={list ? list.filter((t) => t.status === "active").length : "—"} footer={footer(list ? `${list.filter((t) => t.status === "paused").length} pausada(s)` : "")} />
      <Stat label="Próximos jogos" value={upcoming ? upcoming.length : "—"} footer={footer("Agendados")} />
      <Stat label="Atletas no elenco" value={list ? list.reduce((n, t) => n + t.athletes.length, 0) : "—"} footer={footer("Somando as modalidades")} />
    </>
  );
}

export function SportsPanel() {
  const { data, isLoading, isError, error, refetch } = useSportsTeams();
  const today = todayDateOnly();
  const list = (data ?? [])
    .filter((t) => t.status !== "archived")
    .flatMap((t) => t.matches.filter((m) => m.status === "scheduled" && m.date >= today).map((m) => ({ team: t, match: m })))
    .sort((a, b) => a.match.date.localeCompare(b.match.date) || (a.match.time ?? "").localeCompare(b.match.time ?? ""))
    .slice(0, 5);
  return (
    <Panel title="Próximos jogos" actions={<SeeAll href="/esportes" />} bodyClassName="py-1.5">
      {isLoading ? (
        <PanelSkeleton />
      ) : isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={<Trophy />} title="Nenhum jogo agendado" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map(({ team, match }) => (
            <li key={match.id}>
              <ListRow
                href={`/esportes/${team.id}?aba=jogos`}
                leading={<DateChip date={match.date} />}
                title={`${team.name} × ${match.opponent}`}
                subtitle={`${match.time ? `${formatTime(match.time)} · ` : ""}${match.location}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

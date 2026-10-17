"use client";

import { MemberAvatar } from "@/components/shared/member-avatar";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, FilePlus2, FileText, Megaphone, Plus, Trash2, Wallet } from "lucide-react";
import type { AtleticaEvent, EventTask, Supplier, TaskStatus } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import {
  useCampaigns,
  useContents,
  useDirectory,
  useDocumentCategories,
  useDocuments,
  useEventFinance,
  useFinanceCategories,
  useMeetings,
  useProjects,
} from "@/hooks/use-data";
import { canEditTasks, canEditEvent, canSeeEventFinance } from "@/lib/policies";
import {
  CAMPAIGN_STATUS,
  CONTENT_STATUS,
  CONTENT_TYPE_LABELS,
  DOCUMENT_STATUS,
  MEETING_STATUS,
  PROJECT_STATUS,
  SUPPLIER_STATUS,
  TASK_STATUS,
  entryStatusMeta,
} from "@/lib/labels";
import { formatDate, formatMoney, formatRelative, formatTime, todayDateOnly } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { summarizeFinance } from "@/features/finance/utils";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Progress } from "@/components/ui/misc";
import { DetailList, Panel, Stat } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, FilterSelect } from "@/components/shared/filters";
import { StatusBadge } from "@/components/shared/badges";
import { EmptyState, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { AudienceSummary } from "@/components/shared/audience";
import { ListRow } from "@/components/shared/list-row";
import { confirmAction } from "@/components/shared/confirm";
import { AddDocumentDialog } from "@/features/documents/document-form-dialog";
import { EVENT_TYPE_LABELS, EVENT_STATUS } from "@/lib/labels";
import { TaskDialog } from "./event-dialogs";

/* ------------------------------- Visão geral ------------------------------- */

export function OverviewTab({ event }: { event: AtleticaEvent }) {
  const dir = useDirectory();
  const done = event.tasks.filter((t) => t.status === "done").length;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Panel title="Sobre o evento">
          {event.description && <p className="text-[13.5px] leading-relaxed text-fg-muted">{event.description}</p>}
          {event.objective && (
            <div className="mt-4 rounded-lg border border-line bg-sunken px-4 py-3">
              <p className="eyebrow mb-1.5">Objetivo</p>
              <p className="text-[13.5px]">{event.objective}</p>
            </div>
          )}
          <DetailList
            className="mt-4"
            items={[
              { label: "Tipo", value: EVENT_TYPE_LABELS[event.type] },
              { label: "Data", value: `${formatDate(event.date)} (${formatRelative(event.date)})` },
              { label: "Horário", value: formatTime(event.time) },
              { label: "Local", value: event.location },
              { label: "Departamento responsável", value: dir.department(event.departmentId)?.name ?? "—" },
              { label: "Situação", value: <StatusBadge meta={EVENT_STATUS[event.status]} /> },
              { label: "Identificador", value: <span className="font-mono">{event.code}</span> },
              { label: "Criado por", value: `${dir.memberName(event.createdBy)} em ${formatDate(event.createdAt)}` },
            ]}
          />
          {event.notes && <p className="mt-4 rounded-lg border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] text-fg-muted">{event.notes}</p>}
        </Panel>
        <RelatedPanel event={event} />
      </div>
      <div className="space-y-4">
        <Panel title="Responsáveis" bodyClassName="py-1.5">
          <ul className="divide-y divide-line">
            {event.responsibleIds.map((id) => (
              <li key={id} className="flex items-center gap-3 px-5 py-2.5">
                <MemberAvatar name={dir.memberName(id)} id={id} size={30} />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{dir.memberName(id)}</p>
                  <p className="truncate text-[12px] text-fg-subtle">{dir.roleOf(id)?.name}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Andamento das tarefas">
          <Progress value={done} max={Math.max(1, event.tasks.length)} label="Tarefas concluídas" />
          <p className="mt-2 text-[13px] text-fg-muted">
            {done} de {event.tasks.length} tarefas concluídas
          </p>
        </Panel>
        <Panel title="Quem tem acesso">
          <AudienceSummary module="events" audience={event.access} departmentId={event.departmentId} alwaysIncluded={[...event.responsibleIds, event.createdBy]} />
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------- Relacionados ------------------------------ */

interface RelatedQuery<T> {
  data?: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** Um grupo do painel "Relacionados": carregando, erro (com nova tentativa), vazio ou lista. */
function RelatedGroup<T extends { id: string; eventId?: string }>({
  label,
  eventId,
  query,
  row,
}: {
  label: string;
  eventId: string;
  query: RelatedQuery<T>;
  row: (item: T) => ReactNode;
}) {
  const items = (query.data ?? []).filter((item) => item.eventId === eventId);
  return (
    <div className="px-5 py-3">
      <p className="eyebrow mb-1">{label}</p>
      {query.isLoading ? (
        <p role="status" className="text-[12.5px] text-fg-subtle">
          Carregando…
        </p>
      ) : query.isError ? (
        <div role="alert" className="text-[12.5px] text-danger">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>Não foi possível carregar. {errorMessage(query.error)}</span>
          </p>
          <button type="button" onClick={() => query.refetch()} className="mt-1 font-medium text-fg-muted underline hover:text-fg">
            Tentar novamente
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-fg-subtle">Nenhum registro vinculado.</p>
      ) : (
        <ul className="-mx-5 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id}>{row(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RelatedCampaigns({ eventId }: { eventId: string }) {
  const query = useCampaigns();
  return (
    <RelatedGroup
      label="Campanhas"
      eventId={eventId}
      query={query}
      row={(c) => <ListRow href={`/campanhas/${c.id}`} title={c.name} subtitle={c.code} trailing={<StatusBadge meta={CAMPAIGN_STATUS[c.status]} />} />}
    />
  );
}

function RelatedMeetings({ eventId }: { eventId: string }) {
  const query = useMeetings(true);
  return (
    <RelatedGroup
      label="Reuniões"
      eventId={eventId}
      query={query}
      row={(m) => <ListRow href={`/secretaria/${m.id}`} title={m.title} subtitle={`${m.code} · ${formatDate(m.date)}`} trailing={<StatusBadge meta={MEETING_STATUS[m.status]} />} />}
    />
  );
}

function RelatedContents({ eventId }: { eventId: string }) {
  const query = useContents(true);
  return (
    <RelatedGroup
      label="Conteúdos de Marketing"
      eventId={eventId}
      query={query}
      row={(c) => (
        <ListRow
          href={`/marketing?item=${c.id}`}
          title={c.title}
          subtitle={`${CONTENT_TYPE_LABELS[c.type]}${c.publishDate ? ` · ${formatDate(c.publishDate)}` : ""}`}
          trailing={<StatusBadge meta={CONTENT_STATUS[c.status]} />}
        />
      )}
    />
  );
}

function RelatedProjects({ eventId }: { eventId: string }) {
  const query = useProjects(true);
  return (
    <RelatedGroup
      label="Projetos de extensão"
      eventId={eventId}
      query={query}
      row={(p) => <ListRow href={`/extensao/${p.id}`} title={p.name} subtitle={`${p.code} · ${formatDate(p.date)}`} trailing={<StatusBadge meta={PROJECT_STATUS[p.status]} />} />}
    />
  );
}

/**
 * Campanhas, reuniões, conteúdos e projetos ligados ao evento. Cada grupo só
 * aparece (e só é consultado) quando o perfil acessa o módulo; a lista mostra
 * apenas os registros que o perfil pode ver.
 */
export function RelatedPanel({ event }: { event: AtleticaEvent }) {
  const access = useAccess();
  const groups = [
    access.canModule("campaigns") && <RelatedCampaigns key="campaigns" eventId={event.id} />,
    access.canModule("meetings") && <RelatedMeetings key="meetings" eventId={event.id} />,
    access.canModule("marketing") && <RelatedContents key="marketing" eventId={event.id} />,
    access.canModule("extension") && <RelatedProjects key="extension" eventId={event.id} />,
  ].filter(Boolean);
  if (groups.length === 0) return null;
  return (
    <Panel title="Relacionados" description="Registros ligados a este evento que o seu perfil pode ver" bodyClassName="divide-y divide-line">
      {groups}
    </Panel>
  );
}

/* -------------------------- Programação e tarefas -------------------------- */

function ScheduleSection({ event, editable }: { event: AtleticaEvent; editable: boolean }) {
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string>();
  const add = useAction(() => services.events.addScheduleItem(event.id, { time, title }), { success: "Item adicionado à programação" });
  const remove = useAction((itemId: string) => services.events.removeScheduleItem(event.id, itemId), { success: "Item removido da programação" });
  return (
    <Panel title="Programação" description="Cronograma do dia do evento">
      {event.schedule.length === 0 ? (
        <p className="text-[13px] text-fg-subtle">Nenhum item na programação.</p>
      ) : (
        <ol className="space-y-2">
          {event.schedule.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-sunken px-3 py-2">
              <span className="tnum w-14 shrink-0 font-mono text-[13px] font-semibold text-gold-fg">{formatTime(s.time)}</span>
              <span className="min-w-0 flex-1 text-[13.5px]">{s.title}</span>
              {editable && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remover ${s.title}`}
                  onClick={async () => {
                    if (await confirmAction({ title: "Remover item da programação?", description: `“${s.title}” às ${formatTime(s.time)}.`, confirmLabel: "Remover", tone: "danger" }))
                      remove.runSafe(s.id);
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {editable && (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!time || title.trim().length < 2) return setError("Informe horário e atividade.");
            setError(undefined);
            const r = await add.runSafe();
            if (r) {
              setTime("");
              setTitle("");
            }
          }}
        >
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Horário" className="sm:w-32" />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Atividade" aria-label="Atividade" />
          <Button type="submit" loading={add.pending}>
            <Plus /> Adicionar
          </Button>
        </form>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </Panel>
  );
}

function SuppliersSection({ event, editable }: { event: AtleticaEvent; editable: boolean }) {
  const [name, setName] = useState("");
  const [service, setService] = useState("");
  const add = useAction(() => services.events.addSupplier(event.id, { name, service, status: "quoted" }), { success: "Fornecedor adicionado" });
  const update = useAction((id: string, status: Supplier["status"]) => services.events.updateSupplier(event.id, id, { status }), { success: "Fornecedor atualizado" });
  return (
    <Panel title="Fornecedores" description={isDemoMode ? "Contatos de exemplo — nenhum contrato real" : "Orçamentos e contratações do evento"}>
      {event.suppliers.length === 0 ? (
        <p className="text-[13px] text-fg-subtle">Nenhum fornecedor registrado.</p>
      ) : (
        <ul className="divide-y divide-line">
          {event.suppliers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{s.name}</p>
                <p className="text-[12px] text-fg-subtle">
                  {s.service}
                  {s.contact && ` · ${s.contact}`}
                </p>
              </div>
              {editable ? (
                <select
                  aria-label={`Situação de ${s.name}`}
                  value={s.status}
                  onChange={(e) => update.runSafe(s.id, e.target.value as Supplier["status"])}
                  className="h-8 rounded-md border border-line-strong bg-sunken px-2 text-[12.5px]"
                >
                  {Object.entries(SUPPLIER_STATUS).map(([v, m]) => (
                    <option key={v} value={v}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusBadge meta={SUPPLIER_STATUS[s.status]} />
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await add.runSafe();
            if (r) {
              setName("");
              setService("");
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do fornecedor" aria-label="Nome do fornecedor" />
          <Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Serviço" aria-label="Serviço" />
          <Button type="submit" loading={add.pending} disabled={!name.trim() || !service.trim()}>
            <Plus /> Adicionar
          </Button>
        </form>
      )}
    </Panel>
  );
}

export function TasksTab({ event }: { event: AtleticaEvent }) {
  const access = useAccess();
  const dir = useDirectory();
  const ctx = access.ctx;
  const editable = !!ctx && canEditTasks(ctx, event) && event.status !== "cancelled";
  const manage = !!ctx && canEditEvent(ctx, event) && event.status !== "cancelled";
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const [dep, setDep] = useState("");
  const [dialog, setDialog] = useState<{ task?: EventTask } | null>(null);
  const setStatus = useAction((taskId: string, status: TaskStatus) => services.events.updateTask(event.id, taskId, { status }), {
    success: (t) => `“${t.title}”: ${TASK_STATUS[t.status].label}`,
  });
  const today = todayDateOnly();
  const rows = event.tasks.filter((t) => (filter === "all" || t.status === filter) && (!dep || t.departmentId === dep));
  const count = (f: "all" | TaskStatus) => (f === "all" ? event.tasks.length : event.tasks.filter((t) => t.status === f).length);

  const columns: Column<EventTask>[] = [
    {
      key: "title",
      header: "Tarefa",
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-medium">{t.title}</p>
          {t.description && <p className="line-clamp-1 text-[12px] text-fg-subtle">{t.description}</p>}
        </div>
      ),
    },
    { key: "resp", header: "Responsável", hideBelow: "lg", cell: (t) => <span className="text-fg-muted">{t.responsibleId ? dir.memberName(t.responsibleId) : "—"}</span> },
    { key: "dep", header: "Departamento", hideBelow: "xl", cell: (t) => <span className="text-fg-muted">{dir.department(t.departmentId)?.name}</span> },
    {
      key: "due",
      header: "Prazo",
      cell: (t) => (
        <span className={cn("tnum font-mono text-[12.5px]", t.dueDate && t.dueDate < today && t.status !== "done" ? "text-danger" : "text-fg-muted")}>
          {t.dueDate ? formatDate(t.dueDate) : "—"}
          {t.dueDate && t.dueDate < today && t.status !== "done" && <span className="sr-only"> (atrasada)</span>}
        </span>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (t) =>
        editable || (t.responsibleId === access.user?.id && event.status !== "cancelled") ? (
          <select
            aria-label={`Situação de ${t.title}`}
            value={t.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setStatus.runSafe(t.id, e.target.value as TaskStatus)}
            className="h-8 rounded-md border border-line-strong bg-sunken px-2 text-[12.5px]"
          >
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS[s].label}
              </option>
            ))}
          </select>
        ) : (
          <StatusBadge meta={TASK_STATUS[t.status]} />
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ScheduleSection event={event} editable={editable} />
        <SuppliersSection event={event} editable={manage} />
      </div>
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-[14.5px] font-semibold">Tarefas</h2>
            <p className="text-[12.5px] text-fg-muted">Organização do trabalho — sem ranking ou avaliação individual.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Departamento" value={dep} onChange={setDep} options={[{ value: "", label: "Todos os departamentos" }, ...dir.departments.map((d) => ({ value: d.id, label: d.name }))]} />
            {editable && (
              <Button variant="primary" onClick={() => setDialog({})}>
                <Plus /> Nova tarefa
              </Button>
            )}
          </div>
        </div>
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <FilterChips
            ariaLabel="Filtrar tarefas"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Todas", count: count("all") },
              { value: "todo", label: "A fazer", count: count("todo") },
              { value: "doing", label: "Em andamento", count: count("doing") },
              { value: "blocked", label: "Bloqueadas", count: count("blocked") },
              { value: "done", label: "Concluídas", count: count("done") },
            ]}
          />
        </div>
        <DataTable
          caption="Tarefas do evento"
          rows={rows}
          columns={columns}
          getRowId={(t) => t.id}
          onRowClick={editable ? (t) => setDialog({ task: t }) : undefined}
          mobileCard={(t) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{t.title}</p>
                <p className="text-[12px] text-fg-subtle">
                  {t.responsibleId ? dir.memberName(t.responsibleId) : "Sem responsável"} · {t.dueDate ? formatDate(t.dueDate) : "sem prazo"}
                </p>
              </div>
              <StatusBadge meta={TASK_STATUS[t.status]} />
            </div>
          )}
          empty={<EmptyState compact title="Nenhuma tarefa neste filtro" description={editable ? "Adicione tarefas para organizar o evento." : undefined} />}
        />
      </section>
      {dialog && <TaskDialog open onOpenChange={(o) => !o && setDialog(null)} event={event} task={dialog.task} />}
    </div>
  );
}

/* -------------------------------- Financeiro -------------------------------- */

export function FinanceTab({ event }: { event: AtleticaEvent }) {
  const access = useAccess();
  const dir = useDirectory();
  const allowed = !!access.ctx && canSeeEventFinance(access.ctx, event) && access.moduleEnabled("finance");
  const { data, isLoading, isError, error } = useEventFinance(event.id, allowed);
  const { data: cats } = useFinanceCategories();
  if (!allowed) return <RestrictedState module="finance" title="Dados financeiros restritos" description="O Financeiro e a diretoria do departamento responsável veem esta aba." />;
  if (isLoading) return <InlineLoader />;
  if (isError) return <ErrorState message={errorMessage(error)} />;
  const s = summarizeFinance(data ?? []);
  const plannedExpense = s.expense + s.payable;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orçamento previsto" value={event.budget ? formatMoney(event.budget) : "—"} footer={<span>Definido no planejamento</span>} />
        <Stat label="Despesas previstas" value={formatMoney(plannedExpense)} footer={<span>{formatMoney(s.payable)} a pagar</span>}>
          {event.budget ? <Progress value={plannedExpense} max={event.budget} className="mb-2.5" label="Uso do orçamento" /> : null}
        </Stat>
        <Stat label="Receitas" value={formatMoney(s.income)} footer={<span>{formatMoney(s.receivable)} a receber</span>} />
        <Stat label="Resultado realizado" value={formatMoney(s.balance)} footer={<span>Receitas − despesas pagas</span>} />
      </div>
      <Panel title="Lançamentos do evento" description={isDemoMode ? "Valores fictícios de demonstração" : "Lançamentos do Financeiro vinculados a este evento"} bodyClassName="py-1.5">
        {(data ?? []).length === 0 ? (
          <EmptyState compact icon={<Wallet />} title="Sem lançamentos vinculados" description="Lançamentos do Financeiro associados a este evento aparecem aqui." />
        ) : (
          <ul className="divide-y divide-line">
            {data!.map((e) => (
              <li key={e.id}>
                <ListRow
                  href={access.can("finance.view") ? `/financeiro/lancamentos?id=${e.id}` : undefined}
                  title={e.description}
                  subtitle={`${formatDate(e.date)} · ${cats?.find((c) => c.id === e.categoryId)?.name ?? ""} · ${dir.memberName(e.responsibleId)} · ${entryStatusMeta(e.type, e.status).label}`}
                  trailing={
                    <span className={cn("tnum font-mono text-[13px] font-semibold", e.type === "income" ? "text-ok" : "", e.status === "cancelled" && "line-through opacity-60")}>
                      {e.type === "income" ? "+" : "−"} {formatMoney(e.amount)}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------- Divulgação -------------------------------- */

export function PublicityTab({ event }: { event: AtleticaEvent }) {
  const access = useAccess();
  const allowed = access.canModule("marketing");
  const { data, isLoading, isError, error, refetch } = useContents(allowed);
  if (!allowed) return <RestrictedState module="marketing" title="Divulgação fica no Marketing" description="Seu perfil não acessa o módulo de Marketing." />;
  const items = (data ?? []).filter((c) => c.eventId === event.id).sort((a, b) => (a.publishDate ?? "").localeCompare(b.publishDate ?? ""));
  return (
    <Panel
      title="Materiais de divulgação"
      description="Briefings, artes, vídeos e datas de publicação ligados a este evento"
      actions={
        access.can("marketing.create") && (
          <Link href="/marketing?novo=1" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gold-fg hover:underline">
            <Plus className="size-4" /> Novo conteúdo
          </Link>
        )
      }
      bodyClassName="py-1.5"
    >
      {isLoading ? (
        <InlineLoader />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState compact icon={<Megaphone />} title="Nenhum material vinculado" />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.id}>
              <ListRow
                href={`/marketing?item=${c.id}`}
                leading={<CalendarClock className="size-4 text-fg-subtle" />}
                title={c.title}
                subtitle={`${CONTENT_TYPE_LABELS[c.type]} · ${c.publishDate ? `publicação ${formatDate(c.publishDate)}` : "sem data"}`}
                trailing={<StatusBadge meta={CONTENT_STATUS[c.status]} />}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------- Documentos -------------------------------- */

export function DocumentsTab({ event }: { event: AtleticaEvent }) {
  const access = useAccess();
  const allowed = access.canModule("documents");
  const { data, isLoading, isError, error, refetch } = useDocuments(allowed);
  const { data: cats } = useDocumentCategories();
  const [open, setOpen] = useState(false);
  if (!allowed) return <RestrictedState module="documents" title="Documentos restritos" description="Seu perfil não acessa o módulo de Documentos." />;
  const docs = (data ?? []).filter((d) => d.links.eventId === event.id);
  return (
    <>
      <Panel
        title="Documentos do evento"
        description="Somente os documentos que o seu perfil pode ver"
        actions={
          access.can("documents.create") && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <FilePlus2 /> Adicionar documento
            </Button>
          )
        }
        bodyClassName="py-1.5"
      >
        {isLoading ? (
          <InlineLoader />
        ) : isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : docs.length === 0 ? (
          <EmptyState compact icon={<FileText />} title="Nenhum documento vinculado" />
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id}>
                <ListRow
                  href={`/documentos/${d.id}`}
                  leading={<FileText className="size-4 text-fg-subtle" />}
                  title={d.name}
                  subtitle={`${cats?.find((c) => c.id === d.categoryId)?.name} · v${d.versions.length} · ${formatRelative(d.updatedAt)}`}
                  trailing={<StatusBadge meta={DOCUMENT_STATUS[d.status]} />}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <AddDocumentDialog open={open} onOpenChange={setOpen} links={{ eventId: event.id }} stay />
    </>
  );
}


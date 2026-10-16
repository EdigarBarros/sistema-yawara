"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarPlus, Copy, MoreHorizontal } from "lucide-react";
import type { AtleticaEvent, EventType } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useEvents } from "@/hooks/use-data";
import { EVENT_STATUS, EVENT_TYPE_LABELS } from "@/lib/labels";
import { formatTime, todayDateOnly } from "@/lib/format";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { PageHeader } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { DateChip } from "@/components/shared/list-row";
import { describeAudience } from "@/components/shared/audience";
import { EventFormDialog } from "@/features/events/event-form-dialog";
import { DuplicateEventDialog } from "@/features/events/event-dialogs";

type Filter = "upcoming" | "planning" | "past" | "all";

export default function EventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("events");
  const { data, isLoading, isError, error, refetch } = useEvents(enabled);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [type, setType] = useState("");
  const [dep, setDep] = useState("");
  const [query, setQuery] = useState("");
  const [duplicate, setDuplicate] = useState<AtleticaEvent | null>(null);
  const createOpen = params.get("novo") === "1" && access.can("events.create");
  const setCreateOpen = (open: boolean) => router.replace(open ? `${pathname}?novo=1` : pathname, { scroll: false });

  const today = todayDateOnly();
  const tests: Record<Filter, (e: AtleticaEvent) => boolean> = {
    upcoming: (e) => e.date >= today && e.status !== "cancelled" && e.status !== "done",
    planning: (e) => e.status === "planning",
    past: (e) => e.date < today || e.status === "done",
    all: () => true,
  };
  const rows = (data ?? [])
    .filter(tests[filter])
    .filter((e) => !type || e.type === type)
    .filter((e) => !dep || e.departmentId === dep)
    .filter((e) => matchesQuery(query, e.name, e.location, e.code, dir.memberName(e.createdBy)))
    .sort((a, b) => (filter === "past" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const count = (f: Filter) => (data ?? []).filter(tests[f]).length;

  if (!enabled)
    return (
      <RestrictedState
        description={
          access.moduleEnabled("events")
            ? isDemoMode
              ? undefined
              : "Seu perfil não tem acesso aos eventos. Procure a diretoria se precisar."
            : "O módulo de eventos está desativado nas configurações."
        }
      />
    );

  const columns: Column<AtleticaEvent>[] = [
    {
      key: "name",
      header: "Evento",
      cell: (e) => (
        <div className="flex items-center gap-3">
          <DateChip date={e.date} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{e.name}</p>
            <p className="truncate text-[12px] text-fg-subtle">
              {EVENT_TYPE_LABELS[e.type]} · {formatTime(e.time)}
            </p>
          </div>
        </div>
      ),
    },
    { key: "location", header: "Local", hideBelow: "xl", cell: (e) => <span className="line-clamp-2 text-[12.5px] text-fg-muted">{e.location}</span> },
    {
      key: "dep",
      header: "Responsável",
      hideBelow: "lg",
      cell: (e) => (
        <div className="text-[12.5px]">
          <p>{dir.department(e.departmentId)?.name}</p>
          <p className="text-fg-subtle">Criado por {dir.memberName(e.createdBy)}</p>
        </div>
      ),
    },
    { key: "access", header: "Pessoas autorizadas", hideBelow: "xl", cell: (e) => <span className="line-clamp-2 text-[12.5px] text-fg-muted">{describeAudience(e.access, dir)}</span> },
    { key: "status", header: "Situação", cell: (e) => <StatusBadge meta={EVENT_STATUS[e.status]} /> },
    { key: "origin", header: "Origem", hideBelow: "lg", cell: (e) => <OwnershipBadge record={e} /> },
    {
      key: "actions",
      header: <span className="sr-only">Ações</span>,
      align: "right",
      cell: (e) =>
        access.can("events.create") ? (
          <div onClick={(ev) => ev.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={`Ações de ${e.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem icon={<CalendarDays />} onSelect={() => router.push(`/eventos/${e.id}`)}>
                  Abrir evento
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Copy />} onSelect={() => setDuplicate(e)}>
                  Duplicar evento
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Planejamento"
        title="Eventos e projetos"
        description="Eventos autorizados para o seu perfil, com programação, tarefas e documentos."
        actions={
          access.can("events.create") && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <CalendarPlus /> Novo evento
            </Button>
          )
        }
      />
      <section className="rounded-xl border border-line bg-surface">
        <Toolbar>
          <FilterChips
            ariaLabel="Filtrar eventos"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "upcoming", label: "Próximos", count: count("upcoming") },
              { value: "planning", label: "Em planejamento", count: count("planning") },
              { value: "past", label: "Realizados", count: count("past") },
              { value: "all", label: "Todos", count: count("all") },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              label="Tipo"
              value={type}
              onChange={setType}
              options={[{ value: "", label: "Todos os tipos" }, ...(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => ({ value: t, label: EVENT_TYPE_LABELS[t] }))]}
            />
            <FilterSelect
              label="Departamento"
              value={dep}
              onChange={setDep}
              options={[{ value: "", label: "Todos os departamentos" }, ...dir.departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar evento" className="w-full sm:w-56" />
          </div>
        </Toolbar>
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : (
          <DataTable
            caption="Eventos"
            rows={rows}
            columns={columns}
            loading={isLoading}
            getRowId={(e) => e.id}
            onRowClick={(e) => router.push(`/eventos/${e.id}`)}
            mobileCard={(e) => (
              <div className="flex gap-3">
                <DateChip date={e.date} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-semibold">{e.name}</p>
                    <StatusBadge meta={EVENT_STATUS[e.status]} />
                  </div>
                  <p className="truncate text-[12px] text-fg-subtle">
                    {EVENT_TYPE_LABELS[e.type]} · {formatTime(e.time)} · {e.location}
                  </p>
                  <p className="text-[12px] text-fg-subtle">{dir.department(e.departmentId)?.name}</p>
                </div>
              </div>
            )}
            empty={
              <EmptyState
                icon={<CalendarDays />}
                title="Nenhum evento encontrado"
                description={query || type || dep ? "Ajuste os filtros para ver outros eventos." : "Ainda não há eventos neste filtro."}
                action={
                  access.can("events.create") ? (
                    <Button variant="primary" onClick={() => setCreateOpen(true)}>
                      <CalendarPlus /> Novo evento
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </section>
      <EventFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      {duplicate && <DuplicateEventDialog open onOpenChange={(o) => !o && setDuplicate(null)} event={duplicate} />}
    </>
  );
}

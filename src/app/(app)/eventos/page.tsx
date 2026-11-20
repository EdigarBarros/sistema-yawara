"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarPlus } from "lucide-react";
import type { AtleticaEvent, EventType } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useEvents } from "@/hooks/use-data";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { daysBetween, todayDateOnly } from "@/lib/format";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page";
import { ShowcaseGrid, ShowcaseGroup } from "@/components/shared/showcase";
import { FilterChips, FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { EventFormDialog } from "@/features/events/event-form-dialog";
import { DuplicateEventDialog } from "@/features/events/event-dialogs";
import { EventCard } from "@/features/events/event-card";
import { EventPreview } from "@/features/events/event-preview";
import { useIsDesktop } from "@/hooks/use-media";

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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
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
  const preview = previewId ? ((data ?? []).find((e) => e.id === previewId) ?? null) : null;

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

  const card = (e: AtleticaEvent) => (isDesktop ? <EventCard event={e} onClick={() => setPreviewId(e.id)} /> : <EventCard event={e} href={`/eventos/${e.id}`} />);
  const empty = (
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
  );
  // Nos próximos eventos, separa o que está perto do que ainda está longe.
  const groups =
    filter === "upcoming" && rows.length > 0
      ? [
          { title: "Nos próximos 7 dias", items: rows.filter((e) => daysBetween(today, e.date) <= 7) },
          { title: "Próximas semanas", items: rows.filter((e) => daysBetween(today, e.date) > 7 && daysBetween(today, e.date) <= 30) },
          { title: "Mais adiante", items: rows.filter((e) => daysBetween(today, e.date) > 30) },
        ].filter((g) => g.items.length > 0)
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Planejamento"
        title="Eventos e projetos"
        description="Eventos autorizados para o seu perfil. Toque num evento para ver o resumo; abra para cuidar da programação, das tarefas e dos documentos."
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
          <div className="space-y-7 rounded-b-xl bg-surface-2/50 p-4 sm:p-5">
            {groups && !isLoading ? (
              groups.map((g) => (
                <ShowcaseGroup key={g.title} title={g.title} count={g.items.length}>
                  <ShowcaseGrid label={g.title} items={g.items} getId={(e) => e.id} render={card} />
                </ShowcaseGroup>
              ))
            ) : (
              <ShowcaseGrid label="Eventos" items={rows} loading={isLoading} getId={(e) => e.id} render={card} empty={empty} />
            )}
          </div>
        )}
      </section>
      <EventFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EventPreview
        event={preview}
        onClose={() => setPreviewId(null)}
        onDuplicate={(e) => {
          setPreviewId(null);
          setDuplicate(e);
        }}
      />
      {duplicate && <DuplicateEventDialog open onOpenChange={(o) => !o && setDuplicate(null)} event={duplicate} />}
    </>
  );
}

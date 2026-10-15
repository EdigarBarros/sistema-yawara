"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GraduationCap, Plus, Users } from "lucide-react";
import type { ExtensionProject } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useEvents, useProjects } from "@/hooks/use-data";
import { ACTIVITY_TYPE_LABELS, PROJECT_STATUS } from "@/lib/labels";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { DateChip } from "@/components/shared/list-row";
import { ProjectFormDialog } from "@/features/extension/project-form-dialog";
import { attendeeTotal } from "@/features/extension/labels";

export default function ExtensionPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("extension");
  const { data, isLoading, isError, error, refetch } = useProjects(enabled);
  const { data: events } = useEvents(access.canModule("events"));
  const [status, setStatus] = useState<"all" | ExtensionProject["status"]>("all");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const createOpen = params.get("novo") === "1" && access.can("extension.create");
  const setCreateOpen = (o: boolean) => router.replace(o ? `${pathname}?novo=1` : pathname, { scroll: false });
  if (!enabled) return <RestrictedState />;

  const rows = (data ?? [])
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !type || p.activityType === type)
    .filter((p) => matchesQuery(query, p.name, p.description, p.code, p.speakers.map((s) => s.name).join(" ")))
    .sort((a, b) => b.date.localeCompare(a.date));
  const count = (s: typeof status) => (data ?? []).filter((p) => s === "all" || p.status === s).length;

  const columns: Column<ExtensionProject>[] = [
    {
      key: "name",
      header: "Projeto",
      cell: (p) => (
        <div className="flex items-center gap-3">
          <DateChip date={p.date} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{p.name}</p>
            <p className="truncate text-[12px] text-fg-subtle">
              {ACTIVITY_TYPE_LABELS[p.activityType]} · {p.location}
            </p>
          </div>
        </div>
      ),
    },
    { key: "resp", header: "Responsável", hideBelow: "lg", cell: (p) => <span className="text-fg-muted">{dir.memberName(p.responsibleId)}</span> },
    {
      key: "event",
      header: "Evento vinculado",
      hideBelow: "xl",
      cell: (p) => <span className="text-fg-muted">{p.eventId ? (events?.find((e) => e.id === p.eventId)?.name ?? "Evento restrito") : "—"}</span>,
    },
    {
      key: "people",
      header: "Presença",
      hideBelow: "lg",
      cell: (p) =>
        p.attendeesRestricted ? (
          // A listagem não carrega os nomes (dados pessoais): só a contagem de inscritos.
          <span className="inline-flex items-center gap-1.5 text-fg-muted" title="Inscritos na lista de presença">
            <Users className="size-4" />
            {attendeeTotal(p)} inscrito(s)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            <Users className="size-4" />
            {p.attendees.filter((a) => a.present).length}/{p.attendees.length}
          </span>
        ),
    },
    { key: "status", header: "Situação", cell: (p) => <StatusBadge meta={PROJECT_STATUS[p.status]} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Acadêmico"
        title="Ensino e Extensão"
        description="Palestras, minicursos, rodas de conversa e projetos de extensão."
        actions={
          access.can("extension.create") && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus /> Novo projeto
            </Button>
          )
        }
      />
      <section className="rounded-xl border border-line bg-surface">
        <Toolbar>
          <FilterChips
            ariaLabel="Situação"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Todos", count: count("all") },
              { value: "planning", label: "Em planejamento", count: count("planning") },
              { value: "open", label: "Inscrições abertas", count: count("open") },
              { value: "done", label: "Realizados", count: count("done") },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Tipo" value={type} onChange={setType} options={[{ value: "", label: "Todos os tipos" }, ...Object.entries(ACTIVITY_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar projeto ou palestrante" className="w-full sm:w-64" />
          </div>
        </Toolbar>
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : (
          <DataTable
            caption="Projetos de Ensino e Extensão"
            rows={rows}
            columns={columns}
            loading={isLoading}
            getRowId={(p) => p.id}
            onRowClick={(p) => router.push(`/extensao/${p.id}`)}
            mobileCard={(p) => (
              <div className="flex gap-3">
                <DateChip date={p.date} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="truncate text-[12px] text-fg-subtle">{ACTIVITY_TYPE_LABELS[p.activityType]}</p>
                  <div className="mt-1.5">
                    <StatusBadge meta={PROJECT_STATUS[p.status]} />
                  </div>
                </div>
              </div>
            )}
            empty={
              <EmptyState
                icon={<GraduationCap />}
                title="Nenhum projeto encontrado"
                action={
                  access.can("extension.create") ? (
                    <Button variant="primary" onClick={() => setCreateOpen(true)}>
                      <Plus /> Novo projeto
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </section>
      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

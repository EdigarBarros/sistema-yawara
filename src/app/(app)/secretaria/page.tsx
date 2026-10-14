"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ClipboardList, ClipboardPlus, Users } from "lucide-react";
import type { Meeting, MeetingStatus } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useMeetings } from "@/hooks/use-data";
import { MEETING_MODE_LABELS, MEETING_STATUS } from "@/lib/labels";
import { formatDate, formatRelative, formatTime, todayDateOnly } from "@/lib/format";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { DateChip, ListRow } from "@/components/shared/list-row";

type Filter = "all" | MeetingStatus;

export default function MeetingsPage() {
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("meetings");
  const { data, isLoading, isError, error, refetch } = useMeetings(enabled);
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState("");
  const [query, setQuery] = useState("");
  if (!enabled) return <RestrictedState />;

  const today = todayDateOnly();
  const upcoming = (data ?? []).filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = (data ?? []).filter((m) => m.date < today);
  const rows = past
    .filter((m) => filter === "all" || m.status === filter)
    .filter((m) => !mode || m.mode === mode)
    .filter((m) => matchesQuery(query, m.title, m.code, m.agenda.join(" "), m.summary, m.participantIds.map((id) => dir.memberName(id)).join(" ")))
    .sort((a, b) => b.date.localeCompare(a.date));
  const count = (f: Filter) => past.filter((m) => f === "all" || m.status === f).length;

  const columns: Column<Meeting>[] = [
    {
      key: "title",
      header: "Reunião",
      cell: (m) => (
        <div className="flex items-center gap-3">
          <DateChip date={m.date} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{m.title}</p>
            <p className="truncate text-[12px] text-fg-subtle">
              {m.code} · {formatTime(m.startTime)} · {MEETING_MODE_LABELS[m.mode]}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "people",
      header: "Participantes",
      hideBelow: "lg",
      cell: (m) => (
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <Users className="size-4" /> {m.participantIds.length}
        </span>
      ),
    },
    { key: "by", header: "Registrada por", hideBelow: "xl", cell: (m) => <span className="text-fg-muted">{dir.memberName(m.createdBy)}</span> },
    { key: "status", header: "Situação do registro", cell: (m) => <StatusBadge meta={MEETING_STATUS[m.status]} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Secretaria"
        title="Reuniões e atas"
        description="Registre reuniões, acompanhe a aprovação das atas e gere o PDF institucional."
        actions={
          access.can("meetings.create") && (
            <ButtonLink href="/secretaria/registrar" variant="primary">
              <ClipboardPlus /> Registrar reunião
            </ButtonLink>
          )
        }
      />

      <div className="space-y-5">
        <Panel title="Próximas reuniões" description="Agendadas a partir de hoje" bodyClassName="py-1.5">
          {isLoading ? (
            <InlineLoader />
          ) : upcoming.length === 0 ? (
            <EmptyState compact icon={<CalendarClock />} title="Nenhuma reunião agendada" />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((m) => (
                <li key={m.id}>
                  <ListRow
                    href={`/secretaria/${m.id}`}
                    leading={<DateChip date={m.date} />}
                    title={m.title}
                    subtitle={`${formatRelative(m.date)} · ${formatTime(m.startTime)} · ${m.location} · ${m.participantIds.length} participantes`}
                    trailing={<StatusBadge meta={MEETING_STATUS[m.status]} className="hidden sm:inline-flex" />}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <section className="rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 pt-4 sm:px-5">
            <h2 className="text-[14.5px] font-semibold">Reuniões anteriores</h2>
            <p className="text-[12.5px] text-fg-muted">Registros e situação das atas</p>
          </div>
          <Toolbar className="border-b-0 pb-3">
            <FilterChips
              ariaLabel="Situação da ata"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Todas", count: count("all") },
                { value: "draft", label: "Rascunho", count: count("draft") },
                { value: "pending_approval", label: "Aguardando aprovação", count: count("pending_approval") },
                { value: "approved", label: "Aprovadas", count: count("approved") },
                { value: "archived", label: "Arquivadas", count: count("archived") },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <FilterSelect
                label="Modalidade"
                value={mode}
                onChange={setMode}
                options={[{ value: "", label: "Todas as modalidades" }, ...Object.entries(MEETING_MODE_LABELS).map(([v, l]) => ({ value: v, label: l }))]}
              />
              <SearchInput value={query} onChange={setQuery} placeholder="Buscar por título, pauta ou participante" className="w-full sm:w-72" />
            </div>
          </Toolbar>
          <div className="border-t border-line">
            {isError ? (
              <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
            ) : (
              <DataTable
                caption="Reuniões anteriores"
                rows={rows}
                columns={columns}
                loading={isLoading}
                getRowId={(m) => m.id}
                onRowClick={(m) => router.push(`/secretaria/${m.id}`)}
                mobileCard={(m) => (
                  <div className="flex gap-3">
                    <DateChip date={m.date} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{m.title}</p>
                      <p className="text-[12px] text-fg-subtle">
                        {formatDate(m.date)} · {m.participantIds.length} participantes
                      </p>
                      <div className="mt-1.5">
                        <StatusBadge meta={MEETING_STATUS[m.status]} />
                      </div>
                    </div>
                  </div>
                )}
                empty={<EmptyState icon={<ClipboardList />} title="Nenhuma reunião encontrada" description="Ajuste a busca ou os filtros." />}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

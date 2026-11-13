"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Dumbbell, Plus, Swords, Trophy, Users } from "lucide-react";
import type { SportTeam, TeamStatus } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useSportsTeams } from "@/hooks/use-data";
import { TEAM_STATUS } from "@/lib/labels";
import { formatDate, formatTime, todayDateOnly } from "@/lib/format";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/shared/page";
import { FilterChips, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { DateChip, ListRow } from "@/components/shared/list-row";
import { TeamFormDialog } from "@/features/sports/team-form-dialog";
import { nextTraining, SPORTS_COLOR, teamRecord, teamSubtitle, upcomingMatches, whenLabel } from "@/features/sports/utils";

type Filter = TeamStatus | "all";

export default function SportsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const enabled = access.canModule("sports");
  const { data, isLoading, isError, error, refetch } = useSportsTeams(enabled);
  const [status, setStatus] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const createOpen = params.get("novo") === "1" && access.can("sports.create");
  const setCreateOpen = (o: boolean) => router.replace(o ? `${pathname}?novo=1` : pathname, { scroll: false });
  if (!enabled) return <RestrictedState />;

  const all = data ?? [];
  const today = todayDateOnly();
  const count = (s: Filter) => all.filter((t) => s === "all" || t.status === s).length;
  const rows = all
    .filter((t) => status === "all" || t.status === status)
    .filter((t) => matchesQuery(query, t.name, t.sport, t.code, t.coach ?? ""))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const nextGames = all
    .filter((t) => t.status !== "archived")
    .flatMap((t) => upcomingMatches(t, today).map((m) => ({ team: t, match: m })))
    .sort((a, b) => a.match.date.localeCompare(b.match.date) || (a.match.time ?? "").localeCompare(b.match.time ?? ""))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Esportes"
        description="Modalidades da Atlética: treinos, elenco, jogos e competições."
        actions={
          access.can("sports.create") && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus /> Nova modalidade
            </Button>
          )
        }
      />

      {nextGames.length > 0 && (
        <Panel title="Próximos jogos" description="De todas as modalidades que você acompanha" className="mb-5" bodyClassName="py-1.5">
          <ul className="divide-y divide-line">
            {nextGames.map(({ team, match }) => (
              <li key={match.id}>
                <ListRow
                  href={`/esportes/${team.id}?aba=jogos`}
                  leading={<DateChip date={match.date} />}
                  title={`${team.name} × ${match.opponent}`}
                  subtitle={`${match.time ? `${formatTime(match.time)} · ` : ""}${match.location}${match.competitionId ? ` · ${team.competitions.find((c) => c.id === match.competitionId)?.name ?? ""}` : " · Amistoso"}`}
                />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <section className="rounded-xl border border-line bg-surface">
        <Toolbar>
          <FilterChips
            ariaLabel="Situação"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Em atividade", count: count("active") },
              { value: "paused", label: "Pausadas", count: count("paused") },
              { value: "archived", label: "Arquivadas", count: count("archived") },
              { value: "all", label: "Todas", count: count("all") },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar modalidade ou esporte" className="w-full sm:w-64" />
        </Toolbar>
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : isLoading ? (
          <InlineLoader />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Trophy />}
            title={all.length === 0 ? "Nenhuma modalidade ainda" : "Nenhuma modalidade encontrada"}
            description={all.length === 0 ? "Cadastre a primeira modalidade (ex.: Futsal Feminino) para organizar treinos, elenco e jogos." : undefined}
            action={
              access.can("sports.create") && all.length === 0 ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus /> Nova modalidade
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((t, i) => (
              <TeamCard key={t.id} team={t} today={today} index={i} />
            ))}
          </ul>
        )}
      </section>
      <TeamFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function TeamCard({ team, today, index }: { team: SportTeam; today: string; index: number }) {
  const record = teamRecord(team.matches);
  const next = upcomingMatches(team, today)[0];
  const training = team.status === "active" ? nextTraining(team.trainings, today) : null;
  return (
    <li className="anim-rise" style={{ animationDelay: `${Math.min(index * 45, 450)}ms` }}>
      <Link
        href={`/esportes/${team.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)] focus-visible:ring-2 focus-visible:ring-gold/50 focus-visible:outline-none"
      >
        <div className="flex items-start gap-3 px-4 pt-4 pb-3" style={{ background: `linear-gradient(180deg, ${SPORTS_COLOR}26, transparent)` }}>
          <span className="grid size-11 shrink-0 place-items-center rounded-xl text-[#06102e]" style={{ background: `linear-gradient(145deg, ${SPORTS_COLOR}, ${SPORTS_COLOR}aa)` }}>
            <Trophy className="size-5" strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[18px] leading-tight font-bold">{team.name}</p>
            <p className="truncate text-[12.5px] text-fg-muted">{teamSubtitle(team)}</p>
          </div>
          <StatusBadge meta={TEAM_STATUS[team.status]} />
        </div>
        <dl className="grid min-w-0 flex-1 gap-2.5 px-4 pb-3 text-[12.5px]">
          <div className="flex min-w-0 items-center gap-2 text-fg-muted">
            <Dumbbell className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <dt className="sr-only">Próximo treino</dt>
            <dd className="truncate">{training ? `${whenLabel(training)}, ${formatTime(training.slot.start)} · ${training.slot.location}` : team.trainings.length ? "Treinos suspensos" : "Sem horário de treino"}</dd>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-fg-muted">
            <Swords className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <dt className="sr-only">Próximo jogo</dt>
            <dd className="truncate">{next ? `${formatDate(next.date)} × ${next.opponent}` : "Nenhum jogo agendado"}</dd>
          </div>
        </dl>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-fg-subtle">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden /> {team.athletes.length} no elenco
          </span>
          <span className="flex items-center gap-1.5 font-mono tnum" title="Vitórias, empates e derrotas">
            <CalendarClock className="size-3.5" aria-hidden />
            <span className="text-ok">{record.wins}V</span> <span className="text-warn">{record.draws}E</span> <span className="text-danger">{record.losses}D</span>
          </span>
        </div>
      </Link>
    </li>
  );
}

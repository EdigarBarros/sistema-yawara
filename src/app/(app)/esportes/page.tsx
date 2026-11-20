"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Plus, Trophy } from "lucide-react";
import type { SessionKind } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useTeams } from "@/hooks/use-data";
import { canEditTeam } from "@/lib/policies";
import { MODALITIES, recentResults, SESSION_KIND_LABELS, SPORT_RULES, teamRecord, upcomingSessions } from "@/lib/sports";
import { todayDateOnly } from "@/lib/format";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page";
import { FilterChips, FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { ShowcaseGrid, ShowcaseGroup } from "@/components/shared/showcase";
import { NextGameHero, ScorePill, SessionRow, TeamCard } from "@/features/sports/sport-ui";
import { SessionDialog, TeamFormDialog } from "@/features/sports/sport-dialogs";

type Filter = "active" | "archived";
type Agenda = "upcoming" | "results";

export default function SportsPage() {
  const access = useAccess();
  const enabled = access.canModule("sports");
  const { data, isLoading, isError, error, refetch } = useTeams(enabled);
  const [filter, setFilter] = useState<Filter>("active");
  const [modality, setModality] = useState("");
  const [query, setQuery] = useState("");
  const [agenda, setAgenda] = useState<Agenda>("upcoming");
  const [kind, setKind] = useState<SessionKind | "">("");
  const [teamOpen, setTeamOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);

  const today = todayDateOnly();
  const teams = useMemo(() => data ?? [], [data]);
  const activeTeams = teams.filter((t) => t.status === "active");
  const editableTeams = activeTeams.filter((t) => !!access.ctx && canEditTeam(access.ctx, t));
  const upcoming = upcomingSessions(activeTeams, today);
  const results = recentResults(teams);
  const nextGame = upcoming.find((s) => s.kind !== "treino");
  const total = activeTeams.reduce(
    (acc, t) => {
      const r = teamRecord(t);
      return { win: acc.win + r.win, draw: acc.draw + r.draw, loss: acc.loss + r.loss };
    },
    { win: 0, draw: 0, loss: 0 },
  );

  const rows = teams
    .filter((t) => (filter === "active" ? t.status === "active" : t.status === "archived"))
    .filter((t) => !modality || t.modality === modality)
    .filter((t) => matchesQuery(query, t.name, t.code, SPORT_RULES[t.modality].label));
  const agendaRows = (agenda === "upcoming" ? upcoming : results).filter((s) => !kind || s.kind === kind).slice(0, 12);

  if (!enabled)
    return (
      <RestrictedState
        description={access.moduleEnabled("sports") ? (isDemoMode ? undefined : "Seu perfil não tem acesso aos esportes. Procure a diretoria se precisar.") : "O módulo de esportes está desativado nas configurações."}
      />
    );

  return (
    <>
      <PageHeader
        eyebrow="Vestiário"
        title="Esportes"
        description="Times, elenco e escalação na quadra 3D, além dos treinos e jogos da Atlética."
        actions={
          <>
            {editableTeams.length > 0 && (
              <Button onClick={() => setSessionOpen(true)}>
                <CalendarPlus /> Marcar treino ou jogo
              </Button>
            )}
            {access.can("sports.create") && (
              <Button variant="primary" onClick={() => setTeamOpen(true)}>
                <Plus /> Novo time
              </Button>
            )}
          </>
        }
      />

      {isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-8">
          {(nextGame || results.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              {nextGame ? (
                <NextGameHero session={nextGame} team={nextGame.team} />
              ) : (
                <div className="grid place-items-center rounded-[22px] border border-dashed border-line-strong p-6 text-[13px] text-fg-muted">Nenhum jogo marcado.</div>
              )}
              <div className="anim-rise rounded-[22px] border border-line bg-surface p-5" style={{ animationDelay: "120ms" }}>
                <p className="eyebrow">Campanha da Atlética</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Vitórias", value: total.win, cls: "text-ok" },
                    { label: "Empates", value: total.draw, cls: "text-fg-muted" },
                    { label: "Derrotas", value: total.loss, cls: "text-danger" },
                  ].map((x) => (
                    <div key={x.label} className="rounded-xl bg-surface-2 py-3">
                      <div className={`tnum font-display text-[30px] leading-none font-extrabold ${x.cls}`}>{x.value}</div>
                      <div className="mt-1 text-[11.5px] text-fg-subtle">{x.label}</div>
                    </div>
                  ))}
                </div>
                {results.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {results.slice(0, 3).map((s) => (
                      <li key={s.id} className="flex items-center gap-2 text-[13px]">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: s.team.color }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          {s.team.name} <span className="text-fg-subtle">x</span> {s.opponent}
                        </span>
                        <ScorePill score={s.score!} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <ShowcaseGroup title="Times" count={rows.length}>
            <section className="rounded-xl border border-line bg-surface">
              <Toolbar>
                <FilterChips
                  ariaLabel="Filtrar times"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "active", label: "Ativos", count: activeTeams.length },
                    { value: "archived", label: "Arquivados", count: teams.length - activeTeams.length },
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <FilterSelect label="Modalidade" value={modality} onChange={setModality} options={[{ value: "", label: "Todas as modalidades" }, ...MODALITIES.map((m) => ({ value: m, label: SPORT_RULES[m].label }))]} />
                  <SearchInput value={query} onChange={setQuery} placeholder="Buscar time" className="w-full sm:w-52" />
                </div>
              </Toolbar>
              <div className="rounded-b-xl bg-surface-2/50 p-4 sm:p-5">
                <ShowcaseGrid
                  label="Times"
                  items={rows}
                  loading={isLoading}
                  getId={(t) => t.id}
                  render={(t) => <TeamCard team={t} />}
                  empty={
                    <EmptyState
                      icon={<Trophy />}
                      title={query || modality ? "Nenhum time encontrado" : filter === "archived" ? "Nenhum time arquivado" : "Nenhum time ainda"}
                      description={query || modality ? "Ajuste os filtros." : "Crie o primeiro time para montar o elenco e a escalação."}
                      action={
                        access.can("sports.create") && filter === "active" ? (
                          <Button variant="primary" onClick={() => setTeamOpen(true)}>
                            <Plus /> Novo time
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
              </div>
            </section>
          </ShowcaseGroup>

          <ShowcaseGroup title="Agenda esportiva">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FilterChips
                ariaLabel="Agenda"
                value={agenda}
                onChange={setAgenda}
                options={[
                  { value: "upcoming", label: "Próximos", count: upcoming.length },
                  { value: "results", label: "Resultados", count: results.length },
                ]}
              />
              <FilterSelect
                label="Tipo"
                value={kind}
                onChange={(v) => setKind(v as SessionKind | "")}
                options={[{ value: "", label: "Treinos e jogos" }, ...(Object.keys(SESSION_KIND_LABELS) as SessionKind[]).map((k) => ({ value: k, label: SESSION_KIND_LABELS[k] }))]}
              />
            </div>
            {agendaRows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-fg-muted">
                {agenda === "upcoming" ? "Nada marcado por enquanto." : "Nenhum resultado registrado ainda."}
              </p>
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {agendaRows.map((s, i) => (
                  <li key={s.id} className="anim-row" style={{ animationDelay: `${i * 40}ms` }}>
                    <SessionRow session={s} team={s.team} showTeam />
                  </li>
                ))}
              </ul>
            )}
          </ShowcaseGroup>
        </div>
      )}

      <TeamFormDialog open={teamOpen} onOpenChange={setTeamOpen} />
      <SessionDialog open={sessionOpen} onOpenChange={setSessionOpen} teams={editableTeams} />
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, CalendarDays, Clock, Dumbbell, FolderOpen, LayoutGrid, MapPin, Medal, Plus, Swords, Ticket, Trophy, Users } from "lucide-react";
import type { Competition, Match, SportTeam, TrainingSlot } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useSportsTeams } from "@/hooks/use-data";
import { useCountUp } from "@/hooks/use-count-up";
import { daysBetween, firstName, formatLongDate, formatTime, greeting, parseDateOnly, todayDateOnly } from "@/lib/format";
import { findSport } from "@/lib/sports-catalog";
import { SportGlyph } from "@/features/sports/sport-glyph";
import { nextTraining, SPORTS_COLOR, teamRecord, upcomingMatches } from "@/features/sports/utils";
import { PendingSection, Tile, type TileProps } from "./presidency-mobile";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function delay(ms: number) {
  return { animationDelay: `${ms}ms` };
}

/** "hoje", "amanhã", "sábado" ou "em 12 dias" (mais de uma semana). */
function dayWord(today: string, date: string) {
  const d = daysBetween(today, date);
  if (d === 0) return "hoje";
  if (d === 1) return "amanhã";
  if (d < 7) return WEEKDAY[parseDateOnly(date).getUTCDay()];
  return `em ${d} dias`;
}

/* ------------------------------- dados ------------------------------- */

interface Overview {
  teams: SportTeam[];
  active: SportTeam[];
  athletes: number;
  nextMatch: { team: SportTeam; match: Match } | null;
  nextTraining: { team: SportTeam; slot: TrainingSlot; inDays: number } | null;
  nextCompetition: { team: SportTeam; competition: Competition } | null;
}

function useOverview(): { data: Overview | null; loading: boolean; failed: boolean } {
  const { data, isLoading, isError } = useSportsTeams();
  const today = todayDateOnly();
  const overview = useMemo<Overview | null>(() => {
    if (!data) return null;
    const teams = data.filter((t) => t.status !== "archived").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const active = teams.filter((t) => t.status === "active");
    const nextMatch =
      teams
        .flatMap((team) => upcomingMatches(team, today).map((match) => ({ team, match })))
        .sort((a, b) => a.match.date.localeCompare(b.match.date) || (a.match.time ?? "").localeCompare(b.match.time ?? ""))[0] ?? null;
    const trainings = active
      .map((team) => {
        const n = nextTraining(team.trainings, today);
        return n ? { team, ...n } : null;
      })
      .filter((x) => x !== null)
      .sort((a, b) => a.inDays - b.inDays || a.slot.start.localeCompare(b.slot.start));
    const nextCompetition =
      teams
        .flatMap((team) => team.competitions.filter((c) => c.status !== "finished" && (c.endDate ?? c.startDate) >= today).map((competition) => ({ team, competition })))
        .sort((a, b) => a.competition.startDate.localeCompare(b.competition.startDate))[0] ?? null;
    return { teams, active, athletes: active.reduce((n, t) => n + t.athletes.length, 0), nextMatch, nextTraining: trainings[0] ?? null, nextCompetition };
  }, [data, today]);
  return { data: overview, loading: isLoading, failed: isError };
}

/* ---------------------------- próximo jogo ---------------------------- */

/** O cartão grande do topo: o próximo jogo, com quanto falta. */
function NextMatchCard({ overview, loading, failed }: { overview: Overview | null; loading: boolean; failed: boolean }) {
  const access = useAccess();
  const today = todayDateOnly();
  const next = overview?.nextMatch;
  const days = next ? daysBetween(today, next.match.date) : 0;
  const count = useCountUp(next ? days : 0);
  const onlyTeam = overview?.teams.length === 1 ? overview.teams[0] : null;
  const href = next ? `/esportes/${next.team.id}?aba=jogos` : onlyTeam ? `/esportes/${onlyTeam.id}?aba=jogos` : overview?.teams.length === 0 && access.can("sports.create") ? "/esportes?novo=1" : "/esportes";
  const competition = next?.match.competitionId ? next.team.competitions.find((c) => c.id === next.match.competitionId)?.name : null;

  return (
    <Link
      href={href}
      className="press anim-rise relative isolate flex min-h-[188px] flex-col justify-between overflow-hidden rounded-[26px] p-5 text-[#2a0c03] shadow-[0_14px_34px_-10px_rgba(240,122,90,0.55)]"
      style={{ ...delay(60), background: "linear-gradient(135deg, #ffb39a 0%, #f07a5a 48%, #d4532f 100%)" }}
    >
      {/* Quadra desenhada ao fundo */}
      <svg aria-hidden viewBox="0 0 320 200" className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.22]" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#fff" strokeWidth="2.5">
        <rect x="14" y="14" width="292" height="172" rx="6" />
        <path d="M160 14v172" />
        <circle cx="160" cy="100" r="30" />
        <circle cx="160" cy="100" r="3" fill="#fff" />
        <path d="M14 62a44 38 0 0 1 0 76M306 62a44 38 0 0 0 0 76" />
      </svg>
      <Trophy aria-hidden className="absolute top-4 right-4 -z-10 size-16 opacity-20" strokeWidth={1.4} style={{ animation: "float-y 3.4s ease-in-out infinite" }} />

      <span className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2a0c03] px-3 py-1 text-[11.5px] font-bold tracking-[0.08em] text-[#ffb39a] uppercase">
          <Swords className="size-3.5" aria-hidden /> Próximo jogo
        </span>
        {next && (
          <span className="text-[12.5px] font-bold opacity-80">{competition ?? "Amistoso"}</span>
        )}
      </span>

      {failed ? (
        <span className="mt-4 text-[15px] font-semibold">Não foi possível carregar os jogos.</span>
      ) : loading || !overview ? (
        <span className="mt-4 text-[15px] font-semibold opacity-80">Carregando…</span>
      ) : next ? (
        <span className="mt-4 flex items-end justify-between gap-4">
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold opacity-80">{next.team.name}</span>
            <strong className="mt-0.5 block font-display text-[26px] leading-[1.05] font-extrabold break-words">× {next.match.opponent}</strong>
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold opacity-85">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden />
                {dayWord(today, next.match.date)}
              </span>
              {next.match.time && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden />
                  {formatTime(next.match.time)}
                </span>
              )}
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{next.match.location}</span>
              </span>
            </span>
          </span>
          <span className="grid shrink-0 place-items-center rounded-2xl bg-[#2a0c03] px-3.5 py-2.5 text-center text-[#ffb39a]">
            {days === 0 ? (
              <strong className="font-display text-[22px] leading-none font-extrabold" style={{ animation: "breathe 2.4s ease-in-out infinite" }}>
                HOJE
              </strong>
            ) : (
              <>
                <strong className="font-display text-[34px] leading-none font-extrabold tnum">{count}</strong>
                <span className="text-[11px] font-bold tracking-wide uppercase">{days === 1 ? "dia" : "dias"}</span>
              </>
            )}
          </span>
        </span>
      ) : (
        <span className="mt-4 block">
          <strong className="block font-display text-[24px] leading-tight font-extrabold">Nenhum jogo marcado</strong>
          <span className="mt-1 block text-[13.5px] font-semibold opacity-80">Marque um amistoso ou um jogo de campeonato.</span>
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-[#2a0c03] px-3 py-1.5 text-[13px] font-bold text-[#ffb39a]">
            {overview.teams.length === 0 ? "Criar modalidade" : "Marcar jogo"} <ArrowRight className="size-4" aria-hidden />
          </span>
        </span>
      )}
    </Link>
  );
}

/* ---------------------------- botões grandes ---------------------------- */

function useSportsTiles(overview: Overview | null, loading: boolean): Omit<TileProps, "index">[] {
  const access = useAccess();
  const today = todayDateOnly();
  const wait = loading || !overview ? "Carregando…" : null;
  const tiles: Omit<TileProps, "index">[] = [];

  const training = overview?.nextTraining;
  tiles.push({
    href: training ? `/esportes/${training.team.id}?aba=treinos` : "/esportes",
    icon: Dumbbell,
    color: "#ffb39a",
    title: "Treino",
    info:
      wait ??
      (training ? (
        <>
          <b className="font-semibold text-fg">{training.inDays === 0 ? "hoje" : training.inDays === 1 ? "amanhã" : WEEKDAY[training.slot.weekday]}</b> {formatTime(training.slot.start)} · {training.team.name}
        </>
      ) : (
        "Nenhum horário fixo"
      )),
  });

  const comp = overview?.nextCompetition;
  tiles.push({
    href: comp ? `/esportes/${comp.team.id}?aba=competicoes` : "/esportes",
    icon: Medal,
    color: "#f3cd66",
    title: "Campeonatos",
    info:
      wait ??
      (comp ? (
        <>
          {comp.competition.name} · <b className="font-semibold text-fg">{comp.competition.startDate <= today ? "rolando" : dayWord(today, comp.competition.startDate)}</b>
        </>
      ) : (
        "Nenhum à vista"
      )),
  });

  tiles.push({
    href: "/esportes",
    icon: Users,
    color: SPORTS_COLOR,
    title: "Times",
    info: wait ?? (overview!.active.length === 0 ? "Nenhum em atividade" : `${overview!.active.length} ${overview!.active.length === 1 ? "ativo" : "ativos"} · ${overview!.athletes} atletas`),
  });

  tiles.push({ href: "/agenda", icon: CalendarDays, color: "#9b8cf2", title: "Agenda", info: "Jogos, treinos e eventos" });
  if (access.canModule("campaigns")) tiles.push({ href: "/campanhas", icon: Ticket, color: "#e1af37", title: "Rifa", info: "Para pagar inscrição e uniforme" });
  if (access.canModule("documents")) tiles.push({ href: "/documentos", icon: FolderOpen, color: "#3fcf8e", title: "Documentos", info: "Regulamentos e fichas" });
  return tiles;
}

/* ------------------------------- seus times ------------------------------- */

function TeamChip({ team, index }: { team: SportTeam; index: number }) {
  const r = teamRecord(team.matches);
  const sport = findSport(team.sport);
  return (
    <li className="anim-rise w-[168px] shrink-0 snap-start lg:w-auto" style={delay(220 + index * 50)}>
      <Link href={`/esportes/${team.id}`} className="press group flex h-full flex-col gap-3 rounded-[22px] border border-line bg-surface p-3.5 hover:border-line-strong">
        <span className="flex items-center justify-between">
          <span className="grid size-11 place-items-center rounded-[14px]" style={{ background: `${SPORTS_COLOR}22`, color: SPORTS_COLOR }}>
            <SportGlyph sport={sport?.key ?? null} className="size-7" />
          </span>
          {team.status === "paused" && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-subtle">Pausado</span>}
        </span>
        <span className="min-w-0">
          <strong className="line-clamp-2 block text-[15px] leading-tight font-semibold">{team.name}</strong>
          <span className="mt-1 flex items-center gap-2 text-[12.5px] text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden /> {team.athletes.length}
            </span>
            {r.played > 0 && (
              <span className="font-mono tnum" title="Vitórias, empates e derrotas">
                <span className="text-ok">{r.wins}V</span> <span className="text-warn">{r.draws}E</span> <span className="text-danger">{r.losses}D</span>
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

function TeamsStrip({ overview }: { overview: Overview | null }) {
  const access = useAccess();
  if (!overview) return null;
  const canCreate = access.can("sports.create");
  if (overview.teams.length === 0 && !canCreate) return null;
  return (
    <section aria-labelledby="seus-times">
      <div className="anim-rise mb-3 flex items-end justify-between gap-3" style={delay(200)}>
        <h2 id="seus-times" className="font-display text-[22px] leading-none font-bold">
          Seus times
        </h2>
        <Link href="/esportes" className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-semibold" style={{ color: SPORTS_COLOR }}>
          Ver todos <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
        {overview.teams.map((t, i) => (
          <TeamChip key={t.id} team={t} index={i} />
        ))}
        {canCreate && (
          <li className="anim-rise w-[168px] shrink-0 snap-start lg:w-auto" style={delay(220 + overview.teams.length * 50)}>
            <Link href="/esportes?novo=1" className="press flex h-full min-h-[118px] flex-col items-start justify-between gap-3 rounded-[22px] border border-dashed border-line-strong p-3.5 text-fg-muted hover:text-fg">
              <span className="grid size-11 place-items-center rounded-[14px] bg-surface-2 text-fg">
                <Plus className="size-[22px]" aria-hidden />
              </span>
              <strong className="text-[15px] leading-tight font-semibold text-fg">Novo time</strong>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

/* ---------------------------------- tela ---------------------------------- */

/**
 * Início do Diretor(a) de Esportes: o próximo jogo em destaque, botões grandes
 * para treino, campeonatos e times, os times em cartões e o que está esperando
 * uma ação (placar pendente, jogo chegando, elenco vazio). No computador, o
 * "Precisa de você" vai para a coluna da direita.
 */
export function SportsHome() {
  const access = useAccess();
  const { data, loading, failed } = useOverview();
  const tiles = useSportsTiles(data, loading);
  if (!access.user) return null;

  return (
    <div className="mx-auto max-w-[560px] lg:max-w-[1180px]">
      <header className="anim-rise mb-7">
        <p className="text-[14px] font-medium text-fg-muted first-letter:uppercase">{formatLongDate(new Date())}</p>
        <h1 className="mt-1 font-display text-[34px] leading-[1.02] font-extrabold tracking-[-0.01em] lg:text-[40px]">
          {greeting()}, <span className="bg-gradient-to-r from-[var(--title-from)] via-[var(--title-via)] to-[var(--title-to)] bg-clip-text text-transparent">{firstName(access.user.name)}</span>
        </h1>
        <p className="mt-1.5 text-[14px] text-fg-muted">{access.role?.name} · como estão os times hoje?</p>
      </header>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-col gap-7">
          <section aria-label="O que você quer fazer?" className="flex flex-col gap-3">
            <NextMatchCard overview={data} loading={loading} failed={failed} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {tiles.map((t, i) => (
                <Tile key={t.title} {...t} index={i} />
              ))}
            </div>
            <Link
              href="/mais"
              className="press anim-rise group flex min-h-[64px] items-center gap-3 rounded-[22px] border border-dashed border-line-strong px-4 text-fg-muted hover:text-fg lg:hidden"
              style={delay(140 + tiles.length * 60)}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-surface-2 text-fg">
                <LayoutGrid className="size-[22px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-[17px] leading-tight font-semibold text-fg">Ver tudo</strong>
                <span className="block truncate text-[13px]">Todas as áreas da Atlética</span>
              </span>
              <ArrowRight className="size-5 shrink-0 transition-transform group-active:translate-x-1" aria-hidden />
            </Link>
          </section>
          <TeamsStrip overview={data} />
        </div>
        <PendingSection className="lg:sticky lg:top-6" limit={5} />
      </div>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { CalendarPlus, Dumbbell, LayoutGrid, MapPin, Percent, Plus, Shirt, Swords, Target, Trophy, Users, type LucideIcon } from "lucide-react";
import type { SportTeam } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useSportsTeams } from "@/hooks/use-data";
import { canEditTeam } from "@/lib/policies";
import { courtModalityOf, positionShort } from "@/lib/sports-court";
import { firstName, formatDate, formatLongDate, greeting, todayDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/misc";
import { ShowcaseCard } from "@/components/shared/showcase";
import { hasWebGL, type CameraPreset, type CourtPlayer } from "@/features/sports/court/court-geometry";
import { countdown, nextGame, seasonNumbers, weekAgenda, type NextGame, type SeasonNumbers, type WeekItem } from "@/features/sports/home-rules";
import { SPORTS_COLOR, teamRecord, teamSubtitle } from "@/features/sports/utils";
import { Tile } from "./presidency-mobile";

const Court3D = dynamic(() => import("@/features/sports/court/court-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/* --------------------------------- dados --------------------------------- */

function useSportsHome() {
  const access = useAccess();
  const query = useSportsTeams();
  const today = todayDateOnly();
  const teams = useMemo(() => query.data ?? [], [query.data]);
  const game = useMemo(() => (query.data ? nextGame(teams, today) : null), [query.data, teams, today]);
  const week = useMemo(() => (query.data ? weekAgenda(teams, today) : []), [query.data, teams, today]);
  const numbers = useMemo(() => (query.data ? seasonNumbers(teams, today) : null), [query.data, teams, today]);
  const editable = teams.filter((t) => t.status !== "archived" && !!access.ctx && canEditTeam(access.ctx, t));
  return { access, query, teams, game, week, numbers, editable };
}

/** Botões grandes: os atalhos levam ao time do próximo jogo (ou ao primeiro que a pessoa pode editar). */
function useSportsTiles(game: NextGame | null, editable: SportTeam[]) {
  const access = useAccess();
  const target = game && editable.some((t) => t.id === game.team.id) ? game.team : editable[0];
  const tiles: { href: string; icon: LucideIcon; color: string; title: string; info: string; show: boolean }[] = [
    {
      href: target ? `/esportes/${target.id}?aba=quadra` : "/esportes",
      icon: Shirt,
      color: SPORTS_COLOR,
      title: "Montar escalação",
      info: target ? `Quadra 3D do ${target.name}` : "Escolha a modalidade",
      show: !!target,
    },
    { href: target ? `/esportes/${target.id}?aba=jogos&novo=jogo` : "/esportes", icon: Swords, color: "#e1af37", title: "Marcar jogo", info: target ? `Amistoso ou campeonato · ${target.name}` : "", show: !!target },
    { href: target ? `/esportes/${target.id}?aba=treinos&novo=treino` : "/esportes", icon: Dumbbell, color: "#3fcf8e", title: "Marcar treino", info: target ? `Horário fixo · ${target.name}` : "", show: !!target },
    { href: "/esportes?novo=1", icon: Plus, color: "#b6a9ff", title: "Nova modalidade", info: "Futsal, vôlei, basquete…", show: access.can("sports.create") },
    { href: "/esportes", icon: LayoutGrid, color: "#5b86d9", title: "Modalidades", info: "Todos os times da Atlética", show: access.can("sports.view") },
  ];
  return tiles.filter((t) => t.show);
}

/* -------------------------------- peças -------------------------------- */

function useCan3D() {
  const reduced = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const webgl = useSyncExternalStore(
    () => () => {},
    hasWebGL,
    () => true,
  );
  return webgl && !reduced;
}

/** Placar eletrônico do próximo jogo. */
function Scoreboard({ game, compact }: { game: NextGame; compact?: boolean }) {
  const { team, match, inDays } = game;
  const competition = match.competitionId ? team.competitions.find((c) => c.id === match.competitionId)?.name : undefined;
  return (
    <Link
      href={`/esportes/${team.id}?aba=jogos`}
      className="group relative block overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(135deg,#0a1f66,#030f45_65%)] p-5 text-white"
    >
      <span aria-hidden className="absolute -top-20 -right-12 size-60 rounded-full opacity-35 blur-3xl" style={{ background: SPORTS_COLOR }} />
      <span className="relative flex flex-wrap items-center justify-between gap-2 text-[11.5px] font-semibold tracking-[0.14em] text-white/70 uppercase">
        <span className="inline-flex items-center gap-1.5">
          <Trophy className="size-3.5" aria-hidden /> Próximo jogo · {competition ?? "Amistoso"}
        </span>
        <span className={cn("rounded-full px-2.5 py-1 tracking-normal normal-case", inDays <= 1 ? "bg-[#f07a5a] text-white" : "bg-white/10")}>{countdown(inDays)}</span>
      </span>
      <span className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="min-w-0">
          <span className={cn("block truncate font-display font-extrabold", compact ? "text-[20px]" : "text-[28px]")}>{team.name}</span>
          <span className="text-[12px] text-white/60">Yawara</span>
        </span>
        {/* Placar em "LED" */}
        <span className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-[26px] leading-none font-bold text-[#ffb08f] shadow-[inset_0_0_14px_rgba(240,122,90,0.25)]">
          <span className="tnum">0</span>
          <span className="text-white/40">:</span>
          <span className="tnum">0</span>
        </span>
        <span className="min-w-0 text-right">
          <span className={cn("block truncate font-display font-extrabold", compact ? "text-[20px]" : "text-[28px]")}>{match.opponent}</span>
          <span className="text-[12px] text-white/60">Adversário</span>
        </span>
      </span>
      <span className="relative mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-white/75">
        <span>
          {formatDate(match.date)}
          {match.time ? ` às ${match.time}` : ""}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{match.location}</span>
        </span>
      </span>
    </Link>
  );
}

/** Quadra 3D (só leitura) com a escalação do time do próximo jogo. */
function NextLineup({ team }: { team: SportTeam }) {
  const modality = courtModalityOf(team.sport);
  const [preset] = useState<CameraPreset>("side");
  const [selected, setSelected] = useState<string | null>(null);
  const can3D = useCan3D();
  const athletes = new Map(team.athletes.map((a) => [a.id, a]));
  const players: CourtPlayer[] = (team.lineup?.slots ?? []).flatMap((s) => {
    const a = athletes.get(s.athleteId);
    return a ? [{ id: a.id, x: s.x, z: s.z, number: a.number ?? "", name: a.name, short: positionShort(a.position) }] : [];
  });
  const box = "relative h-[300px] overflow-hidden rounded-[22px] border border-line bg-[radial-gradient(ellipse_at_top,#11307a,#030f45_70%)]";
  if (!modality || players.length === 0 || !can3D)
    return (
      <Link href={`/esportes/${team.id}?aba=quadra`} className={cn(box, "press grid place-items-center p-6 text-center text-white")}>
        <span>
          <Shirt className="mx-auto mb-3 size-9 text-[#ffb08f]" aria-hidden />
          <span className="block font-display text-[20px] font-bold">{!modality ? "Quadra ainda não disponível para este esporte" : players.length === 0 ? "Ainda sem escalação" : "Escalação pronta"}</span>
          <span className="mt-1 block text-[13px] text-white/70">{modality ? "Abra a quadra para montar o time do próximo jogo." : "A quadra 3D existe para futsal, vôlei, basquete e handebol."}</span>
        </span>
      </Link>
    );
  return (
    <div className={box}>
      <Court3D modality={modality} color={SPORTS_COLOR} players={players} selectedId={selected} editable={false} preset={preset} onSelect={setSelected} onMove={() => {}} />
      <Link
        href={`/esportes/${team.id}?aba=quadra`}
        className="absolute right-3 bottom-3 rounded-full bg-black/45 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur hover:bg-black/60"
      >
        Abrir a quadra →
      </Link>
      <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/40 px-3 py-1 text-[11.5px] text-white/80 backdrop-blur">
        Escalação · {team.lineup?.formation && team.lineup.formation !== "livre" ? team.lineup.formation : "livre"}
      </span>
    </div>
  );
}

function WeekList({ week, limit = 8 }: { week: WeekItem[]; limit?: number }) {
  if (week.length === 0) return <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-fg-muted">Nada marcado para os próximos 7 dias.</p>;
  return (
    <ul className="space-y-2">
      {week.slice(0, limit).map((i, k) => {
        const [, m, d] = i.date.split("-");
        const dow = new Date(`${i.date}T12:00:00Z`).getUTCDay();
        return (
          <li key={`${i.kind}-${i.team.id}-${i.date}-${i.time}-${k}`} className="anim-row" style={{ animationDelay: `${k * 45}ms` }}>
            <Link
              href={`/esportes/${i.team.id}?aba=${i.kind === "match" ? "jogos" : "treinos"}`}
              className="press flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 hover:border-line-strong"
              style={{ borderLeft: `3px solid ${i.kind === "match" ? SPORTS_COLOR : "#3fcf8e"}` }}
            >
              <span className="grid w-10 shrink-0 place-items-center leading-none">
                <span className="text-[10.5px] font-semibold text-fg-subtle uppercase">{WEEKDAY_SHORT[dow]}</span>
                <span className="tnum mt-0.5 font-mono text-[15px] font-semibold">
                  {d}/{m}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{i.kind === "match" ? `${i.team.name} × ${i.match.opponent}` : `Treino · ${i.team.name}`}</span>
                <span className="block truncate text-[12px] text-fg-muted">
                  {i.time ? `${i.time} · ` : ""}
                  {i.kind === "match" ? i.match.location : i.slot.location}
                </span>
              </span>
              {i.kind === "match" ? <Swords className="size-4 shrink-0 text-[#f07a5a]" aria-hidden /> : <Dumbbell className="size-4 shrink-0 text-ok" aria-hidden />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NumberCard({ label, value, info, icon: Icon, color, index }: { label: string; value: string; info: string; icon: LucideIcon; color: string; index: number }) {
  return (
    <div className="anim-rise" style={{ animationDelay: `${200 + index * 70}ms` }}>
      <ShowcaseCard href="/esportes" color={color} label={`${label}: ${value}`}>
        <span className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-fg-muted">{label}</span>
          <span className="grid size-9 place-items-center rounded-xl" style={{ background: `${color}22`, color }}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
        </span>
        <span className="tnum mt-3 block font-display text-[30px] leading-none font-extrabold">{value}</span>
        <span className="mt-3 block text-[12.5px] text-fg-muted">{info}</span>
      </ShowcaseCard>
    </div>
  );
}

function SeasonGrid({ numbers, compact }: { numbers: SeasonNumbers | null; compact?: boolean }) {
  const grid = cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4");
  if (!numbers) return <div className={grid}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[150px] rounded-[20px]" />)}</div>;
  const diff = numbers.scored - numbers.conceded;
  return (
    <div className={grid}>
      <NumberCard index={0} label="Jogos no mês" value={String(numbers.monthGames)} info={`${numbers.monthPlayed} já jogados · ${numbers.trainingsThisWeek} treinos na semana`} icon={CalendarPlus} color={SPORTS_COLOR} />
      <NumberCard
        index={1}
        label="Aproveitamento"
        value={numbers.efficiency === null ? "—" : `${Math.round(numbers.efficiency * 100)}%`}
        info={`${numbers.wins}V · ${numbers.draws}E · ${numbers.losses}D na temporada`}
        icon={Percent}
        color="#3fcf8e"
      />
      <NumberCard index={2} label="Saldo de gols/pontos" value={`${diff > 0 ? "+" : ""}${diff}`} info={`${numbers.scored} feitos · ${numbers.conceded} sofridos`} icon={Target} color="#e1af37" />
      <NumberCard index={3} label="Atletas" value={String(numbers.athletes)} info="Somando os elencos em atividade" icon={Users} color="#5b86d9" />
    </div>
  );
}

/** Modalidades em atividade, com campanha e escalação. */
function TeamsStrip({ teams }: { teams: SportTeam[] }) {
  const list = teams.filter((t) => t.status === "active");
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="times">
      <h2 id="times" className="mb-3 font-display text-[22px] font-bold">
        Modalidades
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((t, i) => {
          const r = teamRecord(t.matches);
          return (
            <li key={t.id} className="anim-rise" style={{ animationDelay: `${i * 50}ms` }}>
              <ShowcaseCard href={`/esportes/${t.id}`} color={SPORTS_COLOR} label={`Modalidade ${t.name}`}>
                <span className="block truncate font-display text-[19px] font-bold">{t.name}</span>
                <span className="block text-[12px] text-fg-subtle">{teamSubtitle(t)}</span>
                <span className="mt-3 flex items-center justify-between text-[12.5px]">
                  <span className="tnum font-mono">
                    <span className="text-ok">{r.wins}V</span> · <span className="text-fg-muted">{r.draws}E</span> · <span className="text-danger">{r.losses}D</span>
                  </span>
                  <span className="text-fg-muted">{t.lineup?.slots.length ? `${t.lineup.slots.length} escalados` : `${t.athletes.length} no elenco`}</span>
                </span>
              </ShowcaseCard>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------ computador ------------------------------ */

export function SportsDesktopHome() {
  const { access, query, teams, game, week, numbers, editable } = useSportsHome();
  const tiles = useSportsTiles(game, editable);
  return (
    <div className="space-y-8">
      <header className="anim-rise">
        <p className="eyebrow !text-gold-fg">
          {access.department?.name ?? "Esportes"} · {formatLongDate(new Date())}
        </p>
        <h1 className="mt-2.5 font-display text-[34px] leading-[1.08] font-bold">
          {greeting()}, {firstName(access.user?.name ?? "")}
        </h1>
        <p className="mt-2 text-[14px] text-fg-muted">O vestiário da Atlética: próximo jogo, escalação e a semana dos times.</p>
      </header>

      <section aria-label="Próximo jogo e semana" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {query.isError ? (
            <p className="rounded-[22px] border border-line p-6 text-[14px] text-fg-muted">Não foi possível carregar os esportes.</p>
          ) : !query.data ? (
            <Skeleton className="h-[460px] rounded-[22px]" />
          ) : game ? (
            <>
              <div className="anim-flip">
                <Scoreboard game={game} />
              </div>
              <NextLineup team={game.team} />
            </>
          ) : (
            <div className="grid h-[300px] place-items-center rounded-[22px] border border-dashed border-line-strong p-6 text-center">
              <span>
                <Trophy className="mx-auto mb-3 size-9 text-fg-subtle" aria-hidden />
                <span className="block font-display text-[20px] font-bold">Nenhum jogo marcado</span>
                <span className="mt-1 block text-[13px] text-fg-muted">Marque um amistoso ou um jogo de campeonato para aparecer aqui.</span>
              </span>
            </div>
          )}
        </div>
        <aside className="rounded-[22px] border border-line bg-surface p-4">
          <h2 className="mb-3 font-display text-[19px] font-bold">Esta semana</h2>
          {query.data ? <WeekList week={week} /> : <Skeleton className="h-[300px] rounded-xl" />}
        </aside>
      </section>

      {tiles.length > 0 && (
        <section aria-labelledby="fazer">
          <h2 id="fazer" className="mb-3 font-display text-[22px] font-bold">
            O que você quer fazer?
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((t, i) => (
              <Tile key={t.title} index={i} href={t.href} icon={t.icon} color={t.color} title={t.title} info={t.info} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="temporada">
        <h2 id="temporada" className="mb-3 font-display text-[22px] font-bold">
          A temporada em números
        </h2>
        <SeasonGrid numbers={numbers} />
      </section>

      <TeamsStrip teams={teams} />
    </div>
  );
}

/* -------------------------------- celular -------------------------------- */

export function SportsMobileHome() {
  const { access, query, game, week, numbers, editable } = useSportsHome();
  const tiles = useSportsTiles(game, editable).slice(0, 4);
  return (
    <div className="space-y-6">
      <header className="anim-rise">
        <p className="text-[14px] text-fg-muted">{greeting()},</p>
        <h1 className="font-display text-[30px] leading-tight font-bold">{firstName(access.user?.name ?? "")}</h1>
      </header>

      {!query.data ? (
        <Skeleton className="h-[170px] rounded-[22px]" />
      ) : game ? (
        <div className="anim-flip">
          <Scoreboard game={game} compact />
        </div>
      ) : (
        <p className="rounded-[22px] border border-dashed border-line-strong p-5 text-center text-[13px] text-fg-muted">Nenhum jogo marcado.</p>
      )}

      {tiles.length > 0 && (
        <section aria-labelledby="fazer-m">
          <h2 id="fazer-m" className="mb-3 font-display text-[20px] font-bold">
            O que você quer fazer?
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t, i) => (
              <Tile key={t.title} index={i} href={t.href} icon={t.icon} color={t.color} title={t.title} info={t.info} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="semana-m">
        <h2 id="semana-m" className="mb-3 font-display text-[20px] font-bold">
          Esta semana
        </h2>
        {query.data ? <WeekList week={week} limit={5} /> : <Skeleton className="h-[200px] rounded-xl" />}
      </section>

      <section aria-labelledby="temporada-m">
        <h2 id="temporada-m" className="mb-3 font-display text-[20px] font-bold">
          A temporada
        </h2>
        <SeasonGrid numbers={numbers} compact />
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { CalendarClock, CircleDot, Dumbbell, Goal, Hand, MapPin, Swords, Trophy, Users, Volleyball, type LucideIcon } from "lucide-react";
import type { SessionKind, SportModality, SportSession, SportTeam } from "@/types";
import { CATEGORY_LABELS, inkOn, nextSession, outcome, SESSION_KIND_LABELS, SESSION_STATUS, SPORT_RULES, teamRecord } from "@/lib/sports";
import { daysBetween, formatDate, todayDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/badges";
import { ShowcaseCard, countdownLabel } from "@/components/shared/showcase";

export const MODALITY_ICON: Record<SportModality, LucideIcon> = {
  futsal: Goal,
  volei: Volleyball,
  basquete: CircleDot,
  handebol: Hand,
};

export const SESSION_ICON: Record<SessionKind, LucideIcon> = {
  treino: Dumbbell,
  amistoso: Swords,
  campeonato: Trophy,
};

const OUTCOME_STYLE = {
  win: { label: "Vitória", short: "V", className: "bg-ok/15 text-ok" },
  draw: { label: "Empate", short: "E", className: "bg-surface-3 text-fg-muted" },
  loss: { label: "Derrota", short: "D", className: "bg-danger/15 text-danger" },
} as const;

/** "4 × 2" com a cor do resultado. */
export function ScorePill({ score, className }: { score: { us: number; them: number }; className?: string }) {
  const o = OUTCOME_STYLE[outcome(score)];
  return (
    <span className={cn("tnum inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[13px] font-bold", o.className, className)} title={o.label}>
      {score.us} × {score.them}
      <span className="sr-only">({o.label})</span>
    </span>
  );
}

/** Mini-quadra de cima com os titulares (prévia no cartão do time). */
export function MiniCourt({ team, className }: { team: SportTeam; className?: string }) {
  const rules = SPORT_RULES[team.modality];
  const w = 120;
  const h = (w * rules.width) / rules.length;
  const sx = (x: number) => ((x + rules.length / 2) / rules.length) * w;
  const sz = (z: number) => ((z + rules.width / 2) / rules.width) * h;
  return (
    <svg viewBox={`-2 -2 ${w + 4} ${h + 4}`} className={cn("block", className)} aria-hidden>
      <rect x={0} y={0} width={w} height={h} rx={3} fill="color-mix(in oklab, var(--card-color, #3fcf8e) 14%, var(--surface-2))" stroke="var(--line-strong)" />
      <line x1={w / 2} y1={0} x2={w / 2} y2={h} stroke="var(--line-strong)" />
      <circle cx={w / 2} cy={h / 2} r={h * 0.16} fill="none" stroke="var(--line-strong)" />
      {team.lineup.slots.map((s, i) => (
        <circle key={s.athleteId} cx={sx(s.x)} cy={sz(s.z)} r={3.6} fill={team.color} stroke="var(--surface)" strokeWidth={1.2} className="anim-pop" style={{ animationDelay: `${200 + i * 60}ms` }} />
      ))}
    </svg>
  );
}

export function TeamCard({ team }: { team: SportTeam }) {
  const rules = SPORT_RULES[team.modality];
  const Icon = MODALITY_ICON[team.modality];
  const record = teamRecord(team);
  const next = nextSession(team, todayDateOnly());
  const active = team.athletes.filter((a) => a.active).length;
  const days = next ? daysBetween(todayDateOnly(), next.date) : null;
  return (
    <ShowcaseCard href={`/esportes/${team.id}`} color={team.color} label={`Time ${team.name}`} className={team.status === "archived" ? "opacity-70" : undefined}>
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:rotate-12" style={{ background: `linear-gradient(145deg, ${team.color}, ${team.color}b8)`, color: inkOn(team.color) }}>
            <Icon className="size-5" strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[20px] leading-tight font-bold">{team.name}</span>
            <span className="block text-[12px] text-fg-subtle">
              {rules.label} · {CATEGORY_LABELS[team.category]}
            </span>
          </span>
        </span>
        {team.status === "archived" && <StatusBadge meta={{ label: "Arquivado", tone: "neutral" }} />}
      </span>

      <span className="mt-4 flex items-center gap-4">
        <MiniCourt team={team} className="w-[132px] shrink-0 drop-shadow-sm transition-transform duration-500 group-hover:[transform:perspective(400px)_rotateX(24deg)]" />
        <span className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
          <span>
            <span className="block text-fg-subtle">Elenco</span>
            <span className="tnum font-mono text-[15px] font-semibold">{active}</span>
          </span>
          <span>
            <span className="block text-fg-subtle">Escalados</span>
            <span className="tnum font-mono text-[15px] font-semibold">
              {team.lineup.slots.length}/{rules.starters}
            </span>
          </span>
          <span className="col-span-2">
            <span className="block text-fg-subtle">Campanha</span>
            <span className="tnum font-mono text-[13px] font-semibold">
              <span className="text-ok">{record.win}V</span> · <span className="text-fg-muted">{record.draw}E</span> · <span className="text-danger">{record.loss}D</span>
            </span>
          </span>
        </span>
      </span>

      <span className="mt-auto flex items-center gap-1.5 pt-4 text-[12.5px]">
        <CalendarClock className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        {next ? (
          <span className={cn("truncate", days !== null && days <= 2 ? "font-semibold text-gold-fg" : "text-fg-muted")}>
            {SESSION_KIND_LABELS[next.kind]}
            {next.opponent ? ` x ${next.opponent}` : ""} · {days === 0 ? "hoje" : countdownLabel(days!)} às {next.time}
          </span>
        ) : (
          <span className="text-fg-muted">Nada marcado</span>
        )}
      </span>
    </ShowcaseCard>
  );
}

/** Linha de treino/jogo: tipo, data, adversário e placar. */
export function SessionRow({
  session: s,
  team,
  onClick,
  showTeam,
}: {
  session: SportSession;
  team: SportTeam;
  onClick?: () => void;
  showTeam?: boolean;
}) {
  const Icon = SESSION_ICON[s.kind];
  const d = new Date(`${s.date}T12:00:00Z`);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  const body = (
    <>
      <span className="grid w-11 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 py-1 leading-none">
        <span className="font-mono text-[15px] font-semibold">{day}</span>
        <span className="mt-0.5 text-[10px] font-semibold tracking-wide uppercase" style={{ color: team.color }}>
          {month}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <Icon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">
            {SESSION_KIND_LABELS[s.kind]}
            {s.opponent ? ` x ${s.opponent}` : ""}
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-fg-muted">
          {showTeam && <span style={{ color: team.color }}>{team.name}</span>}
          <span>{s.time}</span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{s.location}</span>
          </span>
          {s.competition && <span className="truncate">{s.competition}</span>}
        </span>
      </span>
      {s.score ? <ScorePill score={s.score} /> : <StatusBadge meta={SESSION_STATUS[s.status]} />}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong";
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cn(cls, "press")}>
        {body}
      </button>
    );
  return (
    <Link href={`/esportes/${team.id}?aba=agenda`} className={cn(cls, "press")}>
      {body}
    </Link>
  );
}

/** Próximo jogo em destaque ("placar eletrônico"). */
export function NextGameHero({ session: s, team }: { session: SportSession; team: SportTeam }) {
  const days = daysBetween(todayDateOnly(), s.date);
  const Icon = SESSION_ICON[s.kind];
  return (
    <Link
      href={`/esportes/${team.id}?aba=agenda`}
      className="anim-flip group relative block overflow-hidden rounded-[22px] border border-line bg-[linear-gradient(135deg,#071a5c,#030f45_60%)] p-5 text-white sm:p-6"
    >
      <span aria-hidden className="absolute -top-16 -right-10 size-56 rounded-full opacity-30 blur-2xl" style={{ background: team.color }} />
      <span className="relative flex flex-wrap items-center justify-between gap-2 text-[12px] font-semibold tracking-[0.14em] text-white/70 uppercase">
        <span className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5" aria-hidden /> Próximo jogo · {SESSION_KIND_LABELS[s.kind]}
          {s.competition ? ` · ${s.competition}` : ""}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 tracking-normal normal-case">{days === 0 ? "É hoje!" : countdownLabel(days)}</span>
      </span>
      <span className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="min-w-0">
          <span className="block truncate font-display text-[22px] font-extrabold sm:text-[28px]">{team.name}</span>
          <span className="text-[12px] text-white/60">Yawara</span>
        </span>
        <span className="font-display text-[26px] font-black text-white/40 transition-transform duration-500 group-hover:scale-125">VS</span>
        <span className="min-w-0 text-right">
          <span className="block truncate font-display text-[22px] font-extrabold sm:text-[28px]">{s.opponent}</span>
          <span className="text-[12px] text-white/60">Adversário</span>
        </span>
      </span>
      <span className="relative mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-white/75">
        <span>
          {formatDate(s.date)} às {s.time}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5" aria-hidden /> {s.location}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden /> {team.lineup.slots.length} escalados
        </span>
      </span>
    </Link>
  );
}

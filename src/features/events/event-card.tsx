"use client";

import { AlertTriangle, BookOpen, Clock, HandCoins, Lightbulb, MapPin, PartyPopper, Sparkles, Trophy, Users, Wallet, type LucideIcon } from "lucide-react";
import type { AtleticaEvent, EventType } from "@/types";
import { EVENT_STATUS, EVENT_TYPE_LABELS } from "@/lib/labels";
import { daysBetween, formatMoneyCompact, formatTime, todayDateOnly } from "@/lib/format";
import { StatusBadge } from "@/components/shared/badges";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { ShowcaseCard, countdownLabel } from "@/components/shared/showcase";

/** Ícone e cor de cada tipo de evento (usados na vitrine e na prévia). */
export const EVENT_TYPE_STYLE: Record<EventType, { icon: LucideIcon; color: string }> = {
  festa: { icon: PartyPopper, color: "#e88ab5" },
  esportivo: { icon: Trophy, color: "#3fcf8e" },
  academico: { icon: BookOpen, color: "#8fb0ec" },
  integracao: { icon: Users, color: "#f2a93b" },
  arrecadacao: { icon: HandCoins, color: "#e1af37" },
  projeto: { icon: Lightbulb, color: "#b6a9ff" },
  outro: { icon: Sparkles, color: "#c5cde6" },
};

export function taskProgress(e: AtleticaEvent) {
  const done = e.tasks.filter((t) => t.status === "done").length;
  const blocked = e.tasks.filter((t) => t.status === "blocked").length;
  return { done, blocked, total: e.tasks.length };
}

/** Data grande, em formato de "ingresso". */
function BigDate({ date, color }: { date: string; color: string }) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return (
    <span className="grid w-[58px] shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2 text-center leading-none transition-transform duration-300 group-hover:-rotate-3">
      <span className="py-1 text-[10px] font-bold tracking-wider text-[#06102e] uppercase" style={{ background: color }}>
        {month}
      </span>
      <span className="pt-1.5 font-display text-[24px] font-extrabold">{day}</span>
      <span className="pb-1.5 text-[10px] text-fg-subtle capitalize">{weekday}</span>
    </span>
  );
}

export function EventCard({ event: e, ...target }: ({ href: string; onClick?: never } | { onClick: () => void; href?: never }) & { event: AtleticaEvent }) {
  const style = EVENT_TYPE_STYLE[e.type];
  const Icon = style.icon;
  const tasks = taskProgress(e);
  const days = daysBetween(todayDateOnly(), e.date);
  const open = e.status === "planning" || e.status === "confirmed";
  const pct = tasks.total ? Math.round((tasks.done / tasks.total) * 100) : 0;

  return (
    <ShowcaseCard {...target} color={style.color} label={`Evento ${e.name}`} className={e.status === "cancelled" ? "opacity-70" : undefined}>
      <span className="flex items-start gap-3.5">
        <BigDate date={e.date} color={style.color} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold" style={{ color: style.color }}>
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{EVENT_TYPE_LABELS[e.type]}</span>
            </span>
            <StatusBadge meta={EVENT_STATUS[e.status]} />
          </span>
          <span className="mt-1 line-clamp-2 block font-display text-[20px] leading-tight font-bold">{e.name}</span>
          <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden /> {formatTime(e.time)}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{e.location}</span>
            </span>
          </span>
        </span>
      </span>

      <span className="mt-4 block">
        <span className="flex items-center justify-between text-[12px]">
          <span className="text-fg-subtle">Tarefas</span>
          <span className="tnum font-mono text-fg-muted">{tasks.total ? `${tasks.done}/${tasks.total} · ${pct}%` : "nenhuma ainda"}</span>
        </span>
        <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          {tasks.total > 0 && (
            <>
              <span className="anim-grow h-full" style={{ width: `${(tasks.done / tasks.total) * 100}%`, background: style.color }} />
              <span className="anim-grow h-full bg-warn" style={{ width: `${(tasks.blocked / tasks.total) * 100}%` }} />
            </>
          )}
        </span>
      </span>

      <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className="flex items-center gap-3 text-[12.5px]">
          {open && days >= 0 && <span className={days <= 7 ? "font-semibold text-gold-fg" : "text-fg-muted"}>{days === 0 ? "É hoje!" : `Acontece ${countdownLabel(days)}`}</span>}
          {open && days < 0 && <span className="text-fg-muted">Data passou</span>}
          {tasks.blocked > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-warn">
              <AlertTriangle className="size-3.5" aria-hidden /> {tasks.blocked} bloqueada{tasks.blocked > 1 ? "s" : ""}
            </span>
          )}
          {e.budget ? (
            <span className="hidden items-center gap-1 text-fg-muted sm:inline-flex">
              <Wallet className="size-3.5" aria-hidden /> {formatMoneyCompact(e.budget)}
            </span>
          ) : null}
        </span>
        <span className="flex -space-x-2">
          {e.responsibleIds.slice(0, 4).map((id) => (
            <MemberAvatar key={id} id={id} size={26} className="ring-2 ring-surface" />
          ))}
          {e.responsibleIds.length > 4 && (
            <span className="grid size-[26px] place-items-center rounded-full bg-surface-3 text-[10px] font-semibold ring-2 ring-surface">+{e.responsibleIds.length - 4}</span>
          )}
        </span>
      </span>
    </ShowcaseCard>
  );
}

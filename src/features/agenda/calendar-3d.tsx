"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";
import { formatLongDate, formatMonth, todayDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/misc";
import { AGENDA_KINDS, groupByDay, monthGrid, type AgendaItem, type AgendaKind } from "./agenda";
import { useAgenda } from "./use-agenda";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const KINDS = Object.keys(AGENDA_KINDS) as AgendaKind[];

function KindDot({ kind, className }: { kind: AgendaKind; className?: string }) {
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", className)} style={{ background: AGENDA_KINDS[kind].color }} aria-hidden />;
}

/** Lista do dia escolhido, usada ao lado (computador) ou abaixo (celular) do calendário. */
export function DayAgenda({ date, items, className }: { date: string; items: AgendaItem[]; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <p className="font-display text-[19px] leading-tight font-bold first-letter:uppercase">{formatLongDate(date)}</p>
      {items.length === 0 ? (
        <p className="text-[13px] text-fg-muted">Nada marcado para este dia.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={it.id} className="anim-row" style={{ animationDelay: `${i * 60}ms` }}>
              <Link
                href={it.href}
                className="press flex gap-3 rounded-xl border border-line bg-surface-2 p-3 hover:border-line-strong"
                style={{ borderLeft: `3px solid ${AGENDA_KINDS[it.kind].color}` }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold leading-snug">{it.title}</span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-fg-muted">
                    {it.time && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden /> {it.time}
                      </span>
                    )}
                    {it.detail && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        {it.kind !== "deadline" && <MapPin className="size-3.5 shrink-0" aria-hidden />}
                        <span className="truncate">{it.detail}</span>
                      </span>
                    )}
                  </span>
                </span>
                <span className="self-start rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: `${AGENDA_KINDS[it.kind].color}26`, color: AGENDA_KINDS[it.kind].color }}>
                  {AGENDA_KINDS[it.kind].label.replace(/s$/, "")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Calendário do mês com leve perspectiva 3D: o mês "vira" ao trocar,
 * os dias entram em sequência e cada tipo de compromisso tem sua cor.
 */
export function Calendar3D({ className }: { className?: string }) {
  const today = todayDateOnly();
  const [ty, tm] = today.split("-").map(Number);
  const [cursor, setCursor] = useState({ y: ty, m: tm - 1 });
  const [selected, setSelected] = useState(today);
  const [hidden, setHidden] = useState<AgendaKind[]>([]);
  const { items, loading, error, retry } = useAgenda();

  const visible = useMemo(() => items.filter((i) => !hidden.includes(i.kind)), [items, hidden]);
  const byDay = useMemo(() => groupByDay(visible), [visible]);
  const cells = monthGrid(cursor.y, cursor.m);
  const monthKey = `${cursor.y}-${cursor.m}`;
  const monthCount = visible.filter((i) => i.date.startsWith(`${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`)).length;

  const move = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });
  const goToday = () => {
    setCursor({ y: ty, m: tm - 1 });
    setSelected(today);
  };

  return (
    <section className={cn("overflow-hidden rounded-2xl border border-line bg-surface", className)} aria-label="Agenda da Atlética">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Agenda da Atlética</p>
          <h2 key={monthKey} className="mt-1.5 font-display text-[24px] leading-none font-bold first-letter:uppercase [animation:flip-in_.5s_ease_both]" style={{ transformOrigin: "top" }}>
            {formatMonth(cursor.y, cursor.m)}
          </h2>
        </div>
        <span className="hidden text-[12.5px] text-fg-muted sm:inline">{monthCount === 1 ? "1 compromisso" : `${monthCount} compromissos`}</span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={goToday} className="press h-9 rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">
            Hoje
          </button>
          <button type="button" onClick={() => move(-1)} aria-label="Mês anterior" className="press grid size-9 place-items-center rounded-lg border border-line-strong hover:bg-surface-2">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Próximo mês" className="press grid size-9 place-items-center rounded-lg border border-line-strong hover:bg-surface-2">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div role="group" aria-label="Mostrar na agenda" className="flex gap-2 overflow-x-auto px-4 pt-3 sm:px-5">
        {KINDS.map((k) => {
          const on = !hidden.includes(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setHidden((h) => (on ? [...h, k] : h.filter((x) => x !== k)))}
              className={cn("press flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-opacity", on ? "border-line-strong bg-surface-2" : "border-line opacity-50")}
            >
              <KindDot kind={k} className="size-2" />
              {AGENDA_KINDS[k].label}
            </button>
          );
        })}
      </div>

      {error ? (
        <ErrorState className="py-10" message={errorMessage(error, "Não foi possível carregar a agenda.")} onRetry={retry} />
      ) : (
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="[perspective:1100px] lg:pb-2">
            <div className="origin-top transition-transform duration-500 lg:[transform:rotateX(8deg)] lg:hover:[transform:rotateX(0deg)]" style={{ transformStyle: "preserve-3d" }}>
              <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-fg-subtle" aria-hidden>
                {WEEKDAYS.map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
              {loading ? (
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square lg:aspect-[1.15]" />
                  ))}
                </div>
              ) : (
                <div key={monthKey} className="grid grid-cols-7 gap-1.5">
                  {cells.map((date, i) => {
                    if (!date) return <span key={`b${i}`} aria-hidden />;
                    const list = byDay.get(date) ?? [];
                    const isToday = date === today;
                    const isSel = date === selected;
                    const kinds = [...new Set(list.map((x) => x.kind))];
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => setSelected(date)}
                        aria-pressed={isSel}
                        aria-label={`${formatLongDate(date)}${list.length ? `, ${list.length} ${list.length === 1 ? "compromisso" : "compromissos"}` : ""}`}
                        className={cn(
                          "press relative flex aspect-square flex-col items-center justify-start gap-1 rounded-xl border p-1 text-[13px] font-semibold lg:aspect-[1.15] lg:items-start lg:p-2",
                          isSel ? "border-gold bg-gold/15 shadow-[0_8px_24px_-8px_rgba(225,175,55,0.5)]" : list.length ? "border-line-strong bg-surface-2 hover:border-gold/40" : "border-line bg-sunken/60 hover:border-line-strong",
                        )}
                        style={{ animation: `tile-in .45s cubic-bezier(.2,1.2,.4,1) ${Math.min(i * 14, 500)}ms both` }}
                      >
                        <span className={cn("grid size-6 place-items-center rounded-full tnum", isToday && "bg-gold text-gold-ink")}>{Number(date.slice(8))}</span>
                        {kinds.length > 0 && (
                          <span className="flex gap-0.5 lg:hidden">
                            {kinds.slice(0, 3).map((k) => (
                              <KindDot key={k} kind={k} />
                            ))}
                          </span>
                        )}
                        <span className="hidden w-full min-w-0 flex-col gap-0.5 lg:flex">
                          {list.slice(0, 2).map((it) => (
                            <span key={it.id} className="flex min-w-0 items-center gap-1 text-[10.5px] font-medium text-fg-muted">
                              <KindDot kind={it.kind} />
                              <span className="truncate">{it.title}</span>
                            </span>
                          ))}
                          {list.length > 2 && <span className="text-[10px] text-fg-subtle">+{list.length - 2}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DayAgenda key={selected} date={selected} items={byDay.get(selected) ?? []} className="lg:border-l lg:border-line lg:pl-5" />
        </div>
      )}
    </section>
  );
}

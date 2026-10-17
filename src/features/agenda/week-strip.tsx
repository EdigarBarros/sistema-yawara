"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { todayDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { ErrorState } from "@/components/shared/states";
import { AGENDA_KINDS, groupByDay, weekOf } from "./agenda";
import { DayAgenda } from "./calendar-3d";
import { useAgenda } from "./use-agenda";

const SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Semana atual em faixa de toque, para a tela inicial do celular. */
export function WeekStrip({ className }: { className?: string }) {
  const today = todayDateOnly();
  const [selected, setSelected] = useState(today);
  const { items, error, retry } = useAgenda();
  const byDay = useMemo(() => groupByDay(items), [items]);
  const week = weekOf(today);

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label="Sua semana">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Sua semana</h2>
        <Link href="/agenda" className="inline-flex items-center gap-1 text-[13px] font-medium text-gold-fg">
          Agenda completa <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {error ? (
        <ErrorState className="py-6" message={errorMessage(error, "Não foi possível carregar a agenda.")} onRetry={retry} />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5">
            {week.map((date, i) => {
              const list = byDay.get(date) ?? [];
              const isSel = date === selected;
              const kinds = [...new Set(list.map((x) => x.kind))];
              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={isSel}
                  onClick={() => setSelected(date)}
                  className={cn(
                    "press flex h-[68px] flex-col items-center justify-center gap-1 rounded-2xl border",
                    isSel ? "border-gold bg-gold text-gold-ink" : date === today ? "border-gold/50 bg-surface-2" : "border-line bg-surface",
                  )}
                  style={{ animation: `pop .35s cubic-bezier(.2,1.2,.4,1) ${i * 45}ms both` }}
                >
                  <span className={cn("text-[10.5px] font-semibold", isSel ? "text-gold-ink/80" : "text-fg-subtle")}>{SHORT[i]}</span>
                  <span className="font-display text-[19px] leading-none font-bold tnum">{Number(date.slice(8))}</span>
                  <span className="flex h-1.5 gap-0.5">
                    {kinds.slice(0, 3).map((k) => (
                      <span key={k} className="size-1.5 rounded-full" style={{ background: isSel ? "currentColor" : AGENDA_KINDS[k].color }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <DayAgenda key={selected} date={selected} items={byDay.get(selected) ?? []} />
        </>
      )}
    </section>
  );
}

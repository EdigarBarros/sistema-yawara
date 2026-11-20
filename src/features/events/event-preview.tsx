"use client";

import { useMemo } from "react";
import { ArrowRight, CheckCircle2, Circle, Clock, Copy, ListChecks, MapPin, Wallet } from "lucide-react";
import type { AtleticaEvent } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory } from "@/hooks/use-data";
import { EVENT_STATUS, EVENT_TYPE_LABELS, SUPPLIER_STATUS, TASK_STATUS } from "@/lib/labels";
import { daysBetween, formatDate, formatLongDate, formatMoney, formatTime, todayDateOnly } from "@/lib/format";
import { canSeeEventFinance } from "@/lib/policies";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { SectionTitle } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/badges";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { ProgressRing, countdownLabel } from "@/components/shared/showcase";
import { EVENT_TYPE_STYLE, taskProgress } from "./event-card";

/** Prévia lateral de um evento: o que falta fazer, a programação e quem está cuidando. */
export function EventPreview({ event, onClose, onDuplicate }: { event: AtleticaEvent | null; onClose: () => void; onDuplicate: (e: AtleticaEvent) => void }) {
  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      {event && <PreviewBody event={event} onDuplicate={onDuplicate} />}
    </Sheet>
  );
}

function PreviewBody({ event: e, onDuplicate }: { event: AtleticaEvent; onDuplicate: (e: AtleticaEvent) => void }) {
  const access = useAccess();
  const dir = useDirectory();
  const style = EVENT_TYPE_STYLE[e.type];
  const Icon = style.icon;
  const tasks = taskProgress(e);
  const days = daysBetween(todayDateOnly(), e.date);
  const href = `/eventos/${e.id}`;
  const showBudget = !!access.ctx && canSeeEventFinance(access.ctx, e);

  // Tarefas em aberto agrupadas por departamento, bloqueadas primeiro.
  const openByDep = useMemo(() => {
    const order = { blocked: 0, doing: 1, todo: 2, done: 3 } as const;
    const map = new Map<string, typeof e.tasks>();
    for (const t of e.tasks) if (t.status !== "done") map.set(t.departmentId, [...(map.get(t.departmentId) ?? []), t]);
    return [...map.entries()].map(([dep, list]) => [dep, [...list].sort((a, b) => order[a.status] - order[b.status])] as const);
  }, [e]);
  const schedule = [...e.schedule].sort((a, b) => a.time.localeCompare(b.time));
  const suppliers = e.suppliers.filter((s) => s.status !== "declined");

  return (
    <SheetContent
      width="lg"
      eyebrow={
        <span className="flex items-center gap-2 normal-case tracking-normal">
          <span className="font-mono">{e.code}</span>
          <StatusBadge meta={EVENT_STATUS[e.status]} />
        </span>
      }
      title={e.name}
      description={dir.department(e.departmentId)?.name}
      footer={
        <>
          <ButtonLink href={href} variant="primary">
            Abrir evento <ArrowRight />
          </ButtonLink>
          <ButtonLink href={`${href}?aba=tarefas`}>
            <ListChecks /> Ver tarefas
          </ButtonLink>
          {access.can("events.create") && (
            <Button variant="ghost" onClick={() => onDuplicate(e)}>
              <Copy /> Duplicar
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-7">
        {/* Ingresso: data, local e contagem regressiva */}
        <div className="anim-flip relative overflow-hidden rounded-2xl border border-line bg-surface-2">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: style.color }} />
          <div className="flex flex-wrap items-center gap-5 p-4 pl-6">
            <ProgressRing value={tasks.done} max={Math.max(1, tasks.total)} size={96} stroke={8} color={style.color} label={`${tasks.done} de ${tasks.total} tarefas concluídas`}>
              <span className="tnum block font-display text-[22px] font-extrabold">{tasks.total ? `${Math.round((tasks.done / tasks.total) * 100)}%` : "—"}</span>
              <span className="mt-0.5 block text-[10.5px] text-fg-subtle">das tarefas</span>
            </ProgressRing>
            <div className="min-w-0 flex-1 space-y-1.5 text-[13px]">
              <p className="inline-flex items-center gap-1.5 font-semibold" style={{ color: style.color }}>
                <Icon className="size-4" aria-hidden /> {EVENT_TYPE_LABELS[e.type]}
              </p>
              <p className="font-display text-[18px] leading-tight font-bold first-letter:uppercase">{formatLongDate(e.date)}</p>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-fg-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden /> {formatTime(e.time)}
                </span>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin className="size-3.5 shrink-0" aria-hidden /> {e.location}
                </span>
              </p>
              {(e.status === "planning" || e.status === "confirmed") && (
                <p className={days >= 0 && days <= 7 ? "font-semibold text-gold-fg" : "text-fg-muted"}>{days === 0 ? "É hoje!" : days > 0 ? `Acontece ${countdownLabel(days)}` : `A data passou ${countdownLabel(days)}`}</p>
              )}
              {showBudget && e.budget ? (
                <p className="inline-flex items-center gap-1.5 text-fg-muted">
                  <Wallet className="size-3.5" aria-hidden /> Orçamento previsto: <b className="text-fg">{formatMoney(e.budget)}</b>
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {(e.objective || e.description) && (
          <section>
            <SectionTitle>Sobre</SectionTitle>
            {e.objective && <p className="text-[13.5px] leading-relaxed text-fg">{e.objective}</p>}
            {e.description && <p className="mt-2 line-clamp-4 text-[13px] leading-relaxed text-fg-muted">{e.description}</p>}
          </section>
        )}

        <section>
          <SectionTitle>Responsáveis</SectionTitle>
          <ul className="flex flex-wrap gap-2">
            {e.responsibleIds.length === 0 && <li className="text-[13px] text-fg-muted">Ninguém designado ainda.</li>}
            {e.responsibleIds.map((id) => (
              <li key={id} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 py-1 pr-3 pl-1 text-[12.5px]">
                <MemberAvatar id={id} size={24} />
                {dir.memberName(id)}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionTitle>{tasks.total - tasks.done > 0 ? `O que falta (${tasks.total - tasks.done})` : "Tarefas"}</SectionTitle>
          {openByDep.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-[13px] text-fg-muted">
              <CheckCircle2 className="size-4 text-ok" aria-hidden /> {tasks.total ? "Todas as tarefas estão concluídas." : "Nenhuma tarefa cadastrada."}
            </p>
          ) : (
            <div className="space-y-4">
              {openByDep.map(([dep, list]) => (
                <div key={dep}>
                  <p className="mb-1.5 text-[12px] font-semibold text-fg-subtle">{dir.department(dep)?.name ?? "Sem departamento"}</p>
                  <ul className="space-y-1.5">
                    {list.slice(0, 5).map((t, i) => (
                      <li key={t.id} className="anim-row flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px]" style={{ animationDelay: `${i * 50}ms` }}>
                        <Circle className={`size-3.5 shrink-0 ${t.status === "blocked" ? "text-warn" : t.status === "doing" ? "text-info" : "text-fg-subtle"}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.dueDate && <span className="tnum shrink-0 font-mono text-[11.5px] text-fg-subtle">{formatDate(t.dueDate)}</span>}
                        <StatusBadge meta={TASK_STATUS[t.status]} />
                      </li>
                    ))}
                    {list.length > 5 && <li className="text-[12px] text-fg-subtle">e mais {list.length - 5}</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {schedule.length > 0 && (
          <section>
            <SectionTitle>Programação</SectionTitle>
            <ol className="relative space-y-3 border-l border-line pl-4">
              {schedule.slice(0, 6).map((s) => (
                <li key={s.id} className="relative text-[13px]">
                  <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-surface" style={{ background: style.color }} />
                  <span className="tnum mr-2 font-mono text-fg-subtle">{s.time}</span>
                  {s.title}
                </li>
              ))}
              {schedule.length > 6 && <li className="text-[12px] text-fg-subtle">e mais {schedule.length - 6} itens</li>}
            </ol>
          </section>
        )}

        {suppliers.length > 0 && (
          <section>
            <SectionTitle>Fornecedores</SectionTitle>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {suppliers.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block truncate text-[12px] text-fg-subtle">{s.service}</span>
                  </span>
                  <StatusBadge meta={SUPPLIER_STATUS[s.status]} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </SheetContent>
  );
}

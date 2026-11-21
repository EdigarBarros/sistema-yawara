"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, CalendarDays, CalendarPlus, ClipboardList, ListChecks, ListPlus, Ticket, Truck, type LucideIcon } from "lucide-react";
import type { AtleticaEvent } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useCan3D } from "@/hooks/use-can-3d";
import { useEvents } from "@/hooks/use-data";
import { canEditTasks } from "@/lib/policies";
import { EVENT_STATUS, EVENT_TYPE_LABELS, TASK_STATUS } from "@/lib/labels";
import { firstName, formatDate, formatLongDate, formatTime, greeting, todayDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/misc";
import { StatusBadge } from "@/components/shared/badges";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { ProgressRing, ShowcaseCard } from "@/components/shared/showcase";
import { EVENT_TYPE_STYLE } from "@/features/events/event-card";
import { eventCountdown, eventNumbers, nextEvent, taskBoard, type BoardColumn, type BoardTask, type EventNumbers, type NextEvent } from "@/features/events/home-rules";
import type { TicketInfo } from "@/features/events/event-ticket-3d";
import { Tile } from "./presidency-mobile";

const EventTicket3D = dynamic(() => import("@/features/events/event-ticket-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

const EVENTS_COLOR = "#f2a93b";

/* --------------------------------- dados --------------------------------- */

function useEventsHome() {
  const access = useAccess();
  const query = useEvents();
  const today = todayDateOnly();
  const events = useMemo(() => query.data ?? [], [query.data]);
  const next = useMemo(() => (query.data ? nextEvent(events, today) : null), [query.data, events, today]);
  const board = useMemo(() => taskBoard(events, today), [events, today]);
  const numbers = useMemo(() => (query.data ? eventNumbers(events, today) : null), [query.data, events, today]);
  return { access, query, next, board, numbers };
}

function useEventTiles(next: NextEvent | null) {
  const access = useAccess();
  const can = (p: Parameters<typeof access.can>[0]) => access.can(p) && access.moduleEnabled(p.split(".")[0] as never);
  const canTask = !!next && !!access.ctx && canEditTasks(access.ctx, next.event);
  const tiles: { href: string; icon: LucideIcon; color: string; title: string; info: string; show: boolean }[] = [
    { href: "/eventos?novo=1", icon: CalendarPlus, color: EVENTS_COLOR, title: "Novo evento", info: "Festa, jogos, palestra…", show: can("events.create") },
    { href: next ? `/eventos/${next.event.id}?aba=tarefas&novo=tarefa` : "/eventos", icon: ListPlus, color: "#3fcf8e", title: "Nova tarefa", info: next ? `Para ${next.event.name}` : "", show: canTask },
    { href: next ? `/eventos/${next.event.id}?aba=tarefas` : "/eventos", icon: ClipboardList, color: "#5b86d9", title: "Programação", info: next ? `Horários de ${next.event.name}` : "", show: !!next },
    { href: "/campanhas/nova", icon: Ticket, color: "#e1af37", title: "Nova rifa", info: "Arrecadar para o evento", show: can("campaigns.create") },
    { href: "/agenda", icon: CalendarDays, color: "#b6a9ff", title: "Agenda", info: "Tudo que está marcado", show: true },
  ];
  return tiles.filter((t) => t.show);
}

/* -------------------------------- peças -------------------------------- */

function ticketInfo(e: AtleticaEvent): TicketInfo {
  const d = new Date(`${e.date}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return {
    eyebrow: `Próximo evento · ${EVENT_TYPE_LABELS[e.type]}`,
    name: e.name,
    dateLine: `${formatLongDate(e.date)} · ${formatTime(e.time)}`.replace(/^./, (c) => c.toUpperCase()),
    placeLine: e.location,
    day: String(d.getUTCDate()).padStart(2, "0"),
    month,
    color: EVENT_TYPE_STYLE[e.type].color,
  };
}

/** Ingresso em CSS (celular, sem WebGL ou com movimento reduzido). */
function FlatTicket({ next, compact }: { next: NextEvent; compact?: boolean }) {
  const info = ticketInfo(next.event);
  return (
    <Link
      href={`/eventos/${next.event.id}`}
      className="anim-flip relative flex overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#0d2a7a,#030f45)] text-white shadow-[0_20px_40px_-20px_rgba(3,15,69,0.8)]"
      style={{ borderLeft: `6px solid ${info.color}` }}
    >
      <span className="min-w-0 flex-1 p-4">
        <span className="block text-[11px] font-bold tracking-[0.12em] uppercase" style={{ color: info.color }}>
          {info.eyebrow}
        </span>
        <span className={cn("mt-1 line-clamp-2 block font-display leading-tight font-extrabold", compact ? "text-[22px]" : "text-[26px]")}>{info.name}</span>
        <span className="mt-2 block text-[12.5px] text-white/75">{info.dateLine}</span>
        <span className="block truncate text-[12px] text-white/55">{info.placeLine}</span>
      </span>
      <span className="grid w-[92px] shrink-0 place-items-center border-l-2 border-dashed border-white/25 text-center">
        <span>
          <span className="block text-[12px] font-bold uppercase" style={{ color: info.color }}>
            {info.month}
          </span>
          <span className="block font-display text-[40px] leading-none font-extrabold">{info.day}</span>
          <span className="mt-1 block text-[10px] tracking-wider text-white/55">ENTRADA</span>
        </span>
      </span>
    </Link>
  );
}

/** Resumo do próximo evento: contagem, tarefas, responsáveis e fornecedores. */
function NextEventCard({ next }: { next: NextEvent }) {
  const e = next.event;
  const style = EVENT_TYPE_STYLE[e.type];
  const hired = e.suppliers.filter((s) => s.status === "hired").length;
  const quoted = e.suppliers.filter((s) => s.status === "quoted").length;
  const blocked = e.tasks.filter((t) => t.status === "blocked").length;
  return (
    <div className="flex h-full flex-col rounded-[22px] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <p className={cn("font-display text-[30px] leading-none font-extrabold", next.inDays <= 7 ? "text-gold-fg" : "text-fg")}>{eventCountdown(next.inDays)}</p>
        <StatusBadge meta={EVENT_STATUS[e.status]} />
      </div>
      <div className="mt-5 flex items-center gap-4">
        <ProgressRing value={next.done} max={Math.max(1, next.total)} size={92} stroke={8} color={style.color} label={`${next.done} de ${next.total} tarefas concluídas`}>
          <span className="tnum block font-display text-[22px] font-extrabold">{next.total ? `${Math.round((next.done / next.total) * 100)}%` : "—"}</span>
          <span className="mt-0.5 block text-[10.5px] text-fg-subtle">pronto</span>
        </ProgressRing>
        <dl className="min-w-0 flex-1 space-y-1.5 text-[13px]">
          <div className="flex justify-between gap-2">
            <dt className="text-fg-muted">Tarefas</dt>
            <dd className="tnum font-mono font-semibold">
              {next.done}/{next.total}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-fg-muted">Bloqueadas</dt>
            <dd className={cn("tnum font-mono font-semibold", blocked ? "text-warn" : "")}>{blocked}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-fg-muted">Fornecedores</dt>
            <dd className="tnum font-mono font-semibold">
              {hired} fechados{quoted ? ` · ${quoted} em orçamento` : ""}
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="flex -space-x-2">
          {e.responsibleIds.slice(0, 5).map((id) => (
            <MemberAvatar key={id} id={id} size={30} className="ring-2 ring-surface" />
          ))}
        </span>
        <Link href={`/eventos/${e.id}`} className="text-[13.5px] font-semibold text-gold-fg hover:underline">
          Abrir evento →
        </Link>
      </div>
    </div>
  );
}

const COLUMNS: { key: BoardColumn; title: string }[] = [
  { key: "todo", title: "A fazer" },
  { key: "doing", title: "Em andamento" },
  { key: "blocked", title: "Bloqueadas" },
];

function TaskCard({ item, index }: { item: BoardTask; index: number }) {
  const style = EVENT_TYPE_STYLE[item.event.type];
  return (
    <li className="anim-rise" style={{ animationDelay: `${index * 50}ms` }}>
      <Link
        href={`/eventos/${item.event.id}?aba=tarefas`}
        className={cn("press block rounded-xl border bg-surface p-3 hover:border-line-strong", item.overdue ? "border-danger/50" : "border-line")}
        style={{ borderLeft: `3px solid ${style.color}` }}
      >
        <span className="line-clamp-2 block text-[13.5px] font-semibold">{item.task.title}</span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[11.5px]">
          <span className="truncate text-fg-subtle">{item.event.name}</span>
          {item.task.dueDate && (
            <span className={cn("tnum shrink-0 font-mono", item.overdue ? "font-semibold text-danger" : "text-fg-muted")}>
              {item.overdue ? "atrasada · " : ""}
              {formatDate(item.task.dueDate).slice(0, 5)}
            </span>
          )}
        </span>
        {item.task.responsibleId && (
          <span className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-muted">
            <MemberAvatar id={item.task.responsibleId} size={18} />
          </span>
        )}
      </Link>
    </li>
  );
}

/** Quadro das tarefas em aberto dos próximos eventos. */
function TaskBoard({ board }: { board: Record<BoardColumn, BoardTask[]> }) {
  const total = board.todo.length + board.doing.length + board.blocked.length;
  if (total === 0) return <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-fg-muted">Nenhuma tarefa em aberto nos próximos eventos.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {COLUMNS.map((col) => (
        <section key={col.key} className="rounded-[18px] border border-line bg-surface-2/50 p-3">
          <h3 className="mb-2.5 flex items-center justify-between px-1">
            <StatusBadge meta={TASK_STATUS[col.key]} />
            <span className="tnum font-mono text-[12px] text-fg-subtle">{board[col.key].length}</span>
          </h3>
          <ul className="space-y-2">
            {board[col.key].slice(0, 5).map((item, i) => (
              <TaskCard key={item.task.id} item={item} index={i} />
            ))}
          </ul>
          {board[col.key].length > 5 && <p className="mt-2 px-1 text-[12px] text-fg-subtle">e mais {board[col.key].length - 5}</p>}
        </section>
      ))}
    </div>
  );
}

function NumberCard({ label, value, info, icon: Icon, color, index, alert }: { label: string; value: number; info: string; icon: LucideIcon; color: string; index: number; alert?: boolean }) {
  return (
    <div className="anim-rise" style={{ animationDelay: `${200 + index * 70}ms` }}>
      <ShowcaseCard href="/eventos" color={color} label={`${label}: ${value}`}>
        <span className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-fg-muted">{label}</span>
          <span className="grid size-9 place-items-center rounded-xl" style={{ background: `${color}22`, color }}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
        </span>
        <span className={cn("tnum mt-3 block font-display text-[30px] leading-none font-extrabold", alert && value > 0 && "text-danger")}>{value}</span>
        <span className="mt-3 block text-[12.5px] text-fg-muted">{info}</span>
      </ShowcaseCard>
    </div>
  );
}

function NumbersGrid({ numbers, compact }: { numbers: EventNumbers | null; compact?: boolean }) {
  const grid = cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4");
  if (!numbers) return <div className={grid}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[150px] rounded-[20px]" />)}</div>;
  return (
    <div className={grid}>
      <NumberCard index={0} label="Eventos no mês" value={numbers.monthEvents} info={`${numbers.monthConfirmed} confirmados ou feitos`} icon={CalendarDays} color={EVENTS_COLOR} />
      <NumberCard index={1} label="Tarefas abertas" value={numbers.openTasks} info={numbers.blocked ? `${numbers.blocked} bloqueada${numbers.blocked > 1 ? "s" : ""}` : "Nenhuma bloqueada"} icon={ListChecks} color="#3fcf8e" />
      <NumberCard index={2} label="Atrasadas" value={numbers.overdue} info={numbers.overdue ? "Prazo já passou" : "Tudo no prazo"} icon={AlertTriangle} color="#e5484d" alert />
      <NumberCard index={3} label="Fornecedores a fechar" value={numbers.suppliersToClose} info="Só com orçamento" icon={Truck} color="#5b86d9" />
    </div>
  );
}

/* ------------------------------ computador ------------------------------ */

export function EventsDesktopHome() {
  const { access, query, next, board, numbers } = useEventsHome();
  const tiles = useEventTiles(next);
  const can3D = useCan3D();
  const info = useMemo(() => (next ? ticketInfo(next.event) : null), [next]);
  return (
    <div className="space-y-8">
      <header className="anim-rise">
        <p className="eyebrow !text-gold-fg">
          {access.department?.name ?? "Eventos"} · {formatLongDate(new Date())}
        </p>
        <h1 className="mt-2.5 font-display text-[34px] leading-[1.08] font-bold">
          {greeting()}, {firstName(access.user?.name ?? "")}
        </h1>
        <p className="mt-2 text-[14px] text-fg-muted">O próximo evento, o que falta fazer e como está o mês.</p>
      </header>

      <section aria-label="Próximo evento" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {query.isError ? (
          <p className="rounded-[22px] border border-line p-6 text-[14px] text-fg-muted">Não foi possível carregar os eventos.</p>
        ) : !query.data ? (
          <Skeleton className="h-[360px] rounded-[22px]" />
        ) : next && info ? (
          can3D ? (
            <Link href={`/eventos/${next.event.id}`} aria-label={`Abrir ${next.event.name}`} className="relative block h-[360px] overflow-hidden rounded-[22px] border border-line bg-[radial-gradient(ellipse_at_center,#173a96,#030f45_72%)]">
              <EventTicket3D info={info} />
              <span className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/35 px-3 py-1 text-[11.5px] text-white/75 backdrop-blur">Mexa o mouse para inclinar o ingresso · clique para abrir</span>
            </Link>
          ) : (
            <div className="grid h-[360px] place-items-center rounded-[22px] border border-line bg-[radial-gradient(ellipse_at_center,#173a96,#030f45_72%)] p-8">
              <div className="w-full max-w-xl">
                <FlatTicket next={next} />
              </div>
            </div>
          )
        ) : (
          <div className="grid h-[360px] place-items-center rounded-[22px] border border-dashed border-line-strong p-6 text-center">
            <span>
              <CalendarDays className="mx-auto mb-3 size-9 text-fg-subtle" aria-hidden />
              <span className="block font-display text-[20px] font-bold">Nenhum evento marcado</span>
              <span className="mt-1 block text-[13px] text-fg-muted">Crie um evento para ver a contagem e as tarefas aqui.</span>
            </span>
          </div>
        )}
        {next ? <NextEventCard next={next} /> : <div className="hidden xl:block" />}
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

      <section aria-labelledby="quadro">
        <h2 id="quadro" className="mb-3 font-display text-[22px] font-bold">
          Tarefas dos próximos eventos
        </h2>
        {query.data ? <TaskBoard board={board} /> : <Skeleton className="h-[220px] rounded-[18px]" />}
      </section>

      <section aria-labelledby="mes">
        <h2 id="mes" className="mb-3 font-display text-[22px] font-bold">
          O mês em números
        </h2>
        <NumbersGrid numbers={numbers} />
      </section>
    </div>
  );
}

/* -------------------------------- celular -------------------------------- */

export function EventsMobileHome() {
  const { access, query, next, board, numbers } = useEventsHome();
  const tiles = useEventTiles(next).slice(0, 4);
  const urgent = [...board.blocked, ...board.todo, ...board.doing].sort((a, b) => Number(b.overdue) - Number(a.overdue)).slice(0, 5);
  return (
    <div className="space-y-6">
      <header className="anim-rise">
        <p className="text-[14px] text-fg-muted">{greeting()},</p>
        <h1 className="font-display text-[30px] leading-tight font-bold">{firstName(access.user?.name ?? "")}</h1>
      </header>

      {!query.data ? (
        <Skeleton className="h-[150px] rounded-[22px]" />
      ) : next ? (
        <div className="space-y-2">
          <FlatTicket next={next} compact />
          <p className={cn("px-1 text-[14px] font-semibold", next.inDays <= 7 ? "text-gold-fg" : "text-fg-muted")}>
            {eventCountdown(next.inDays)} · {next.done}/{next.total} tarefas prontas
          </p>
        </div>
      ) : (
        <p className="rounded-[22px] border border-dashed border-line-strong p-5 text-center text-[13px] text-fg-muted">Nenhum evento marcado.</p>
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

      {urgent.length > 0 && (
        <section aria-labelledby="tarefas-m">
          <h2 id="tarefas-m" className="mb-3 font-display text-[20px] font-bold">
            Tarefas que pedem atenção
          </h2>
          <ul className="space-y-2">
            {urgent.map((item, i) => (
              <TaskCard key={item.task.id} item={item} index={i} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="mes-m">
        <h2 id="mes-m" className="mb-3 font-display text-[20px] font-bold">
          O mês em números
        </h2>
        <NumbersGrid numbers={numbers} compact />
      </section>
    </div>
  );
}

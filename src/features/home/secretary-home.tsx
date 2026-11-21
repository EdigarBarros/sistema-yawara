"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { CalendarDays, ClipboardCheck, ClipboardPlus, FileDown, FilePlus2, FolderOpen, ListChecks, MapPin, type LucideIcon } from "lucide-react";
import type { Meeting } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useMeetings } from "@/hooks/use-data";
import { MEETING_MODE_LABELS } from "@/lib/labels";
import { daysBetween, firstName, formatDate, formatLongDate, formatTime, greeting, todayDateOnly } from "@/lib/format";
import { initials, cn } from "@/lib/utils";
import { openActions, type OpenAction } from "@/lib/meeting-actions";
import { Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/form";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { hasWebGL } from "@/features/sports/court/court-geometry";
import { ActionDoneToggle } from "@/features/meetings/action-done";
import type { Seat } from "@/features/meetings/meeting-table-3d";
import { Tile } from "./presidency-mobile";

const MeetingTable3D = dynamic(() => import("@/features/meetings/meeting-table-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

const SECRETARY_COLOR = "#8fb0ec";

/* --------------------------------- dados --------------------------------- */

function useSecretaryHome() {
  const access = useAccess();
  const dir = useDirectory();
  const query = useMeetings();
  const today = todayDateOnly();
  const meetings = useMemo(() => query.data ?? [], [query.data]);
  const next = useMemo(
    () =>
      meetings
        .filter((m) => m.status !== "archived" && m.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0] ?? null,
    [meetings, today],
  );
  const actions = useMemo(() => openActions(meetings, today), [meetings, today]);
  const toApprove = meetings.filter((m) => m.status === "pending_approval").length;
  const lastApproved = useMemo(() => meetings.filter((m) => m.status === "approved").sort((a, b) => b.date.localeCompare(a.date))[0] ?? null, [meetings]);
  return { access, dir, query, next, actions, toApprove, lastApproved, today };
}

function useSecretaryTiles(toApprove: number, lastApproved: Meeting | null) {
  const access = useAccess();
  const can = (p: Parameters<typeof access.can>[0]) => access.can(p) && access.moduleEnabled(p.split(".")[0] as never);
  const tiles: { href: string; icon: LucideIcon; color: string; title: string; info: string; badge?: number; show: boolean }[] = [
    { href: "/secretaria/registrar", icon: ClipboardPlus, color: SECRETARY_COLOR, title: "Registrar reunião", info: "Pauta, presença e ata", show: can("meetings.create") },
    { href: "/documentos?novo=1", icon: FilePlus2, color: "#3fcf8e", title: "Adicionar documento", info: "Estatuto, atas, contratos…", show: can("documents.create") },
    {
      href: lastApproved ? `/secretaria/${lastApproved.id}` : "/secretaria",
      icon: FileDown,
      color: "#e1af37",
      title: "PDF da última ata",
      info: lastApproved ? lastApproved.title : "Nenhuma ata aprovada ainda",
      show: can("meetings.export") && !!lastApproved,
    },
    {
      href: "/secretaria",
      icon: ClipboardCheck,
      color: "#e88ab5",
      title: "Atas para aprovar",
      info: toApprove ? `${toApprove} esperando aprovação` : "Nenhuma esperando",
      badge: toApprove || undefined,
      show: can("meetings.view"),
    },
    { href: "/documentos", icon: FolderOpen, color: "#b6a9ff", title: "Documentos", info: "Biblioteca da Atlética", show: can("documents.view") },
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

function countdown(today: string, date: string) {
  const d = daysBetween(today, date);
  return d <= 0 ? "É hoje!" : d === 1 ? "É amanhã" : `Faltam ${d} dias`;
}

function whereLabel(m: Meeting) {
  return `${MEETING_MODE_LABELS[m.mode]}${m.location ? ` · ${m.location}` : ""}`;
}

/** Cartão da próxima reunião (sem 3D): pauta e participantes. */
function NextMeetingCard({ meeting, today, compact }: { meeting: Meeting; today: string; compact?: boolean }) {
  const soon = daysBetween(today, meeting.date) <= 2;
  return (
    <div className="anim-flip flex h-full flex-col rounded-[22px] border border-line bg-surface p-5">
      <p className="eyebrow">Próxima reunião</p>
      <p className={cn("mt-2 font-display leading-tight font-extrabold", compact ? "text-[22px]" : "text-[24px]")}>{meeting.title}</p>
      <p className={cn("mt-1 text-[14px] font-semibold", soon ? "text-gold-fg" : "text-fg-muted")}>
        {countdown(today, meeting.date)} · {formatDate(meeting.date)} às {formatTime(meeting.startTime)}
      </p>
      <p className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-fg-muted">
        <MapPin className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{whereLabel(meeting)}</span>
      </p>
      {meeting.agenda.length > 0 && (
        <>
          <p className="eyebrow mt-4 mb-2">Pauta</p>
          <ol className="space-y-1.5 text-[13.5px]">
            {meeting.agenda.slice(0, compact ? 3 : 6).map((item, i) => (
              <li key={i} className="anim-row flex gap-2" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="tnum font-mono text-gold-fg">{i + 1}.</span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="flex -space-x-2">
          {meeting.participantIds.slice(0, 6).map((id) => (
            <MemberAvatar key={id} id={id} size={28} className="ring-2 ring-surface" />
          ))}
          {meeting.participantIds.length > 6 && (
            <span className="grid size-7 place-items-center rounded-full bg-surface-3 text-[10.5px] font-semibold ring-2 ring-surface">+{meeting.participantIds.length - 6}</span>
          )}
        </span>
        <Link href={`/secretaria/${meeting.id}`} className="text-[13.5px] font-semibold text-gold-fg hover:underline">
          Abrir reunião →
        </Link>
      </div>
    </div>
  );
}

/** Encaminhamentos em aberto, com filtro "Todos/Meus" e a caixinha "feito". */
function ActionsList({ actions, userId, limit }: { actions: OpenAction[]; userId?: string; limit?: number }) {
  const dir = useDirectory();
  const [who, setWho] = useState<"all" | "mine">("all");
  const [leaving, setLeaving] = useState<Map<string, OpenAction>>(new Map());
  // Quem acabou de ser marcado sai com animação: fica na lista por um instante.
  const list = useMemo(() => {
    const ids = new Set(actions.map((a) => a.action.id));
    const ghosts = [...leaving.values()].filter((g) => !ids.has(g.action.id));
    return [...actions, ...ghosts].filter((a) => who === "all" || a.action.responsibleId === userId);
  }, [actions, leaving, who, userId]);
  const shown = limit ? list.slice(0, limit) : list;
  const mineCount = actions.filter((a) => a.action.responsibleId === userId).length;

  const markLeaving = (item: OpenAction) => {
    setLeaving((m) => new Map(m).set(item.action.id, item));
    setTimeout(() => setLeaving((m) => {
      const n = new Map(m);
      n.delete(item.action.id);
      return n;
    }), 650);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          ariaLabel="De quem"
          value={who}
          onChange={setWho}
          options={[
            { value: "all", label: `Todos (${actions.length})` },
            { value: "mine", label: `Meus (${mineCount})` },
          ]}
        />
        <span className="text-[12.5px] text-fg-subtle">Marque quando estiver feito</span>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-fg-muted">
          {who === "mine" ? "Nenhum encaminhamento em aberto com você." : "Nenhum encaminhamento em aberto. Tudo em dia ✅"}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((item, i) => {
            const gone = leaving.has(item.action.id) && !actions.some((a) => a.action.id === item.action.id);
            return (
              <li
                key={item.action.id}
                className={cn("anim-row transition-all duration-500", gone && "translate-x-8 opacity-0")}
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className={cn("flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5", item.overdue ? "border-danger/50" : "border-line")}>
                  <ActionDoneToggle meeting={item.meeting} action={gone ? { ...item.action, doneAt: "agora" } : item.action} onDone={() => markLeaving(item)} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13.5px] font-semibold", gone && "text-fg-subtle line-through")}>{item.action.description}</span>
                    <Link href={`/secretaria/${item.meeting.id}`} className="block truncate text-[12px] text-fg-subtle hover:text-fg-muted hover:underline">
                      {item.meeting.title} · {formatDate(item.meeting.date)}
                    </Link>
                  </span>
                  {item.action.dueDate && (
                    <span className={cn("tnum shrink-0 font-mono text-[12px]", item.overdue ? "font-semibold text-danger" : "text-fg-muted")}>
                      {item.overdue ? "atrasado · " : ""}
                      {formatDate(item.action.dueDate).slice(0, 5)}
                    </span>
                  )}
                  {item.action.responsibleId ? (
                    <span title={dir.memberName(item.action.responsibleId)}>
                      <MemberAvatar id={item.action.responsibleId} size={26} />
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-fg-subtle">sem responsável</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {limit && list.length > limit && (
        <Link href="/secretaria" className="mt-3 inline-block text-[13px] font-semibold text-gold-fg hover:underline">
          Ver todos ({list.length}) →
        </Link>
      )}
    </div>
  );
}

/* ------------------------------ computador ------------------------------ */

export function SecretaryDesktopHome() {
  const { access, dir, query, next, actions, toApprove, lastApproved, today } = useSecretaryHome();
  const tiles = useSecretaryTiles(toApprove, lastApproved);
  const can3D = useCan3D();
  const seats: Seat[] = useMemo(() => {
    if (!next) return [];
    const members = next.participantIds.map((id) => ({ id, name: dir.memberName(id), initials: initials(dir.memberName(id)) }));
    const guests = (next.guests ?? []).map((g, i) => ({ id: `guest-${i}`, name: g, initials: initials(g), guest: true }));
    return [...members, ...guests];
  }, [next, dir]);

  return (
    <div className="space-y-8">
      <header className="anim-rise">
        <p className="eyebrow !text-gold-fg">
          {access.department?.name ?? "Secretaria"} · {formatLongDate(new Date())}
        </p>
        <h1 className="mt-2.5 font-display text-[34px] leading-[1.08] font-bold">
          {greeting()}, {firstName(access.user?.name ?? "")}
        </h1>
        <p className="mt-2 text-[14px] text-fg-muted">A próxima reunião, o que foi combinado e os documentos da Atlética.</p>
      </header>

      <section aria-label="Próxima reunião" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {query.isError ? (
          <p className="rounded-[22px] border border-line p-6 text-[14px] text-fg-muted">Não foi possível carregar as reuniões.</p>
        ) : !query.data ? (
          <Skeleton className="h-[380px] rounded-[22px]" />
        ) : next ? (
          can3D ? (
            <div className="relative h-[380px] overflow-hidden rounded-[22px] border border-line bg-[radial-gradient(ellipse_at_top,#1d3b8f,#030f45_72%)]">
              <MeetingTable3D seats={seats} agenda={next.agenda} />
              <div className="pointer-events-none absolute top-4 left-4 max-w-[70%] rounded-2xl bg-black/35 px-4 py-3 text-white backdrop-blur">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-white/70 uppercase">Próxima reunião · {countdown(today, next.date)}</p>
                <p className="mt-1 truncate font-display text-[22px] leading-tight font-extrabold">{next.title}</p>
                <p className="mt-0.5 truncate text-[12.5px] text-white/75">
                  {formatDate(next.date)} às {formatTime(next.startTime)} · {whereLabel(next)}
                </p>
              </div>
              {seats.length > 14 && (
                <span className="pointer-events-none absolute top-4 right-4 rounded-full bg-black/40 px-3 py-1 text-[12px] text-white backdrop-blur">+{seats.length - 14} participantes</span>
              )}
              <p className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/35 px-3 py-1 text-[11.5px] text-white/75 backdrop-blur">
                Passe o mouse numa cadeira para ver quem é · arraste para girar
              </p>
            </div>
          ) : (
            <NextMeetingCard meeting={next} today={today} />
          )
        ) : (
          <div className="grid h-[380px] place-items-center rounded-[22px] border border-dashed border-line-strong p-6 text-center">
            <span>
              <CalendarDays className="mx-auto mb-3 size-9 text-fg-subtle" aria-hidden />
              <span className="block font-display text-[20px] font-bold">Nenhuma reunião marcada</span>
              <Link href="/secretaria/registrar" className="mt-2 inline-block text-[13.5px] font-semibold text-gold-fg hover:underline">
                Registrar uma reunião →
              </Link>
            </span>
          </div>
        )}
        {next && can3D ? <NextMeetingCard meeting={next} today={today} /> : <div className="hidden xl:block" />}
      </section>

      {tiles.length > 0 && (
        <section aria-labelledby="fazer">
          <h2 id="fazer" className="mb-3 font-display text-[22px] font-bold">
            O que você quer fazer?
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((t, i) => (
              <Tile key={t.title} index={i} href={t.href} icon={t.icon} color={t.color} title={t.title} info={t.info} badge={t.badge} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="encaminhamentos">
        <h2 id="encaminhamentos" className="mb-3 inline-flex items-center gap-2 font-display text-[22px] font-bold">
          <ListChecks className="size-5 text-gold-fg" aria-hidden /> Encaminhamentos em aberto
        </h2>
        {query.data ? <ActionsList actions={actions} userId={access.user?.id} /> : <Skeleton className="h-[220px] rounded-xl" />}
      </section>
    </div>
  );
}

/* -------------------------------- celular -------------------------------- */

export function SecretaryMobileHome() {
  const { access, query, next, actions, toApprove, lastApproved, today } = useSecretaryHome();
  const tiles = useSecretaryTiles(toApprove, lastApproved).slice(0, 4);
  return (
    <div className="space-y-6">
      <header className="anim-rise">
        <p className="text-[14px] text-fg-muted">{greeting()},</p>
        <h1 className="font-display text-[30px] leading-tight font-bold">{firstName(access.user?.name ?? "")}</h1>
      </header>

      {!query.data ? (
        <Skeleton className="h-[200px] rounded-[22px]" />
      ) : next ? (
        <NextMeetingCard meeting={next} today={today} compact />
      ) : (
        <p className="rounded-[22px] border border-dashed border-line-strong p-5 text-center text-[13px] text-fg-muted">Nenhuma reunião marcada.</p>
      )}

      {tiles.length > 0 && (
        <section aria-labelledby="fazer-m">
          <h2 id="fazer-m" className="mb-3 font-display text-[20px] font-bold">
            O que você quer fazer?
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t, i) => (
              <Tile key={t.title} index={i} href={t.href} icon={t.icon} color={t.color} title={t.title} info={t.info} badge={t.badge} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="enc-m">
        <h2 id="enc-m" className="mb-3 font-display text-[20px] font-bold">
          Encaminhamentos
        </h2>
        {query.data ? <ActionsList actions={actions} userId={access.user?.id} limit={6} /> : <Skeleton className="h-[200px] rounded-xl" />}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  KeyRound,
  Megaphone,
  ScrollText,
  Settings,
  Ticket,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useAllSales, useCampaigns, useContents, useEvents, useFinanceEntries, useMeetings, useProjects, useSportsTeams } from "@/hooks/use-data";
import { byMonth } from "@/features/finance/utils";
import { firstName, formatLongDate, formatMoney, formatShortMonth, greeting, parseDateOnly, todayDateOnly, daysBetween } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { AREA_COLORS } from "@/components/layout/nav";
import { ColumnChart } from "@/components/shared/column-chart";
import { useAgenda } from "@/features/agenda/use-agenda";
import { AGENDA_KINDS } from "@/features/agenda/agenda";
import { Calendar3D } from "@/features/agenda/calendar-3d";
import { HEALTH_LABELS, eventsArea, extensionArea, financeArea, marketingArea, meetingsArea, rafflesArea, sportsArea, type AreaKey, type AreaStatus, type Health } from "./panorama-rules";
import { PendingSection, RaffleTile, Tile, useActionTiles } from "./presidency-mobile";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function delay(ms: number) {
  return { animationDelay: `${ms}ms` };
}

function SectionTitle({ id, children, action }: { id: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 id={id} className="font-display text-[24px] leading-none font-bold">
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ------------------------------- Panorama ------------------------------- */

const AREA_META: Record<AreaKey, { icon: LucideIcon; href: string }> = {
  campaigns: { icon: Ticket, href: "/campanhas" },
  finance: { icon: Wallet, href: "/financeiro" },
  events: { icon: CalendarDays, href: "/eventos" },
  marketing: { icon: Megaphone, href: "/marketing" },
  meetings: { icon: ClipboardList, href: "/secretaria" },
  extension: { icon: GraduationCap, href: "/extensao" },
  sports: { icon: Trophy, href: "/esportes" },
};

const HEALTH_STYLES: Record<Health, { pill: string; dot: string; ring: string }> = {
  ok: { pill: "bg-ok/12 text-ok", dot: "bg-ok", ring: "hover:border-ok/40" },
  warn: { pill: "bg-warn/12 text-warn", dot: "bg-warn", ring: "border-warn/30 hover:border-warn/60" },
  alert: { pill: "bg-danger/12 text-danger", dot: "bg-danger", ring: "border-danger/40 hover:border-danger/70" },
  idle: { pill: "bg-surface-3 text-fg-subtle", dot: "bg-fg-subtle", ring: "hover:border-line-strong" },
};

function AreaCard({ area, index }: { area: AreaStatus; index: number }) {
  const meta = AREA_META[area.key];
  const color = AREA_COLORS[meta.href] ?? "#c5cde6";
  const style = HEALTH_STYLES[area.health];
  const Icon = meta.icon;
  return (
    <Link
      href={area.href}
      className={cn(
        "anim-rise group relative flex min-h-[172px] flex-col overflow-hidden rounded-[22px] border border-line bg-surface p-5 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-float)]",
        style.ring,
      )}
      style={delay(260 + index * 70)}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 origin-left transition-transform duration-500 group-hover:scale-x-100" style={{ background: color, transform: "scaleX(0.25)" }} />
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-[13px] text-[#06102e] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105"
            style={{ background: `linear-gradient(145deg, ${color}, ${color}b8)` }}
          >
            <Icon className="size-5" strokeWidth={2.2} aria-hidden />
          </span>
          <strong className="truncate text-[16px] font-semibold">{area.title}</strong>
        </span>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold whitespace-nowrap", style.pill)}>
          <span className="relative size-2">
            {area.health === "alert" && <span className={cn("absolute inset-0 rounded-full", style.dot)} style={{ animation: "ping-dot 1.8s ease-out infinite" }} />}
            <span className={cn("absolute inset-0 rounded-full", style.dot)} />
          </span>
          {HEALTH_LABELS[area.health]}
        </span>
      </span>
      <span className="mt-4 block">
        <span className="block font-display text-[32px] leading-none font-extrabold tnum">{area.headline}</span>
        <span className="mt-1 block truncate text-[13px] text-fg-muted">{area.caption}</span>
      </span>
      <span className="mt-auto flex items-end justify-between gap-3 pt-3">
        <span className={cn("text-[13.5px] leading-snug", area.health === "alert" ? "font-semibold text-danger" : area.health === "warn" ? "text-fg" : "text-fg-muted")}>{area.reason}</span>
        <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-1" aria-hidden />
      </span>
    </Link>
  );
}

function AreaPlaceholder({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-[172px] flex-col justify-between rounded-[22px] border border-line bg-surface p-5">
      <strong className="text-[16px] font-semibold">{title}</strong>
      <span className="text-[13.5px] text-fg-muted">{message}</span>
    </div>
  );
}

interface Query<T> {
  data?: T;
  isError: boolean;
}

/** Junta o estado das consultas de uma área: carregando, erro ou o cartão pronto. */
function areaFrom<T extends unknown[]>(title: string, queries: { [K in keyof T]: Query<T[K]> }, build: (...data: T) => AreaStatus) {
  if (queries.some((q) => q.isError)) return { title, message: "Não foi possível carregar." };
  if (queries.some((q) => !q.data)) return { title, message: "Carregando…" };
  return build(...(queries.map((q) => q.data) as T));
}

function Panorama() {
  const access = useAccess();
  const has = access.canModule;
  const today = todayDateOnly();
  const hasFinance = has("finance") && access.can("finance.view");
  const campaigns = useCampaigns(has("campaigns"));
  const sales = useAllSales(has("campaigns"));
  const entries = useFinanceEntries(hasFinance);
  const events = useEvents(has("events"));
  const contents = useContents(has("marketing"));
  const meetings = useMeetings(has("meetings"));
  const projects = useProjects(has("extension"));
  const teams = useSportsTeams(has("sports"));

  const cards: (AreaStatus | { title: string; message: string })[] = [];
  if (has("campaigns")) cards.push(areaFrom("Rifas", [campaigns, sales], (c, s) => rafflesArea(today, c, s)));
  if (hasFinance) cards.push(areaFrom("Financeiro", [entries], (e) => financeArea(today, e)));
  if (has("events")) cards.push(areaFrom("Eventos", [events], (e) => eventsArea(today, e)));
  if (has("marketing")) cards.push(areaFrom("Marketing", [contents], (c) => marketingArea(today, c)));
  if (has("meetings")) cards.push(areaFrom("Secretaria", [meetings], (m) => meetingsArea(today, m)));
  if (has("extension")) cards.push(areaFrom("Ensino e Extensão", [projects], (p) => extensionArea(today, p)));
  if (has("sports")) cards.push(areaFrom("Esportes", [teams], (t) => sportsArea(today, t)));

  const ready = cards.filter((c): c is AreaStatus => "health" in c);
  const alerts = ready.filter((c) => c.health === "alert").length;
  const warns = ready.filter((c) => c.health === "warn").length;

  return (
    <section aria-labelledby="panorama">
      <SectionTitle
        id="panorama"
        action={
          ready.length > 0 && (
            <span className="text-[13.5px] text-fg-muted">
              {alerts === 0 && warns === 0
                ? "Todas as áreas em dia ✅"
                : [alerts && (alerts === 1 ? "1 área precisa agir" : `${alerts} áreas precisam agir`), warns && (warns === 1 ? "1 pede atenção" : `${warns} pedem atenção`)]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          )
        }
      >
        Panorama da Atlética
      </SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {cards.map((c, i) => ("health" in c ? <AreaCard key={c.key} area={c} index={i} /> : <AreaPlaceholder key={c.title} {...c} />))}
      </div>
    </section>
  );
}

/* ------------------------------ Dinheiro ------------------------------ */

function MoneyChart() {
  const { data, isError } = useFinanceEntries();
  const months = useMemo(() => byMonth(data ?? []).slice(-6), [data]);
  return (
    <section aria-labelledby="dinheiro" className="anim-rise rounded-[22px] border border-line bg-surface p-5" style={delay(420)}>
      <SectionTitle
        id="dinheiro"
        action={
          <Link href="/financeiro" className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-gold-fg hover:underline">
            Abrir financeiro <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      >
        Entrou e saiu {isDemoMode && <span className="font-sans text-[13px] font-normal text-fg-muted">(demonstração)</span>}
      </SectionTitle>
      {isError ? (
        <p className="py-10 text-center text-[14px] text-fg-muted">Não foi possível carregar o financeiro.</p>
      ) : !data ? (
        <div className="h-[240px] animate-pulse rounded-2xl bg-surface-2" />
      ) : months.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-fg-muted">Ainda não há entradas ou saídas registradas.</p>
      ) : (
        <ColumnChart
          title="Dinheiro que entrou e saiu por mês"
          series={[
            { name: "Entrou", color: "--chart-1" },
            { name: "Saiu", color: "--chart-2" },
          ]}
          groups={months.map((m) => ({ label: `${formatShortMonth(m.year, m.month)}/${String(m.year).slice(2)}`, values: [m.income, m.expense] }))}
          format={formatMoney}
          extra={(g) => ({ label: "Sobrou no mês", value: formatMoney(g.values[0] - g.values[1]) })}
        />
      )}
    </section>
  );
}

/* ---------------------------- Próximos dias ---------------------------- */

function UpcomingDays() {
  const { items, loading, error } = useAgenda();
  const today = todayDateOnly();
  const next = items.filter((i) => i.date >= today && daysBetween(today, i.date) <= 14).slice(0, 6);
  return (
    <section aria-labelledby="proximos-dias" className="anim-rise rounded-[22px] border border-line bg-surface p-5" style={delay(480)}>
      <SectionTitle
        id="proximos-dias"
        action={
          <Link href="/agenda" className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-gold-fg hover:underline">
            Agenda <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      >
        Próximos dias
      </SectionTitle>
      {error ? (
        <p className="py-6 text-[14px] text-fg-muted">Agenda indisponível.</p>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      ) : next.length === 0 ? (
        <p className="py-6 text-[14px] text-fg-muted">Nada marcado para as próximas duas semanas.</p>
      ) : (
        <ul className="space-y-1.5">
          {next.map((item, i) => {
            const d = parseDateOnly(item.date);
            const diff = daysBetween(today, item.date);
            return (
              <li key={item.id} className="anim-row" style={delay(520 + i * 50)}>
                <Link href={item.href} className="group flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-surface-2">
                  <span className="grid w-12 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 py-1.5 leading-none">
                    <span className="font-mono text-[16px] font-bold">{String(d.getUTCDate()).padStart(2, "0")}</span>
                    <span className="mt-0.5 text-[10px] font-bold tracking-wide text-gold-fg uppercase">{WEEKDAY[d.getUTCDay()].slice(0, 3)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{item.title}</span>
                    <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: AGENDA_KINDS[item.kind].color }} />
                      <span className="truncate">
                        {diff === 0 ? "hoje" : diff === 1 ? "amanhã" : WEEKDAY[d.getUTCDay()]}
                        {item.time ? ` · ${item.time}` : ""}
                        {item.detail ? ` · ${item.detail}` : ""}
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-fg-subtle opacity-0 transition-[opacity,transform] group-hover:translate-x-1 group-hover:opacity-100" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------- Ferramentas da presidência ------------------------- */

function Tools() {
  const access = useAccess();
  const tools: { href: string; icon: LucideIcon; title: string; info: string; show: boolean }[] = [
    { href: "/diretoria", icon: Users, title: "Pessoas e cargos", info: "Quem faz parte e em qual área", show: access.can("organization.view") },
    { href: "/diretoria?aba=permissoes", icon: KeyRound, title: "O que cada cargo pode fazer", info: "Permissões por cargo", show: access.can("organization.admin") },
    { href: "/configuracoes", icon: Settings, title: "Configurações", info: "Dados da Atlética e módulos", show: access.canModule("settings") },
    { href: "/auditoria", icon: ScrollText, title: "Auditoria", info: "Registro das operações importantes", show: access.canModule("audit") },
  ];
  const visible = tools.filter((t) => t.show);
  if (visible.length === 0) return null;
  return (
    <section aria-labelledby="ferramentas">
      <SectionTitle id="ferramentas">Ferramentas da presidência</SectionTitle>
      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {visible.map((t, i) => {
          const Icon = t.icon;
          return (
            <li key={t.href} className="anim-rise" style={delay(560 + i * 50)}>
              <Link href={t.href} className="group flex h-full items-center gap-3 rounded-[20px] border border-line bg-surface p-4 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-line-strong">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-surface-2 text-fg transition-colors group-hover:bg-gold group-hover:text-gold-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <strong className="block text-[15px] font-semibold">{t.title}</strong>
                  <span className="block truncate text-[12.5px] text-fg-muted">{t.info}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------- Tela ---------------------------------- */

/**
 * Início da presidência no computador: a mesma ideia do celular (o que fazer e
 * o que precisa de você, em botões grandes e linguagem simples), com espaço
 * para ver a Atlética inteira de uma vez: o panorama de cada área, o dinheiro
 * dos últimos meses e a agenda.
 */
export function PresidencyDesktopHome({ actions }: { actions?: React.ReactNode }) {
  const access = useAccess();
  const tiles = useActionTiles();
  if (!access.user) return null;
  const hasRaffle = access.canModule("campaigns");
  const hasFinance = access.canModule("finance") && access.can("finance.view");

  return (
    <div className="flex flex-col gap-10">
      <header className="anim-rise flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[14px] font-medium text-fg-muted first-letter:uppercase">{formatLongDate(new Date())}</p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.02] font-extrabold tracking-[-0.01em]">
            {greeting()},{" "}
            <span className="bg-gradient-to-r from-[var(--title-from)] via-[var(--title-via)] to-[var(--title-to)] bg-clip-text text-transparent">{firstName(access.user.name)}</span>
          </h1>
          <p className="mt-1.5 text-[15px] text-fg-muted">{access.role?.name} · aqui está a Atlética hoje.</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>

      <section aria-labelledby="o-que-fazer">
        <SectionTitle id="o-que-fazer">O que você quer fazer?</SectionTitle>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]" style={{ "--cols": tiles.length + (hasRaffle ? 2 : 0) } as React.CSSProperties}>
          {hasRaffle && <RaffleTile className="col-span-2 min-h-[180px]" />}
          {tiles.map((t, i) => (
            <Tile key={t.href} {...t} index={i} />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]">
        <Panorama />
        <PendingSection limit={5} className="[&_h2]:text-[24px]" />
      </div>

      <div className={cn("grid grid-cols-1 gap-6", hasFinance && "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]")}>
        {hasFinance && <MoneyChart />}
        <UpcomingDays />
      </div>

      <section aria-labelledby="mes">
        <SectionTitle id="mes">O mês na Atlética</SectionTitle>
        <Calendar3D />
      </section>

      <Tools />
    </div>
  );
}

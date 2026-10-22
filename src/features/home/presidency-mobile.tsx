"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, CalendarDays, ChevronRight, ClipboardList, FolderOpen, LayoutGrid, Ticket, Trophy, Wallet, type LucideIcon } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useAllSales, useCampaigns, useDocuments, useFinanceEntries, useMeetings, useSportsTeams } from "@/hooks/use-data";
import { useCountUp } from "@/hooks/use-count-up";
import { summarize } from "@/lib/raffle";
import { summarizeFinance } from "@/features/finance/utils";
import { firstName, formatLongDate, formatMoneyCompact, greeting, parseDateOnly, todayDateOnly } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { useAgenda } from "@/features/agenda/use-agenda";
import { PENDING_ICONS, usePending, type PendingItem } from "./pending";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** Quantos cartões de "Precisa de você" cabem na tela inicial; o resto fica em Avisos. */
const PENDING_LIMIT = 4;

function delay(ms: number) {
  return { animationDelay: `${ms}ms` };
}

/* --------------------------------- Rifa --------------------------------- */

/** Botão principal: a rifa em andamento, com quanto já foi vendido. */
export function RaffleTile({ className }: { className?: string }) {
  const access = useAccess();
  const campaignsQuery = useCampaigns();
  const salesQuery = useAllSales();
  const active = (campaignsQuery.data ?? []).filter((c) => c.status === "active");
  const featured = active[0];
  const s = useMemo(
    () => (featured ? summarize(featured, (salesQuery.data ?? []).filter((x) => x.campaignId === featured.id)) : null),
    [featured, salesQuery.data],
  );
  const sold = useCountUp(s?.sold ?? 0);
  const pct = s && s.total ? Math.round((s.sold / s.total) * 100) : 0;
  const canCreate = access.can("campaigns.create");
  const failed = campaignsQuery.isError || salesQuery.isError;

  const href = active.length === 1 ? `/campanhas/${featured.id}` : active.length === 0 && canCreate ? "/campanhas/nova" : "/campanhas";

  return (
    <Link
      href={href}
      className={cn(
        "press anim-rise relative isolate flex min-h-[164px] flex-col justify-between overflow-hidden rounded-[26px] bg-gradient-to-br from-[#f3cd66] via-[#e1af37] to-[#c08a1a] p-5 text-gold-ink shadow-[0_14px_34px_-10px_rgba(225,175,55,0.55)]",
        className,
      )}
      style={delay(60)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -top-[20%] -left-1/2 -z-10 h-[140%] w-[38%] opacity-0 mix-blend-overlay"
        style={{
          background: "linear-gradient(90deg, rgba(255,250,230,0) 0%, rgba(255,250,230,.25) 40%, rgba(255,250,230,.45) 50%, rgba(255,250,230,.25) 60%, rgba(255,250,230,0) 100%)",
          animation: "shine-sweep 6s cubic-bezier(.45,0,.25,1) 1.2s infinite",
        }}
      />
      <Ticket aria-hidden className="absolute top-4 right-4 -z-10 size-16 opacity-25" strokeWidth={1.4} style={{ animation: "float-y 3.4s ease-in-out infinite" }} />

      <span className="flex items-center gap-2">
        <span className="grid size-10 place-items-center rounded-2xl bg-gold-ink text-[#f0c75a]">
          <Ticket className="size-5" strokeWidth={2.2} aria-hidden />
        </span>
        <span className="min-w-0">
          <strong className="block font-display text-[24px] leading-none font-extrabold">Rifa</strong>
          <span className="block truncate text-[13px] font-semibold opacity-80">
            {failed
              ? "Não foi possível carregar"
              : !campaignsQuery.data
                ? "Carregando…"
                : featured
                  ? active.length > 1
                    ? `${featured.name} · +${active.length - 1} ${active.length === 2 ? "outra" : "outras"}`
                    : featured.name
                  : canCreate
                    ? "Nenhuma rifa agora · toque para criar"
                    : "Nenhuma rifa em andamento"}
          </span>
        </span>
      </span>

      {featured && s ? (
        <span className="mt-4 block">
          <span className="flex items-end justify-between gap-3">
            <span className="leading-none">
              <span className="font-display text-[40px] font-extrabold tnum">{sold}</span>
              <span className="ml-1 text-[15px] font-semibold opacity-75">de {s.total} vendidos</span>
            </span>
            <span className="mb-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-gold-ink px-3 py-1.5 text-[13px] font-bold text-[#f0c75a]">
              Abrir <ArrowRight className="size-4" aria-hidden />
            </span>
          </span>
          <span className="mt-3 block h-2.5 overflow-hidden rounded-full bg-gold-ink/20" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Números vendidos">
            <span className="anim-grow block h-full rounded-full bg-gold-ink" style={{ width: `${pct}%` }} />
          </span>
          <span className="mt-2 block text-[13px] font-semibold opacity-80 tnum">
            {s.available} livres{s.pending > 0 ? ` · ${s.pending} sem pagamento` : ""}
          </span>
        </span>
      ) : (
        <span className="mt-4 inline-flex w-fit items-center gap-1 rounded-full bg-gold-ink px-3 py-1.5 text-[13px] font-bold text-[#f0c75a]">
          {canCreate && !featured ? "Criar rifa" : "Ver rifas"} <ArrowRight className="size-4" aria-hidden />
        </span>
      )}
    </Link>
  );
}

/* ------------------------------ Botões grandes ------------------------------ */

export interface TileProps {
  href: string;
  icon: LucideIcon;
  color: string;
  title: string;
  info: React.ReactNode;
  badge?: number;
  index: number;
}

export function Tile({ href, icon: Icon, color, title, info, badge, index }: TileProps) {
  return (
    <Link
      href={href}
      className="press anim-rise group relative flex min-h-[124px] flex-col justify-between rounded-[22px] border border-line bg-surface p-4 hover:border-line-strong"
      style={delay(140 + index * 60)}
    >
      <span className="flex items-start justify-between">
        <span
          className="grid size-11 place-items-center rounded-[14px] text-[#06102e] transition-transform duration-300 group-active:scale-110 group-active:-rotate-12"
          style={{ background: `linear-gradient(145deg, ${color}, ${color}b8)`, boxShadow: `0 8px 18px -6px ${color}80` }}
        >
          <Icon className="size-[22px]" strokeWidth={2.2} aria-hidden />
        </span>
        {!!badge && (
          <span className="anim-pop grid h-6 min-w-6 place-items-center rounded-full bg-danger px-1.5 text-[12px] font-bold text-white tnum" style={delay(500 + index * 60)}>
            {badge}
          </span>
        )}
      </span>
      <span className="mt-3 block min-w-0">
        <strong className="block text-[17px] leading-tight font-semibold">{title}</strong>
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-fg-muted">{info}</span>
      </span>
    </Link>
  );
}

function MoneyInfo() {
  const { data, isError } = useFinanceEntries();
  const s = summarizeFinance(data ?? []);
  const balance = useCountUp(data ? s.balance : 0);
  if (isError) return <>Não foi possível carregar</>;
  if (!data) return <>Carregando…</>;
  return (
    <>
      <b className="font-semibold text-fg tnum">{formatMoneyCompact(balance)}</b> {isDemoMode ? "no caixa (demo)" : "no caixa"}
    </>
  );
}

function AgendaInfo() {
  const { items, error, loading } = useAgenda();
  const today = todayDateOnly();
  const next = items.find((i) => i.date >= today);
  if (error) return <>Agenda indisponível</>;
  if (loading) return <>Carregando…</>;
  if (!next) return <>Nada marcado</>;
  const day = next.date === today ? "hoje" : WEEKDAY[parseDateOnly(next.date).getUTCDay()];
  return (
    <>
      <b className="font-semibold text-fg">{day}</b> · {next.title}
    </>
  );
}

function DocumentsInfo() {
  const { data, isError } = useDocuments();
  if (isError || !data) return <>Achar um arquivo</>;
  const current = data.filter((d) => d.status !== "archived").length;
  return <>{current === 1 ? "1 arquivo guardado" : `${current} arquivos guardados`}</>;
}

function useMeetingsToApprove(enabled: boolean) {
  const { data } = useMeetings(enabled);
  return enabled ? (data ?? []).filter((m) => m.status === "pending_approval").length : 0;
}

function MeetingsInfo({ toApprove }: { toApprove: number }) {
  const { data, isError } = useMeetings();
  const today = todayDateOnly();
  if (toApprove > 0) return <>{toApprove === 1 ? "1 ata para aprovar" : `${toApprove} atas para aprovar`}</>;
  if (isError || !data) return <>Reuniões e atas</>;
  const next = data.filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  return <>{next ? `Próxima: ${next.date === today ? "hoje" : WEEKDAY[parseDateOnly(next.date).getUTCDay()]}` : "Nenhuma marcada"}</>;
}

/** Os botões grandes do "O que você quer fazer?", conforme os módulos do cargo. */
export function useActionTiles() {
  const access = useAccess();
  const has = access.canModule;
  const toApprove = useMeetingsToApprove(has("meetings") && access.can("meetings.approve"));

  const tiles: Omit<TileProps, "index">[] = [];
  if (has("finance") && access.can("finance.view")) tiles.push({ href: "/financeiro", icon: Wallet, color: "#5b86d9", title: "Dinheiro", info: <MoneyInfo /> });
  tiles.push({ href: "/agenda", icon: CalendarDays, color: "#9b8cf2", title: "Agenda", info: <AgendaInfo /> });
  if (has("documents")) tiles.push({ href: "/documentos", icon: FolderOpen, color: "#3fcf8e", title: "Documentos", info: <DocumentsInfo /> });
  if (has("meetings")) tiles.push({ href: "/secretaria", icon: ClipboardList, color: "#8fb0ec", title: "Reuniões e atas", info: <MeetingsInfo toApprove={toApprove} />, badge: toApprove });
  if (has("sports")) tiles.push({ href: "/esportes", icon: Trophy, color: "#f07a5a", title: "Esportes", info: <SportsInfo /> });
  return tiles;
}

function SportsInfo() {
  const { data, isError } = useSportsTeams();
  const today = todayDateOnly();
  if (isError || !data) return <>Jogos e treinos</>;
  const next = data
    .filter((t) => t.status === "active")
    .flatMap((t) => t.matches.filter((m) => m.status === "scheduled" && m.date >= today).map((m) => ({ t, m })))
    .sort((a, b) => a.m.date.localeCompare(b.m.date))[0];
  if (!next) return <>Nenhum jogo marcado</>;
  return (
    <>
      <b className="font-semibold text-fg">{next.m.date === today ? "hoje" : WEEKDAY[parseDateOnly(next.m.date).getUTCDay()]}</b> · {next.t.name} × {next.m.opponent}
    </>
  );
}

function ActionGrid() {
  const tiles = useActionTiles();
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t, i) => (
        <Tile key={t.href} {...t} index={i} />
      ))}
      <Link
        href="/mais"
        className={cn(
          "press anim-rise group flex min-h-[64px] items-center gap-3 rounded-[22px] border border-dashed border-line-strong px-4 text-fg-muted hover:text-fg",
          tiles.length % 2 === 0 ? "col-span-2" : "col-span-1 min-h-[124px] flex-col items-start justify-between py-4",
        )}
        style={delay(140 + tiles.length * 60)}
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-surface-2 text-fg">
          <LayoutGrid className="size-[22px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[17px] leading-tight font-semibold text-fg">Ver tudo</strong>
          <span className="block truncate text-[13px]">Todas as áreas da Atlética</span>
        </span>
        {tiles.length % 2 === 0 && <ChevronRight className="size-5 shrink-0 transition-transform group-active:translate-x-1" aria-hidden />}
      </Link>
    </div>
  );
}

/* ------------------------------ Precisa de você ------------------------------ */

function PendingCard({ item, index }: { item: PendingItem; index: number }) {
  return (
    <li className="anim-row" style={delay(320 + index * 70)}>
      <Link
        href={item.href}
        className={cn(
          "press group flex items-center gap-3.5 rounded-[22px] border p-4",
          item.urgent ? "border-danger/35 bg-danger/[0.08]" : "border-line bg-surface hover:border-line-strong",
        )}
      >
        <span className={cn("relative grid size-12 shrink-0 place-items-center rounded-2xl [&_svg]:size-[22px]", item.urgent ? "bg-danger text-white" : "bg-gold/15 text-gold-fg")}>
          {PENDING_ICONS[item.kind]}
          {item.urgent && (
            <span aria-hidden className="absolute -top-0.5 -right-0.5 size-3">
              <span className="absolute inset-0 rounded-full bg-danger" style={{ animation: "ping-dot 1.8s ease-out infinite" }} />
              <span className="absolute inset-0 rounded-full border-2 border-bg bg-danger" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[11px] font-bold tracking-[0.08em] uppercase", item.urgent ? "text-danger" : "text-gold-fg")}>{item.label}</span>
          <span className="block text-[15.5px] leading-snug font-semibold">{item.title}</span>
          <span className="block truncate text-[13px] text-fg-muted">{item.detail}</span>
          <span className={cn("mt-2 inline-flex items-center gap-1 text-[13.5px] font-bold", item.urgent ? "text-danger" : "text-gold-fg")}>
            {item.action}
            <ArrowRight className="size-4 transition-transform group-active:translate-x-1" aria-hidden />
          </span>
        </span>
      </Link>
    </li>
  );
}

function AllClear() {
  return (
    <div className="anim-rise flex items-center gap-3.5 rounded-[22px] border border-ok/30 bg-ok/[0.09] p-4" style={delay(320)}>
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ok text-[#04120b]">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
          <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="anim-check" />
        </svg>
      </span>
      <span>
        <strong className="block text-[15.5px] font-semibold">Tudo em dia</strong>
        <span className="block text-[13px] text-fg-muted">Nada esperando por você agora.</span>
      </span>
    </div>
  );
}

export function PendingSection({ limit = PENDING_LIMIT, className }: { limit?: number; className?: string }) {
  const { items, loading, error, retry } = usePending();
  const shown = items.slice(0, limit);
  const urgent = items.filter((i) => i.urgent).length;

  return (
    <section aria-labelledby="precisa-de-voce" className={className}>
      <div className="anim-rise mb-3 flex items-end justify-between gap-3" style={delay(280)}>
        <h2 id="precisa-de-voce" className="font-display text-[22px] leading-none font-bold">
          Precisa de você
          {items.length > 0 && (
            <span className={cn("ml-2 inline-grid h-6 min-w-6 place-items-center rounded-full px-1.5 align-middle font-sans text-[12px] font-bold tnum", urgent ? "bg-danger text-white" : "bg-gold text-gold-ink")}>
              {items.length}
            </span>
          )}
        </h2>
        {items.length > limit && (
          <Link href="/avisos" className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-semibold text-gold-fg">
            Ver todos <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-[22px] border border-danger/30 bg-danger/[0.08] p-4 text-[14px]">
          Não foi possível verificar as pendências.
          <button type="button" onClick={retry} className="press shrink-0 rounded-full bg-danger px-4 py-2 text-[13px] font-bold text-white">
            Tentar de novo
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-[22px] bg-surface-2" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <AllClear />
      ) : (
        <ul className="space-y-3">
          {shown.map((item, i) => (
            <PendingCard key={item.id} item={item} index={i} />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------------------------- Tela ---------------------------------- */

/**
 * Início da presidência no celular: pensado para o dia a dia e para quem não tem
 * intimidade com tecnologia. Poucos blocos, botões grandes com texto e, em cada
 * botão, a informação que responde "como está?" antes mesmo de tocar.
 */
export function PresidencyMobileHome() {
  const access = useAccess();
  if (!access.user) return null;
  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-7">
      <header className="anim-rise">
        <p className="text-[14px] font-medium text-fg-muted first-letter:uppercase">{formatLongDate(new Date())}</p>
        <h1 className="mt-1 font-display text-[34px] leading-[1.02] font-extrabold tracking-[-0.01em]">
          {greeting()}, <span className="bg-gradient-to-r from-[var(--title-from)] via-[var(--title-via)] to-[var(--title-to)] bg-clip-text text-transparent">{firstName(access.user.name)}</span>
        </h1>
        <p className="mt-1.5 text-[14px] text-fg-muted">{access.role?.name} · o que você quer fazer hoje?</p>
      </header>

      <section aria-label="O que você quer fazer?" className="flex flex-col gap-3">
        {access.canModule("campaigns") && <RaffleTile />}
        <ActionGrid />
      </section>

      <PendingSection />
    </div>
  );
}

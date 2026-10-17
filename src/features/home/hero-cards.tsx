"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CalendarDays, Ticket } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useAllSales, useCampaigns, useFinanceEntries } from "@/hooks/use-data";
import { summarize } from "@/lib/raffle";
import { canSellIn } from "@/lib/policies";
import { summarizeFinance } from "@/features/finance/utils";
import { formatMoneyCompact, parseDateOnly, todayDateOnly } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { useAgenda } from "@/features/agenda/use-agenda";
import { AGENDA_KINDS } from "@/features/agenda/agenda";

const WEEKDAY = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

/** Rifa em destaque: a primeira ativa em que a pessoa pode vender. */
function RaffleCard({ tall }: { tall: boolean }) {
  const access = useAccess();
  const { data: campaigns, isError } = useCampaigns();
  const { data: sales } = useAllSales();
  const active = (campaigns ?? []).filter((c) => c.status === "active");
  const featured = active.find((c) => access.ctx && canSellIn(access.ctx, c)) ?? active[0];
  const s = useMemo(() => (featured ? summarize(featured, (sales ?? []).filter((x) => x.campaignId === featured.id)) : null), [featured, sales]);
  const pct = s && s.total ? Math.round((s.sold / s.total) * 100) : 0;

  return (
    <Link
      href={featured ? `/campanhas/${featured.id}` : "/campanhas"}
      className={cn(
        "press anim-rise relative flex flex-col justify-end gap-1.5 overflow-hidden rounded-3xl bg-gradient-to-br from-[#f0c75a] to-[#c9921f] p-4 text-gold-ink shadow-[0_10px_30px_-6px_rgba(225,175,55,0.35)]",
        tall ? "row-span-2 min-h-[218px]" : "min-h-[150px]",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -top-[20%] -left-1/2 h-[140%] w-[38%] opacity-0 mix-blend-overlay"
        style={{
          background: "linear-gradient(90deg, rgba(255,250,230,0) 0%, rgba(255,250,230,.22) 40%, rgba(255,250,230,.38) 50%, rgba(255,250,230,.22) 60%, rgba(255,250,230,0) 100%)",
          animation: "shine-sweep 5.5s cubic-bezier(.45,0,.25,1) 1.4s infinite",
        }}
      />
      <Ticket aria-hidden className="absolute top-3 right-3 size-14 opacity-80" strokeWidth={1.5} style={{ animation: "float-y 3.2s ease-in-out infinite" }} />
      {active.length > 0 && (
        <span className="absolute top-3.5 left-3.5 flex items-center gap-1.5 rounded-lg bg-gold-ink px-2 py-1 text-[11px] font-bold text-[#f0c75a]">
          <span className="relative size-[7px]">
            <span className="absolute inset-0 rounded-full bg-[#f0c75a]" style={{ animation: "ping-dot 1.6s ease-out infinite" }} />
            <span className="absolute inset-0 rounded-full bg-[#f0c75a]" />
          </span>
          {active.length === 1 ? "1 ativa" : `${active.length} ativas`}
        </span>
      )}
      <strong className="relative font-display text-[28px] leading-[0.95] font-extrabold">
        Vender
        <br />
        rifa
      </strong>
      <span className="relative truncate text-[12px] font-semibold">
        {isError ? "Não foi possível carregar" : featured ? featured.name : campaigns ? "Nenhuma rifa ativa" : "Carregando…"}
      </span>
      {featured && s && <span className="relative text-[11.5px] font-medium tnum opacity-80">{`${s.sold} de ${s.total} vendidos`}</span>}
      {featured && (
        <span className="relative h-1.5 overflow-hidden rounded-full bg-gold-ink/20">
          <span className="anim-grow block h-full rounded-full bg-gold-ink" style={{ width: `${pct}%` }} />
        </span>
      )}
    </Link>
  );
}

function NextAgendaCard() {
  const { items, error } = useAgenda();
  const today = todayDateOnly();
  const next = items.find((i) => i.date >= today);
  const d = next ? parseDateOnly(next.date) : null;
  return (
    <Link
      href="/agenda"
      className="press anim-rise flex min-h-[104px] flex-col justify-between rounded-[22px] border border-[#9b8cf2]/35 bg-gradient-to-br from-[#2b2f7a] to-[#151a4d] p-3.5 text-[#e9edf8]"
      style={{ animationDelay: "70ms" }}
    >
      <span className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#c9c0ff]">Agenda</span>
        {d ? (
          <span className="flex size-[30px] flex-col items-center justify-center rounded-[10px] bg-[#9b8cf2] leading-none text-[#120d3a]">
            <span className="text-[7px] font-bold">{WEEKDAY[d.getUTCDay()]}</span>
            <span className="text-[13px] font-extrabold">{d.getUTCDate()}</span>
          </span>
        ) : (
          <CalendarDays className="size-5 text-[#c9c0ff]" aria-hidden />
        )}
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-[14px] font-semibold">{error ? "Agenda indisponível" : next ? next.title : "Nada marcado"}</strong>
        <span className="flex items-center gap-1.5 text-[11px] text-[#c9c0ff]">
          {next && <span className="size-1.5 rounded-full" style={{ background: AGENDA_KINDS[next.kind].color }} />}
          {next ? (next.date === today ? `hoje${next.time ? ` · ${next.time}` : ""}` : next.time ?? "dia inteiro") : "toque para ver o mês"}
        </span>
      </span>
    </Link>
  );
}

function BalanceCard() {
  const { data, isError } = useFinanceEntries();
  const s = summarizeFinance(data ?? []);
  return (
    <Link
      href="/financeiro"
      className="press anim-rise flex min-h-[104px] flex-col justify-between rounded-[22px] border border-[#5b86d9]/40 bg-gradient-to-br from-[#173a7a] to-[#0c1d4a] p-3.5 text-[#e9edf8]"
      style={{ animationDelay: "140ms" }}
    >
      <span className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#a9c3f2]">{isDemoMode ? "Caixa (demo)" : "Caixa"}</span>
        <svg width="44" height="18" viewBox="0 0 44 18" fill="none" aria-hidden>
          <path d="M1 15l8-4 7 3 9-8 8 4 10-8" stroke="#8fb0ec" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" style={{ animation: "draw-line 1.2s ease .6s both" }} />
        </svg>
      </span>
      <strong className="font-display text-[24px] leading-none font-extrabold tnum">{isError ? "—" : data ? formatMoneyCompact(s.balance) : "…"}</strong>
    </Link>
  );
}

/** Cartões grandes do topo (Início e Mais no celular): rifa, próximo compromisso e caixa. */
export function HeroCards({ className }: { className?: string }) {
  const access = useAccess();
  const hasRaffle = access.canModule("campaigns");
  const hasFinance = access.canModule("finance") && access.can("finance.view");
  const side = [<NextAgendaCard key="agenda" />, hasFinance && <BalanceCard key="cash" />].filter(Boolean);
  return (
    <div className={cn("grid gap-2.5", hasRaffle ? "grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" : "grid-cols-2", className)}>
      {hasRaffle && <RaffleCard tall={side.length > 1} />}
      {side}
    </div>
  );
}

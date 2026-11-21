"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, FileSpreadsheet, MinusCircle, PlusCircle, Ticket, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useCan3D } from "@/hooks/use-can-3d";
import { useAllSales, useCampaigns, useFinanceEntries } from "@/hooks/use-data";
import { useCountUp } from "@/hooks/use-count-up";
import { summarize } from "@/lib/raffle";
import { firstName, formatLongDate, formatMoney, formatMoneyCompact, formatMonth, formatShortMonth, greeting, todayDateOnly } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/misc";
import { ColumnChart } from "@/components/shared/column-chart";
import { ShowcaseCard } from "@/components/shared/showcase";
import { coinTowers, formatDelta, formatMoneyDiff, monthLabel, monthNumbers, type MonthNumbers } from "@/features/finance/month-numbers";
import { CampaignCollectionPanel, RecentEntriesPanel } from "./widgets";
import { Tile } from "./presidency-mobile";

const CoinTowers3D = dynamic(() => import("@/features/finance/coin-towers-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

const GOLD = "#e1af37";
const BLUE = "#5b86d9";

/* --------------------------------- dados --------------------------------- */

function useFinanceHome() {
  const access = useAccess();
  const entries = useFinanceEntries();
  const hasCampaigns = access.canModule("campaigns");
  const campaigns = useCampaigns(hasCampaigns);
  const sales = useAllSales(hasCampaigns);
  const today = todayDateOnly();
  const numbers = useMemo(() => (entries.data ? monthNumbers(entries.data, today) : null), [entries.data, today]);
  const towers = useMemo(() => (entries.data ? coinTowers(entries.data, today) : null), [entries.data, today]);
  // Rifas: o que já foi vendido e ainda não foi pago (mesmo cálculo do painel de arrecadação).
  const raffles = useMemo(() => {
    if (!campaigns.data || !sales.data) return null;
    return campaigns.data
      .filter((c) => c.status === "active")
      .reduce((n, c) => n + summarize(c, sales.data!.filter((s) => s.campaignId === c.id)).receivableCents, 0);
  }, [campaigns.data, sales.data]);
  return { access, entries, numbers, towers, raffles, hasCampaigns };
}

/** Botões grandes com o que o Financeiro mais faz. */
function useFinanceTiles(raffles: number | null, hasCampaigns: boolean) {
  const access = useAccess();
  const can = (p: Parameters<typeof access.can>[0]) => access.can(p);
  const tiles: { href: string; icon: LucideIcon; color: string; title: string; info: string; show: boolean }[] = [
    { href: "/financeiro/lancamentos?novo=income", icon: PlusCircle, color: "#3fcf8e", title: "Nova receita", info: "Registrar dinheiro que entrou", show: can("finance.register") },
    { href: "/financeiro/lancamentos?novo=expense", icon: MinusCircle, color: "#e88ab5", title: "Nova despesa", info: "Registrar um pagamento", show: can("finance.register") },
    { href: "/financeiro/lancamentos?importar=1", icon: FileSpreadsheet, color: BLUE, title: "Importar extrato", info: "Trazer o CSV do banco", show: can("finance.register") },
    { href: "/financeiro/relatorios", icon: BarChart3, color: "#b6a9ff", title: "Relatórios", info: "Gerar e compartilhar", show: can("finance.view") },
    {
      href: "/campanhas",
      icon: Ticket,
      color: GOLD,
      title: "Rifas a receber",
      info: raffles === null ? "Carregando…" : raffles > 0 ? `${formatMoneyCompact(raffles)} vendidos sem pagamento` : "Nada pendente nas rifas",
      show: hasCampaigns,
    },
  ];
  return tiles.filter((t) => t.show);
}

/* -------------------------------- peças -------------------------------- */

function Money({ cents, className }: { cents: number; className?: string }) {
  const value = useCountUp(cents, 1100);
  return <span className={cn("tnum", className)}>{formatMoney(value)}</span>;
}

/** Cartão do caixa: quanto há agora, a receber e a pagar. */
function CashCard({ numbers, raffles }: { numbers: MonthNumbers | null; raffles: number | null }) {
  return (
    <div className="anim-flip relative flex h-full flex-col overflow-hidden rounded-[22px] border border-gold/30 bg-[linear-gradient(150deg,#0b2470,#030f45_70%)] p-5 text-white">
      <span aria-hidden className="absolute -top-20 -right-16 size-56 rounded-full bg-gold/25 blur-3xl" />
      <span className="relative inline-flex items-center gap-2 text-[12px] font-semibold tracking-[0.14em] text-white/70 uppercase">
        <Wallet className="size-4" aria-hidden /> No caixa agora
      </span>
      {numbers ? (
        <Money cents={numbers.cash} className={cn("relative mt-3 block font-display text-[40px] leading-none font-extrabold", numbers.cash < 0 ? "text-[#ff8a8a]" : "text-[#f3d27c]")} />
      ) : (
        <span className="relative mt-3 block h-10 w-48 animate-pulse rounded-lg bg-white/10" />
      )}
      <span className="relative mt-1 block text-[12.5px] text-white/60">Tudo que entrou menos tudo que saiu{isDemoMode ? " (valores fictícios)" : ""}</span>
      <dl className="relative mt-auto grid gap-2 pt-5 text-[13.5px]">
        <div className="flex items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2">
          <dt className="text-white/70">A receber</dt>
          <dd className="tnum font-mono font-semibold text-[#7fe3b3]">{numbers ? formatMoney(numbers.receivable) : "—"}</dd>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2">
          <dt className="text-white/70">A pagar</dt>
          <dd className="tnum font-mono font-semibold text-[#ffb3c8]">{numbers ? formatMoney(numbers.payable) : "—"}</dd>
        </div>
        {raffles !== null && raffles > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2">
            <dt className="text-white/70">Rifas sem pagamento</dt>
            <dd className="tnum font-mono font-semibold text-[#f3d27c]">{formatMoney(raffles)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Um número do mês, com a comparação com o mês anterior. */
function MonthCard({
  label,
  cents,
  delta,
  goodWhenUp,
  numbers,
  icon: Icon,
  color,
  index,
  extra,
  money,
}: {
  label: string;
  cents: number;
  delta: number | null;
  goodWhenUp: boolean;
  numbers: MonthNumbers;
  icon: LucideIcon;
  color: string;
  index: number;
  extra?: string;
  /** Valor do mês anterior: mostra a diferença em reais em vez de % (melhor para saldo, que pode trocar de sinal). */
  money?: number;
}) {
  const up = (delta ?? 0) > 0;
  const flat = delta === null || Math.round(delta * 100) === 0;
  const good = flat ? null : up === goodWhenUp;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="anim-rise" style={{ animationDelay: `${200 + index * 70}ms` }}>
      <ShowcaseCard href="/financeiro/lancamentos" color={color} label={`${label}: ${formatMoney(cents)}`}>
        <span className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-fg-muted">{label}</span>
          <span className="grid size-9 place-items-center rounded-xl" style={{ background: `${color}22`, color }}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
        </span>
        <Money cents={cents} className="mt-3 block font-display text-[28px] leading-none font-extrabold" />
        <span className={cn("mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold", good === null ? "text-fg-subtle" : good ? "text-ok" : "text-danger")}>
          {!flat && <Arrow className="size-4" aria-hidden />}
            {money !== undefined ? formatMoneyDiff(cents - money, numbers.previous) : formatDelta(delta, numbers.previous)}
        </span>
        {extra && <span className="mt-1 block text-[12px] text-fg-subtle">{extra}</span>}
      </ShowcaseCard>
    </div>
  );
}

function MonthGrid({ numbers, compact }: { numbers: MonthNumbers | null; compact?: boolean }) {
  if (!numbers) return <div className={cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4")}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[150px] rounded-[20px]" />)}</div>;
  const overdue = numbers.overdue.count;
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4")}>
      <MonthCard index={0} label="Entrou" cents={numbers.current.income} delta={numbers.delta.income} goodWhenUp numbers={numbers} icon={ArrowDownRight} color="#3fcf8e" />
      <MonthCard index={1} label="Saiu" cents={numbers.current.expense} delta={numbers.delta.expense} goodWhenUp={false} numbers={numbers} icon={ArrowUpRight} color="#e88ab5" />
      <MonthCard index={2} label="Sobrou no mês" cents={numbers.current.balance} delta={numbers.delta.balance} money={numbers.previous.balance} goodWhenUp numbers={numbers} icon={TrendingUp} color={GOLD} />
      <div className="anim-rise" style={{ animationDelay: "410ms" }}>
        <ShowcaseCard href="/financeiro/lancamentos" color={overdue ? "#e5484d" : "#3fcf8e"} label={`Contas vencidas: ${overdue}`}>
          <span className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-fg-muted">Contas vencidas</span>
            <span className={cn("grid size-9 place-items-center rounded-xl", overdue ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok")}>
              <AlertTriangle className="size-[18px]" aria-hidden />
            </span>
          </span>
          <span className={cn("mt-3 block font-display text-[28px] leading-none font-extrabold tnum", overdue ? "text-danger" : "text-ok")}>{overdue}</span>
          <span className="mt-3 block text-[12.5px] text-fg-muted">{overdue ? `${formatMoney(numbers.overdue.amount)} com data já passada` : "Nada atrasado"}</span>
        </ShowcaseCard>
      </div>
    </div>
  );
}

/* ------------------------------ computador ------------------------------ */

export function FinanceDesktopHome() {
  const router = useRouter();
  const { access, entries, numbers, towers, raffles, hasCampaigns } = useFinanceHome();
  const tiles = useFinanceTiles(raffles, hasCampaigns);
  const show3D = useCan3D();
  const today = todayDateOnly();
  const [y, m] = today.split("-").map(Number);

  return (
    <div className="space-y-8">
      <header className="anim-rise">
        <p className="eyebrow !text-gold-fg">
          {access.department?.name ?? "Financeiro"} · {formatLongDate(new Date())}
        </p>
        <h1 className="mt-2.5 font-display text-[34px] leading-[1.08] font-bold">
          {greeting()}, {firstName(access.user?.name ?? "")}
        </h1>
        <p className="mt-2 text-[14px] text-fg-muted">Como está o dinheiro da Atlética hoje.</p>
      </header>

      <section aria-label="Entradas e saídas dos últimos 6 meses" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[400px] overflow-hidden rounded-[22px] border border-line bg-[radial-gradient(ellipse_at_top,#173a96,#030f45_72%)]">
          <div className="pointer-events-none absolute top-4 left-4 z-10 flex flex-wrap gap-2 text-[12px] font-semibold text-white">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 backdrop-blur">
              <span className="size-2.5 rounded-full" style={{ background: GOLD }} /> Entrou
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 backdrop-blur">
              <span className="size-2.5 rounded-full bg-[#3f74e0]" /> Saiu
            </span>
            <span className="rounded-full bg-black/35 px-2.5 py-1 text-white/75 backdrop-blur">Últimos 6 meses</span>
          </div>
          {entries.isError ? (
            <p className="grid h-full place-items-center text-[14px] text-white/70">Não foi possível carregar o financeiro.</p>
          ) : !towers ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : show3D ? (
            <>
              <CoinTowers3D months={towers} onPick={() => router.push("/financeiro/lancamentos")} />
              <p className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/35 px-3 py-1 text-[11.5px] text-white/75 backdrop-blur">
                Passe o mouse numa torre para ver o valor · arraste para girar
              </p>
            </>
          ) : (
            <div className="h-full bg-surface p-5 pt-14">
              <ColumnChart
                title="Entrou e saiu por mês"
                series={[
                  { name: "Entrou", color: "--chart-1" },
                  { name: "Saiu", color: "--chart-2" },
                ]}
                groups={towers.map((t) => ({ label: monthLabel(t), values: [t.income, t.expense] }))}
                format={formatMoney}
                extra={(g) => ({ label: "Sobrou no mês", value: formatMoney(g.values[0] - g.values[1]) })}
              />
            </div>
          )}
        </div>
        <CashCard numbers={numbers} raffles={raffles} />
      </section>

      {tiles.length > 0 && (
        <section aria-labelledby="fazer">
          <h2 id="fazer" className="mb-3 font-display text-[22px] font-bold">
            O que você quer fazer?
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((t, i) => (
              <Tile key={t.href} index={i} href={t.href} icon={t.icon} color={t.color} title={t.title} info={t.info} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="mes">
        <h2 id="mes" className="mb-3 font-display text-[22px] font-bold first-letter:uppercase">
          {formatMonth(y, m - 1)} em números
        </h2>
        <MonthGrid numbers={numbers} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentEntriesPanel />
        {hasCampaigns && <CampaignCollectionPanel />}
      </div>
    </div>
  );
}

/* -------------------------------- celular -------------------------------- */

/** Pilha de moedas em CSS (leve, sem 3D) para o cartão do celular. */
function CoinStack() {
  return (
    <span aria-hidden className="relative block h-16 w-14">
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className="anim-rise absolute left-0 h-3 w-14 rounded-[50%] border border-[#8a6410] bg-[linear-gradient(180deg,#f3d27c,#b28413)] shadow-[0_2px_0_#6e500c]"
          style={{ bottom: i * 8, animationDelay: `${300 + i * 90}ms` }}
        />
      ))}
    </span>
  );
}

export function FinanceMobileHome() {
  const { access, numbers, raffles, hasCampaigns } = useFinanceHome();
  const tiles = useFinanceTiles(raffles, hasCampaigns).slice(0, 4);
  const today = todayDateOnly();
  const [y, m] = today.split("-").map(Number);
  return (
    <div className="space-y-6">
      <header className="anim-rise">
        <p className="text-[14px] text-fg-muted">{greeting()},</p>
        <h1 className="font-display text-[30px] leading-tight font-bold">{firstName(access.user?.name ?? "")}</h1>
      </header>

      <div className="anim-flip relative overflow-hidden rounded-[26px] bg-[linear-gradient(150deg,#0b2470,#030f45_70%)] p-5 text-white">
        <span aria-hidden className="absolute -top-16 -right-10 size-44 rounded-full bg-gold/25 blur-3xl" />
        <div className="relative flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-[0.14em] text-white/70 uppercase">No caixa agora</p>
            {numbers ? (
              <Money cents={numbers.cash} className="mt-2 block font-display text-[34px] leading-none font-extrabold text-[#f3d27c]" />
            ) : (
              <span className="mt-2 block h-9 w-40 animate-pulse rounded-lg bg-white/10" />
            )}
          </div>
          <CoinStack />
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-xl bg-white/[0.07] px-3 py-2">
            <p className="text-white/65">A receber</p>
            <p className="tnum font-mono font-semibold text-[#7fe3b3]">{numbers ? formatMoneyCompact(numbers.receivable) : "—"}</p>
          </div>
          <div className="rounded-xl bg-white/[0.07] px-3 py-2">
            <p className="text-white/65">A pagar</p>
            <p className="tnum font-mono font-semibold text-[#ffb3c8]">{numbers ? formatMoneyCompact(numbers.payable) : "—"}</p>
          </div>
        </div>
      </div>

      {tiles.length > 0 && (
        <section aria-labelledby="fazer-m">
          <h2 id="fazer-m" className="mb-3 font-display text-[20px] font-bold">
            O que você quer fazer?
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t, i) => (
              <Tile key={t.href} index={i} href={t.href} icon={t.icon} color={t.color} title={t.title} info={t.info} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="mes-m">
        <h2 id="mes-m" className="mb-3 font-display text-[20px] font-bold">
          {formatShortMonth(y, m - 1).replace(/^./, (c) => c.toUpperCase())} até agora
        </h2>
        <MonthGrid numbers={numbers} compact />
      </section>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { MinusCircle, PlusCircle } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useFinanceEntries } from "@/hooks/use-data";
import { formatDate, formatMoney, formatShortMonth, todayDateOnly } from "@/lib/format";
import { entryStatusMeta } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/shared/page";
import { DemoNotice, EmptyState, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { ListRow } from "@/components/shared/list-row";
import { ColumnChart } from "@/components/shared/column-chart";
import { CampaignCollectionPanel, FinanceStats, RecentEntriesPanel, StatsRow } from "@/features/home/widgets";
import { FinanceNav } from "@/features/finance/finance-nav";
import { byMonth } from "@/features/finance/utils";

export default function FinanceOverviewPage() {
  const access = useAccess();
  const enabled = access.canModule("finance");
  const { data, isLoading, isError, error, refetch } = useFinanceEntries(enabled);
  const months = useMemo(() => byMonth(data ?? []).slice(-6), [data]);
  if (!enabled) return <RestrictedState />;

  const today = todayDateOnly();
  const upcoming = (data ?? []).filter((e) => e.status === "pending").sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <PageHeader
        eyebrow="Controle interno"
        title="Financeiro"
        description="Receitas, despesas e pendências da Atlética."
        actions={
          access.can("finance.register") && (
            <>
              <ButtonLink href="/financeiro/lancamentos?novo=expense">
                <MinusCircle /> Nova despesa
              </ButtonLink>
              <ButtonLink href="/financeiro/lancamentos?novo=income" variant="primary">
                <PlusCircle /> Nova receita
              </ButtonLink>
            </>
          )
        }
      />
      <FinanceNav />
      {isDemoMode && (
        <DemoNotice className="mb-5">Todos os valores são fictícios e servem apenas para demonstrar a interface. Não há integração bancária nem pagamentos reais.</DemoNotice>
      )}
      {isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-4">
          <StatsRow>
            <FinanceStats />
          </StatsRow>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel title="Receitas e despesas realizadas" description="Por mês, últimos 6 meses com movimento">
              {isLoading ? (
                <InlineLoader />
              ) : months.length === 0 ? (
                <EmptyState compact title="Sem movimentações realizadas" />
              ) : (
                <ColumnChart
                  title="Receitas e despesas realizadas por mês"
                  series={[
                    { name: "Receitas", color: "--chart-1" },
                    { name: "Despesas", color: "--chart-2" },
                  ]}
                  groups={months.map((m) => ({ label: `${formatShortMonth(m.year, m.month)}/${String(m.year).slice(2)}`, values: [m.income, m.expense] }))}
                  format={formatMoney}
                  extra={(g) => ({ label: "Saldo do mês", value: formatMoney(g.values[0] - g.values[1]) })}
                />
              )}
            </Panel>
            <Panel title="Pendências" description="A receber e a pagar, por data" bodyClassName="py-1.5">
              {isLoading ? (
                <InlineLoader />
              ) : upcoming.length === 0 ? (
                <EmptyState compact title="Nada pendente" />
              ) : (
                <ul className="divide-y divide-line">
                  {upcoming.slice(0, 6).map((e) => (
                    <li key={e.id}>
                      <ListRow
                        href={`/financeiro/lancamentos?id=${e.id}`}
                        title={e.description}
                        subtitle={`${formatDate(e.date)}${e.date < today ? " · vencido" : ""} · ${entryStatusMeta(e.type, e.status).label}`}
                        trailing={
                          <span className={cn("tnum font-mono text-[13px] font-semibold", e.type === "income" ? "text-ok" : "text-fg")}>
                            {e.type === "income" ? "+" : "−"} {formatMoney(e.amount)}
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RecentEntriesPanel />
            {access.canModule("campaigns") && <CampaignCollectionPanel />}
          </div>
        </div>
      )}
    </>
  );
}

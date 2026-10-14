"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Ticket } from "lucide-react";
import type { Campaign } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useAllSales, useCampaigns, useDirectory } from "@/hooks/use-data";
import { summarize } from "@/lib/raffle";
import { canSellIn } from "@/lib/policies";
import { CAMPAIGN_STATUS } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { PageHeader } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { OwnershipBadge, StatusBadge } from "@/components/shared/badges";

type Filter = "active" | "closed" | "mine" | "shared" | "sell" | "all";

export default function CampaignsPage() {
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("campaigns");
  const { data: campaigns, isLoading, isError, error, refetch } = useCampaigns();
  const { data: sales } = useAllSales(enabled);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");

  const summaries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarize>>();
    for (const c of campaigns ?? []) map.set(c.id, summarize(c, (sales ?? []).filter((s) => s.campaignId === c.id)));
    return map;
  }, [campaigns, sales]);

  const tests: Record<Filter, (c: Campaign) => boolean> = {
    active: (c) => c.status === "active",
    closed: (c) => c.status === "closed",
    mine: (c) => c.createdBy === access.user?.id,
    shared: (c) => c.createdBy !== access.user?.id && access.ownership(c) === "shared",
    sell: (c) => c.status === "active" && !!access.ctx && canSellIn(access.ctx, c),
    all: () => true,
  };
  const count = (f: Filter) => (campaigns ?? []).filter(tests[f]).length;
  const rows = (campaigns ?? [])
    .filter(tests[filter])
    .filter((c) => matchesQuery(query, c.name, c.prize, c.code, dir.memberName(c.createdBy)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!enabled) return <RestrictedState />;

  const columns: Column<Campaign>[] = [
    {
      key: "name",
      header: "Campanha",
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{c.name}</p>
          <p className="truncate text-[12px] text-fg-subtle">
            <span className="font-mono">{c.code}</span> · {c.prize}
          </p>
        </div>
      ),
    },
    {
      key: "creator",
      header: "Criação",
      hideBelow: "lg",
      cell: (c) => (
        <div className="text-[12.5px]">
          <p className="text-fg">{dir.memberName(c.createdBy)}</p>
          <p className="text-fg-subtle">{formatDate(c.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "numbers",
      header: "Números",
      hideBelow: "xl",
      cell: (c) => (
        <span className="tnum font-mono text-[12.5px] text-fg-muted">
          {c.quantity} × {formatMoney(c.unitPrice)}
        </span>
      ),
    },
    {
      key: "progress",
      header: "Vendidos",
      cell: (c) => {
        const s = summaries.get(c.id);
        return s ? (
          <div className="w-36">
            <Progress value={s.sold} max={s.total} label="Números vendidos" />
            <p className="tnum mt-1.5 font-mono text-[12px] text-fg-muted">
              {s.sold}/{s.total} · {Math.round((s.sold / s.total) * 100)}%
            </p>
          </div>
        ) : null;
      },
    },
    { key: "status", header: "Situação", cell: (c) => <StatusBadge meta={CAMPAIGN_STATUS[c.status]} /> },
    { key: "access", header: "Origem", hideBelow: "lg", cell: (c) => <OwnershipBadge record={c} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Arrecadação"
        title="Campanhas e vendas"
        description="Rifas autorizadas para o seu perfil. Abra uma campanha para ver a grade de números e registrar vendas."
        actions={
          access.can("campaigns.create") && (
            <ButtonLink href="/campanhas/nova" variant="primary">
              <Plus /> Nova rifa
            </ButtonLink>
          )
        }
      />
      <section className="rounded-xl border border-line bg-surface">
        <Toolbar>
          <FilterChips
            ariaLabel="Filtrar campanhas"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: "Ativas", count: count("active") },
              { value: "closed", label: "Encerradas", count: count("closed") },
              { value: "mine", label: "Criadas por mim", count: count("mine") },
              { value: "shared", label: "Compartilhadas comigo", count: count("shared") },
              ...(access.can("campaigns.register") ? [{ value: "sell" as const, label: "Posso vender", count: count("sell") }] : []),
              { value: "all", label: "Todas", count: count("all") },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar por nome, prêmio ou código" className="lg:w-72" />
        </Toolbar>
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : (
          <DataTable
            caption="Campanhas"
            rows={rows}
            columns={columns}
            loading={isLoading}
            getRowId={(c) => c.id}
            onRowClick={(c) => router.push(`/campanhas/${c.id}`)}
            mobileCard={(c) => {
              const s = summaries.get(c.id);
              return (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.name}</p>
                      <p className="truncate text-[12px] text-fg-subtle">{c.prize}</p>
                    </div>
                    <StatusBadge meta={CAMPAIGN_STATUS[c.status]} />
                  </div>
                  {s && (
                    <div className="flex items-center gap-3">
                      <Progress value={s.sold} max={s.total} className="flex-1" label="Vendidos" />
                      <span className="tnum font-mono text-[12px] text-fg-muted">
                        {s.sold}/{s.total}
                      </span>
                    </div>
                  )}
                  <p className="text-[12px] text-fg-subtle">
                    {dir.memberName(c.createdBy)} · {formatDate(c.createdAt)}
                  </p>
                </div>
              );
            }}
            empty={
              <EmptyState
                icon={<Ticket />}
                title={query ? "Nenhuma campanha encontrada" : "Nenhuma campanha neste filtro"}
                description={query ? "Tente buscar por outro termo." : "Troque o filtro ou crie uma nova rifa."}
                action={
                  access.can("campaigns.create") && !query ? (
                    <ButtonLink href="/campanhas/nova" variant="primary">
                      <Plus /> Nova rifa
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
          />
        )}
      </section>
    </>
  );
}

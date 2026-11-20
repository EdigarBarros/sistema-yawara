"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, RotateCcw, Ticket } from "lucide-react";
import type { Campaign } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useAllSales, useCampaigns, useDirectory } from "@/hooks/use-data";
import { summarize } from "@/lib/raffle";
import { canSellIn } from "@/lib/policies";
import { matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page";
import { ShowcaseGrid } from "@/components/shared/showcase";
import { FilterChips, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { CampaignCard } from "@/features/campaigns/campaign-card";
import { CampaignPreview } from "@/features/campaigns/campaign-preview";
import { useIsDesktop } from "@/hooks/use-media";

type Filter = "active" | "closed" | "mine" | "shared" | "sell" | "all";

export default function CampaignsPage() {
  const isDesktop = useIsDesktop();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("campaigns");
  const { data: campaigns, isLoading, isError, error, refetch } = useCampaigns();
  const { data: sales, isError: salesFailed, error: salesError, refetch: refetchSales } = useAllSales(enabled);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const summaries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarize>>();
    // Sem as vendas (ainda carregando ou com erro) não há como calcular o progresso: nada de "0 vendidos" falso.
    if (!sales) return map;
    for (const c of campaigns ?? []) map.set(c.id, summarize(c, sales.filter((s) => s.campaignId === c.id)));
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

  const preview = previewId ? ((campaigns ?? []).find((c) => c.id === previewId) ?? null) : null;

  if (!enabled)
    return (
      <RestrictedState
        description={isDemoMode ? undefined : "Seu cargo não tem acesso às campanhas, ou o módulo está desativado nas configurações. Se precisar, procure a presidência."}
      />
    );

  return (
    <>
      <PageHeader
        eyebrow="Arrecadação"
        title="Campanhas e vendas"
        description="Rifas autorizadas para o seu perfil. Toque numa campanha para ver o resumo; abra para ver a grade e registrar vendas."
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
        {!isError && salesFailed && (
          <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-line bg-danger/[0.06] px-4 py-3 text-[13px] text-fg-muted sm:px-5">
            <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
            <span className="min-w-0 flex-1">Não foi possível carregar as vendas para calcular o progresso. {errorMessage(salesError)}</span>
            <Button size="sm" onClick={() => refetchSales()}>
              <RotateCcw /> Tentar novamente
            </Button>
          </div>
        )}
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : (
          <div className="rounded-b-xl bg-surface-2/50 p-4 sm:p-5">
            <ShowcaseGrid
              label="Campanhas"
              items={rows}
              loading={isLoading}
              getId={(c) => c.id}
              render={(c) => {
                const common = {
                  campaign: c,
                  summary: summaries.get(c.id),
                  salesState: (sales ? "ok" : salesFailed ? "failed" : "loading") as "ok" | "failed" | "loading",
                  creatorName: dir.memberName(c.createdBy),
                };
                return isDesktop ? <CampaignCard {...common} onClick={() => setPreviewId(c.id)} /> : <CampaignCard {...common} href={`/campanhas/${c.id}`} />;
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
          </div>
        )}
      </section>
      <CampaignPreview campaign={preview} sales={sales} onClose={() => setPreviewId(null)} />
    </>
  );
}

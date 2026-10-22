"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarDays, Coins, Download, Gift, Hourglass, ListOrdered, Lock, LockOpen, MessageCircle, MoreHorizontal, Pencil, ShieldCheck, ShoppingCart, UserRound } from "lucide-react";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useCampaign, useCampaignSales, useDirectory } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { useSession } from "@/stores/session";
import { isFirebaseMode } from "@/lib/mode";
import { buildSlots, summarize } from "@/lib/raffle";
import { canCloseCampaign, canManageCampaign, canSellIn } from "@/lib/policies";
import { CAMPAIGN_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatMoneyCompact, formatTime } from "@/lib/format";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { DetailList, MetaItem, PageHeader, Panel, Stat } from "@/components/shared/page";
import { ErrorState, RecordErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge, OwnershipBadge } from "@/components/shared/badges";
import { HistoryTimeline } from "@/components/shared/history";
import { confirmAction } from "@/components/shared/confirm";
import { RaffleBoard } from "@/features/campaigns/raffle-grid";
import { NumberSheet } from "@/features/campaigns/number-sheet";
import { ExportDialog } from "@/features/campaigns/export-dialog";
import { CampaignEditDialog } from "@/features/campaigns/campaign-edit-dialog";
import { SalesTable } from "@/features/campaigns/sales-table";
import { CampaignAccessSummary } from "@/features/campaigns/access-config";
import { RelatedEventLabel } from "@/features/campaigns/event-field";
import { CampaignNotice } from "@/features/campaigns/notice";
import { ActionTile, RaffleMobile, type ActionTileProps, type RaffleMobileView } from "@/features/campaigns/mobile/raffle-mobile";
import { ShareSheet } from "@/features/campaigns/mobile/share-sheet";
import { UnpaidSheet, type UnpaidView } from "@/features/campaigns/mobile/unpaid-sheet";
import { BatchSheet } from "@/features/campaigns/mobile/batch-sheet";
import { SaleWizard } from "@/features/campaigns/mobile/sale-wizard";
import { useIsDesktop } from "@/hooks/use-media";

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ver = useSearchParams().get("ver");
  const initialView: RaffleMobileView = ver === "pendentes" || ver === "reservados" || ver === "divulgar" ? ver : null;
  const isDesktop = useIsDesktop();
  const access = useAccess();
  const dir = useDirectory();
  const { data: campaign, isLoading, isError, error, refetch } = useCampaign(id);
  const { data: sales, isLoading: salesLoading, isError: salesFailed, error: salesError, refetch: refetchSales } = useCampaignSales(id, !!campaign);
  useBreadcrumbTitle(`/campanhas/${id}`, campaign?.name);

  // Tempo real (Firebase): vendas e situação da campanha atualizadas enquanto a tela está aberta.
  const qc = useQueryClient();
  const uid = useSession((s) => s.userId) ?? "anon";
  // Começa depois do primeiro carregamento das vendas (o retrato de acesso já está disponível).
  const loaded = !!campaign && !!sales;
  useEffect(() => {
    const subscribe = services.campaigns.subscribe;
    if (!isFirebaseMode || !loaded || !subscribe) return;
    return subscribe(id, () => {
      void qc.invalidateQueries({ queryKey: [uid, "campaigns", id] });
      void qc.invalidateQueries({ queryKey: [uid, "sales"] });
    });
  }, [id, loaded, qc, uid]);

  const [openNumber, setOpenNumber] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saleNumbers, setSaleNumbers] = useState<number[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [editTab, setEditTab] = useState<"dados" | "acesso" | null>(null);
  const [tab, setTab] = useState("numeros");
  // Computador: as mesmas ações rápidas do celular. Vindo do "Precisa de você" (?ver=...), a lista certa já abre.
  const [shareOpen, setShareOpen] = useState(isDesktop && initialView === "divulgar");
  const [unpaidView, setUnpaidView] = useState<UnpaidView>(initialView === "reservados" ? "reservados" : "pendentes");
  const [unpaidOpen, setUnpaidOpen] = useState(isDesktop && (initialView === "pendentes" || initialView === "reservados"));
  const [batchOpen, setBatchOpen] = useState(false);
  const [board, setBoard] = useState<{ key: number; filter: "all" | "available" }>({ key: 0, filter: "all" });

  const slots = useMemo(() => (campaign ? buildSlots(campaign, sales ?? []) : []), [campaign, sales]);
  const summary = useMemo(() => (campaign ? summarize(campaign, sales ?? []) : null), [campaign, sales]);

  const close = useAction(() => services.campaigns.close(id), { success: "Campanha encerrada", successDescription: "Novas vendas estão bloqueadas." });
  const reopen = useAction(() => services.campaigns.reopen(id), { success: "Campanha reaberta para vendas" });

  if (isLoading || salesLoading) return <PageSkeleton />;
  if (isError || !campaign || !summary)
    return (
      <RecordErrorState error={error} notFound="Campanha não encontrada" backHref="/campanhas" onRetry={() => refetch()} />
    );

  const ctx = access.ctx;
  const active = campaign.status === "active";
  const canSell = !!ctx && active && !salesFailed && canSellIn(ctx, campaign);
  const canManage = !!ctx && canManageCampaign(ctx, campaign);
  const canClose = !!ctx && canCloseCampaign(ctx, campaign);
  const slot = openNumber ? slots[openNumber - 1] ?? null : null;
  const soldPct = Math.round((summary.sold / summary.total) * 100);

  const startSale = (numbers: number[]) => {
    setOpenNumber(null);
    setSaleNumbers(numbers);
  };

  const askClose = async () => {
    const ok = await confirmAction({
      title: "Encerrar esta campanha?",
      description: `Novas vendas serão bloqueadas. ${summary.reserved} número(s) reservado(s) e ${summary.pending} com pagamento pendente continuam podendo ser convertidos, confirmados, desfeitos ou cancelados. A Central não realiza o sorteio.`,
      confirmLabel: "Encerrar campanha",
      tone: "danger",
    });
    if (ok) close.runSafe();
  };

  const askReopen = async () => {
    const ok = await confirmAction({ title: "Reabrir campanha?", description: "Novas vendas voltarão a ser permitidas.", confirmLabel: "Reabrir" });
    if (ok) reopen.runSafe();
  };

  const refreshAfterConflict = () => {
    void refetchSales();
    void refetch();
  };

  const pendingSales = (sales ?? []).filter((x) => x.status === "pending").length;
  const quickActions: Omit<ActionTileProps, "index">[] = [
    {
      icon: ListOrdered,
      color: "#94b6d0",
      title: "Números livres",
      info: summary.available === 0 ? "Todos vendidos 🎉" : `${summary.available} para vender`,
      onClick: () => {
        setTab("numeros");
        setBoard((b) => ({ key: b.key + 1, filter: "available" }));
        requestAnimationFrame(() => document.getElementById("grade")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      },
    },
    { icon: MessageCircle, color: "#3fcf8e", title: "Mandar no WhatsApp", info: "Imagem da tabela ou lista de livres", onClick: () => setShareOpen(true) },
    {
      icon: Hourglass,
      color: "#f2a93b",
      title: "Quem não pagou",
      info: pendingSales === 0 ? "Ninguém devendo" : `${formatMoneyCompact(summary.receivableCents)} para receber`,
      onClick: () => {
        setUnpaidView("pendentes");
        setUnpaidOpen(true);
      },
      badge: pendingSales,
    },
  ];
  if (canSell && canManage) quickActions.push({ icon: BookOpen, color: "#e88ab5", title: "Passar vendas antigas", info: "Do caderno para o sistema", onClick: () => setBatchOpen(true) });

  const sharedDialogs = (
    <>
      <NumberSheet campaign={campaign} slot={slot} onOpenChange={(o) => !o && setOpenNumber(null)} onSell={(n) => startSale([n])} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} campaign={campaign} slots={slots} />
      <CampaignEditDialog open={editTab !== null} onOpenChange={(o) => !o && setEditTab(null)} campaign={campaign} initialTab={editTab ?? "dados"} />
    </>
  );

  if (!isDesktop) {
    return (
      <>
        {salesFailed ? (
          <section className="rounded-[22px] border border-line bg-surface">
            <ErrorState message={errorMessage(salesError, "Não foi possível carregar as vendas desta rifa.")} onRetry={() => refetchSales()} />
          </section>
        ) : (
          <RaffleMobile
            campaign={campaign}
            sales={sales ?? []}
            slots={slots}
            summary={summary}
            canSell={canSell}
            canManage={canManage}
            canClose={canClose}
            initialView={initialView}
            onOpenNumber={setOpenNumber}
            onStartSale={startSale}
            onExport={() => setExportOpen(true)}
            onEdit={setEditTab}
            onClose={askClose}
            onReopen={askReopen}
            onConflict={refreshAfterConflict}
          />
        )}
        {saleNumbers !== null && (
          <SaleWizard open onOpenChange={(o) => !o && setSaleNumbers(null)} campaign={campaign} slots={slots} initialNumbers={saleNumbers} onConflict={refreshAfterConflict} />
        )}
        {sharedDialogs}
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: "/campanhas", label: "Campanhas e vendas" }}
        eyebrow={`Rifa · ${campaign.code}`}
        title={campaign.name}
        badge={
          <>
            <StatusBadge meta={CAMPAIGN_STATUS[campaign.status]} />
            <OwnershipBadge record={campaign} />
          </>
        }
        meta={
          <>
            <MetaItem icon={<UserRound />}>
              Criada por <b>{dir.memberName(campaign.createdBy)}</b> em {formatDate(campaign.createdAt)}, às {formatTime(campaign.createdAt)}
            </MetaItem>
            <MetaItem icon={<Gift />}>{campaign.prize}</MetaItem>
            <MetaItem icon={<Coins />}>
              <b>{formatMoney(campaign.unitPrice)}</b> por número
            </MetaItem>
            {campaign.drawDate && (
              <MetaItem icon={<CalendarDays />}>
                Sorteio previsto para <b>{formatDate(campaign.drawDate)}</b>
              </MetaItem>
            )}
          </>
        }
        actions={
          <>
            <Button onClick={() => setExportOpen(true)} disabled={salesFailed}>
              <Download /> Exportar
            </Button>
            {canSell && (
              <Button variant="primary" onClick={() => startSale([...selected])}>
                <ShoppingCart /> Registrar venda
              </Button>
            )}
            {(canManage || canClose) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="Mais ações">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {canManage && (
                    <>
                      <DropdownMenuItem icon={<Pencil />} onSelect={() => setEditTab("dados")}>
                        Editar dados da campanha
                      </DropdownMenuItem>
                      <DropdownMenuItem icon={<ShieldCheck />} onSelect={() => setEditTab("acesso")}>
                        Acesso e permissões
                      </DropdownMenuItem>
                    </>
                  )}
                  {canClose &&
                    (active ? (
                      <DropdownMenuItem
                        icon={<Lock />}
                        tone="danger"
                        hint="Bloqueia novas vendas; reservas e pagamentos pendentes continuam gerenciáveis"
                        onSelect={askClose}
                      >
                        Encerrar campanha
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        icon={<LockOpen />}
                        onSelect={askReopen}
                      >
                        Reabrir campanha
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {!active && (
        <CampaignNotice
          tone="warn"
          className="mb-5"
          demo={
            <>
              <strong className="text-fg">Campanha encerrada</strong> {campaign.closedAt && `em ${formatDateTime(campaign.closedAt)}`}
              {campaign.closedBy && ` por ${dir.memberName(campaign.closedBy)}`}. Novas vendas estão bloqueadas. A Central não realiza nem registra sorteios.
            </>
          }
          live={
            <>
              <strong className="text-fg">Campanha encerrada</strong> {campaign.closedAt && `em ${formatDateTime(campaign.closedAt)}`}
              {campaign.closedBy && ` por ${dir.memberName(campaign.closedBy)}`}. Novas vendas estão bloqueadas; reservas e pagamentos pendentes continuam podendo ser
              convertidos, confirmados, desfeitos ou cancelados. A Central não realiza nem registra sorteios.
            </>
          }
        />
      )}

      {salesFailed ? (
        <section className="rounded-xl border border-line bg-surface">
          <ErrorState message={errorMessage(salesError, "Não foi possível carregar as vendas desta campanha.")} onRetry={() => refetchSales()} />
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Vendidos" value={summary.sold} suffix={`/ ${summary.total}`} footer={<span>{soldPct}% dos números</span>}>
              <Progress value={summary.sold} max={summary.total} className="mb-2.5" label="Números vendidos" />
            </Stat>
            <Stat
              label="Recebido"
              value={formatMoneyCompact(summary.receivedCents)}
              footer={
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-ok" />
                  {summary.paid} números pagos
                </span>
              }
            />
            <Stat
              label="A receber"
              value={formatMoneyCompact(summary.receivableCents)}
              footer={
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-warn" />
                  {summary.pending} com pagamento pendente
                </span>
              }
            />
            <Stat
              label="Disponíveis"
              value={summary.available}
              footer={
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-ice" />
                  {summary.reserved} reservados
                </span>
              }
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {quickActions.map((t, i) => (
              <ActionTile key={t.title} {...t} index={i} />
            ))}
          </div>

          <Tabs value={tab} onValueChange={setTab} className="mt-6">
            <TabsList>
              <TabsTrigger value="numeros">Números</TabsTrigger>
              <TabsTrigger value="vendas" count={sales?.length}>
                Vendas
              </TabsTrigger>
              <TabsTrigger value="detalhes">Detalhes e acesso</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="numeros" className="mt-5" id="grade">
              <RaffleBoard
                key={board.key}
                initialFilter={board.filter}
                slots={slots}
                total={campaign.quantity}
                selecting={selecting}
                onToggleSelecting={() => {
                  setSelecting((v) => !v);
                  setSelected(new Set());
                }}
                selected={selected}
                onToggleSelect={(n) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(n)) next.delete(n);
                    else next.add(n);
                    return next;
                  })
                }
                onClearSelection={() => setSelected(new Set())}
                onOpen={setOpenNumber}
                canSelect={canSell}
                onSellSelected={() => startSale([...selected])}
              />
            </TabsContent>

            <TabsContent value="vendas" className="mt-5">
              <SalesTable campaign={campaign} sales={sales ?? []} onOpen={setOpenNumber} />
            </TabsContent>

            <TabsContent value="detalhes" className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel title="Sobre a campanha">
                  {campaign.description && <p className="mb-4 text-[13.5px] leading-relaxed text-fg-muted">{campaign.description}</p>}
                  <DetailList
                    items={[
                      { label: "Prêmio", value: campaign.prize },
                      { label: "Quantidade", value: `${campaign.quantity} números` },
                      { label: "Valor unitário", value: formatMoney(campaign.unitPrice) },
                      { label: "Arrecadação máxima", value: formatMoney(campaign.quantity * campaign.unitPrice) },
                      { label: "Início", value: formatDate(campaign.startDate) },
                      { label: "Encerramento", value: formatDate(campaign.endDate) },
                      { label: "Sorteio previsto", value: formatDate(campaign.drawDate) },
                      { label: "Evento relacionado", value: <RelatedEventLabel eventId={campaign.eventId} /> },
                      { label: "Departamento", value: dir.department(campaign.departmentId)?.name ?? "—" },
                    ]}
                  />
                  {campaign.notes && <p className="mt-4 rounded-lg border border-line bg-sunken px-3.5 py-3 text-[13px] text-fg-muted">{campaign.notes}</p>}
                </Panel>
                <Panel title="Registro" description="Preenchido automaticamente pela Central">
                  <DetailList
                    items={[
                      { label: "Identificador", value: <span className="font-mono">{campaign.code}</span> },
                      { label: "Criada por", value: dir.memberName(campaign.createdBy) },
                      { label: "Criada em", value: formatDateTime(campaign.createdAt) },
                      { label: "Última alteração", value: `${formatDateTime(campaign.updatedAt)} · ${dir.memberName(campaign.updatedBy)}` },
                      { label: "Modalidade", value: "Rifa" },
                    ]}
                  />
                </Panel>
              </div>
              <Panel
                title="Acesso e permissões"
                description={isFirebaseMode ? "Aplicado pelo servidor em cada operação e pelas regras de acesso aos dados." : "Simulação: o controle real será aplicado pelo backend."}
                actions={
                  canManage && (
                    <Button size="sm" onClick={() => setEditTab("acesso")}>
                      <ShieldCheck /> Alterar
                    </Button>
                  )
                }
              >
                <CampaignAccessSummary access={campaign.access} creatorId={campaign.createdBy} />
              </Panel>
            </TabsContent>

            <TabsContent value="historico" className="mt-5">
              <Panel title="Histórico da campanha" description="Criação, edições, compartilhamento e encerramento. O histórico de cada venda fica no detalhe do número.">
                <HistoryTimeline entries={campaign.history} limit={20} />
              </Panel>
            </TabsContent>
          </Tabs>
        </>
      )}

      {saleNumbers !== null && (
        <SaleWizard
          open
          onOpenChange={(o) => {
            if (o) return;
            setSaleNumbers(null);
            setSelected(new Set());
            setSelecting(false);
          }}
          campaign={campaign}
          slots={slots}
          initialNumbers={saleNumbers}
          onConflict={refreshAfterConflict}
        />
      )}
      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} campaign={campaign} slots={slots} />
      <UnpaidSheet
        open={unpaidOpen}
        onOpenChange={setUnpaidOpen}
        campaign={campaign}
        sales={sales ?? []}
        view={unpaidView}
        onViewChange={setUnpaidView}
        onOpenNumber={(n) => {
          setUnpaidOpen(false);
          setOpenNumber(n);
        }}
      />
      <BatchSheet open={batchOpen} onOpenChange={setBatchOpen} campaign={campaign} slots={slots} onConflict={refreshAfterConflict} />
      {sharedDialogs}
    </>
  );
}

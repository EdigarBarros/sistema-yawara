"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, Coins, Download, Gift, Lock, LockOpen, MoreHorizontal, Pencil, ShieldCheck, ShoppingCart, UserRound } from "lucide-react";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useCampaign, useCampaignSales, useDirectory } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { buildSlots, summarize } from "@/lib/raffle";
import { canCloseCampaign, canManageCampaign, canSellIn } from "@/lib/policies";
import { CAMPAIGN_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatMoneyCompact, formatTime } from "@/lib/format";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { DetailList, MetaItem, PageHeader, Panel, Stat } from "@/components/shared/page";
import { ErrorState, PageSkeleton, DemoNotice } from "@/components/shared/states";
import { StatusBadge, OwnershipBadge } from "@/components/shared/badges";
import { HistoryTimeline } from "@/components/shared/history";
import { confirmAction } from "@/components/shared/confirm";
import { RaffleBoard } from "@/features/campaigns/raffle-grid";
import { NumberSheet } from "@/features/campaigns/number-sheet";
import { RegisterSaleDialog } from "@/features/campaigns/sale-dialogs";
import { ExportDialog } from "@/features/campaigns/export-dialog";
import { CampaignEditDialog } from "@/features/campaigns/campaign-edit-dialog";
import { SalesTable } from "@/features/campaigns/sales-table";
import { CampaignAccessSummary } from "@/features/campaigns/access-config";

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const { data: campaign, isLoading, isError, error, refetch } = useCampaign(id);
  const { data: sales } = useCampaignSales(id, !!campaign);
  useBreadcrumbTitle(`/campanhas/${id}`, campaign?.name);

  const [openNumber, setOpenNumber] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saleNumbers, setSaleNumbers] = useState<number[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [editTab, setEditTab] = useState<"dados" | "acesso" | null>(null);
  const [tab, setTab] = useState("numeros");

  const slots = useMemo(() => (campaign ? buildSlots(campaign, sales ?? []) : []), [campaign, sales]);
  const summary = useMemo(() => (campaign ? summarize(campaign, sales ?? []) : null), [campaign, sales]);

  const close = useAction(() => services.campaigns.close(id), { success: "Campanha encerrada", successDescription: "Novas vendas estão bloqueadas." });
  const reopen = useAction(() => services.campaigns.reopen(id), { success: "Campanha reaberta para vendas" });

  if (isLoading) return <PageSkeleton />;
  if (isError || !campaign || !summary)
    return (
      <ErrorState
        message={errorMessage(error, "Campanha não encontrada.")}
        onRetry={() => (error ? refetch() : router.push("/campanhas"))}
      />
    );

  const ctx = access.ctx;
  const active = campaign.status === "active";
  const canSell = !!ctx && active && canSellIn(ctx, campaign);
  const canManage = !!ctx && canManageCampaign(ctx, campaign);
  const canClose = !!ctx && canCloseCampaign(ctx, campaign);
  const slot = openNumber ? slots[openNumber - 1] ?? null : null;
  const soldPct = Math.round((summary.sold / summary.total) * 100);

  const startSale = (numbers: number[]) => {
    setOpenNumber(null);
    setSaleNumbers(numbers);
  };

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
            <Button onClick={() => setExportOpen(true)}>
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
                        hint="Bloqueia novas vendas; pagamentos pendentes ainda podem ser confirmados"
                        onSelect={async () => {
                          const ok = await confirmAction({
                            title: "Encerrar esta campanha?",
                            description: `Novas vendas serão bloqueadas. ${summary.pending} venda(s) pendente(s) continuam podendo ser confirmadas. A Central não realiza o sorteio.`,
                            confirmLabel: "Encerrar campanha",
                            tone: "danger",
                          });
                          if (ok) close.runSafe();
                        }}
                      >
                        Encerrar campanha
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        icon={<LockOpen />}
                        onSelect={async () => {
                          const ok = await confirmAction({ title: "Reabrir campanha?", description: "Novas vendas voltarão a ser permitidas.", confirmLabel: "Reabrir" });
                          if (ok) reopen.runSafe();
                        }}
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
        <DemoNotice tone="warn" className="mb-5">
          <strong className="text-fg">Campanha encerrada</strong> {campaign.closedAt && `em ${formatDateTime(campaign.closedAt)}`}
          {campaign.closedBy && ` por ${dir.memberName(campaign.closedBy)}`}. Novas vendas estão bloqueadas. A Central não realiza nem registra sorteios.
        </DemoNotice>
      )}

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

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="numeros">Números</TabsTrigger>
          <TabsTrigger value="vendas" count={sales?.length}>
            Vendas
          </TabsTrigger>
          <TabsTrigger value="detalhes">Detalhes e acesso</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="numeros" className="mt-5">
          <RaffleBoard
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
            description="Simulação: o controle real será aplicado pelo backend."
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

      <NumberSheet campaign={campaign} slot={slot} onOpenChange={(o) => !o && setOpenNumber(null)} onSell={(n) => startSale([n])} />
      <RegisterSaleDialog
        open={saleNumbers !== null}
        onOpenChange={(o) => !o && setSaleNumbers(null)}
        campaign={campaign}
        slots={slots}
        initialNumbers={saleNumbers ?? []}
        onRegistered={() => {
          setSelected(new Set());
          setSelecting(false);
        }}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} campaign={campaign} slots={slots} />
      <CampaignEditDialog open={editTab !== null} onOpenChange={(o) => !o && setEditTab(null)} campaign={campaign} initialTab={editTab ?? "dados"} />
    </>
  );
}

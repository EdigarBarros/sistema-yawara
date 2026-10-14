"use client";

import { useState } from "react";
import { BadgeCheck, Ban, Download, Eye, Lock, Pencil, RotateCcw, ShoppingCart, Undo2, Unlock } from "lucide-react";
import type { Campaign, NumberSlot, Sale } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { canEditSale, canSeeBuyer, canSellIn } from "@/lib/policies";
import { NUMBER_STATUS, PAYMENT_METHOD_LABELS, SALE_STATUS } from "@/lib/labels";
import { formatDateTime, formatMoney } from "@/lib/format";
import { formatNumberRanges, padNumber } from "@/lib/raffle";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { DetailList, SectionTitle } from "@/components/shared/page";
import { HistoryTimeline } from "@/components/shared/history";
import { FileRow } from "@/components/shared/pickers";
import { askReason, confirmAction } from "@/components/shared/confirm";
import { ConfirmPaymentDialog, EditSaleDialog } from "./sale-dialogs";

function Restricted() {
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-subtle">
      <Lock className="size-3.5" /> Restrito ao seu perfil
    </span>
  );
}

function ReceiptView({ sale }: { sale: Sale }) {
  if (!sale.receipt) return <span className="text-fg-subtle">Não anexado</span>;
  const url = services.files.getObjectUrl(sale.receipt.blobId);
  return (
    <FileRow
      name={sale.receipt.name}
      size={sale.receipt.size}
      meta={url ? "neste navegador" : "exemplo sem arquivo"}
      actions={
        url ? (
          <>
            <a href={url} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Visualizar comprovante">
              <Eye className="size-4" />
            </a>
            <a href={url} download={sale.receipt.name} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Baixar comprovante">
              <Download className="size-4" />
            </a>
          </>
        ) : undefined
      }
    />
  );
}

interface NumberSheetProps {
  campaign: Campaign;
  slot: NumberSlot | null;
  onOpenChange: (open: boolean) => void;
  onSell: (n: number) => void;
}

/** Painel lateral com os detalhes de um número e as ações permitidas ao perfil. */
export function NumberSheet({ campaign, slot, onOpenChange, onSell }: NumberSheetProps) {
  const access = useAccess();
  const dir = useDirectory();
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const setStatus = useAction((id: string, s: "reserved" | "pending") => services.campaigns.setSaleStatus(id, s), { success: "Situação atualizada" });
  const cancel = useAction((id: string, reason: string) => services.campaigns.cancelSale(id, reason), {
    success: "Venda cancelada",
    successDescription: "O registro foi mantido no histórico. Libere os números para vendê-los novamente.",
  });
  const release = useAction((id: string) => services.campaigns.releaseSale(id), { success: "Números liberados para nova venda" });
  const revert = useAction((id: string, reason: string) => services.campaigns.revertPayment(id, reason), { success: "Confirmação de pagamento desfeita" });

  if (!slot) return <Sheet open={false} onOpenChange={onOpenChange} />;

  const sale = slot.sale;
  const ctx = access.ctx;
  const meta = NUMBER_STATUS[slot.status];
  const active = campaign.status === "active";
  const canSell = !!ctx && canSellIn(ctx, campaign) && active;
  const canEdit = !!ctx && !!sale && canEditSale(ctx, sale);
  const canApprove = access.can("campaigns.approve");
  const buyerAllowed = !!ctx && !!sale && canSeeBuyer(ctx, campaign, sale);
  const others = sale && sale.numbers.length > 1 ? sale.numbers : null;
  const num = padNumber(slot.number, campaign.quantity);

  const saleState =
    slot.status === "available" ? "Não vendido" : slot.status === "reserved" ? "Reservado" : slot.status === "cancelled" ? "Cancelada" : "Registrada";
  const payState = slot.status === "paid" ? "Confirmado" : slot.status === "pending" ? "Pendente" : "—";

  const actions: React.ReactNode[] = [];
  if (slot.status === "available") {
    if (canSell)
      actions.push(
        <Button key="sell" variant="primary" onClick={() => onSell(slot.number)}>
          <ShoppingCart /> Registrar venda
        </Button>,
      );
  } else if (sale) {
    if ((slot.status === "pending" || slot.status === "reserved") && canApprove)
      actions.push(
        <Button key="pay" variant="primary" onClick={() => setPayOpen(true)}>
          <BadgeCheck /> Confirmar pagamento
        </Button>,
      );
    if (slot.status === "reserved" && canEdit)
      actions.push(
        <Button key="toPending" onClick={() => setStatus.runSafe(sale.id, "pending")} loading={setStatus.pending}>
          <ShoppingCart /> Converter em venda
        </Button>,
      );
    if (slot.status === "pending" && canEdit)
      actions.push(
        <Button key="toReserved" variant="ghost" onClick={() => setStatus.runSafe(sale.id, "reserved")} loading={setStatus.pending}>
          <Undo2 /> Voltar para reservado
        </Button>,
      );
    if (slot.status !== "cancelled" && canEdit)
      actions.push(
        <Button key="edit" onClick={() => setEditOpen(true)}>
          <Pencil /> Editar dados
        </Button>,
      );
    if (slot.status === "paid" && canApprove)
      actions.push(
        <Button
          key="revert"
          variant="ghost"
          loading={revert.pending}
          onClick={async () => {
            const reason = await askReason({
              title: "Desfazer confirmação de pagamento?",
              description: "A venda volta para “pagamento pendente”. Use apenas para corrigir um registro feito por engano.",
              confirmLabel: "Desfazer confirmação",
              reason: { label: "Motivo", placeholder: "Ex.: pagamento confirmado no número errado" },
            });
            if (reason) await revert.runSafe(sale.id, reason);
          }}
        >
          <RotateCcw /> Desfazer confirmação
        </Button>,
      );
    if (slot.status !== "cancelled" && (slot.status === "paid" ? canApprove : canEdit))
      actions.push(
        <Button
          key="cancel"
          variant="danger"
          loading={cancel.pending}
          onClick={async () => {
            const reason = await askReason({
              title: others ? `Cancelar a venda de ${others.length} números?` : `Cancelar a venda do número ${num}?`,
              description: others
                ? `Esta venda inclui os números ${formatNumberRanges(others, campaign.quantity)}. Todos serão cancelados. O registro permanece no histórico.`
                : "O registro permanece no histórico. Depois, você poderá liberar o número para nova venda.",
              confirmLabel: "Cancelar venda",
              cancelLabel: "Manter venda",
              tone: "danger",
              reason: { label: "Motivo do cancelamento", placeholder: "Ex.: comprador desistiu" },
            });
            if (reason) await cancel.runSafe(sale.id, reason);
          }}
        >
          <Ban /> Cancelar venda
        </Button>,
      );
    if (slot.status === "cancelled" && access.can("campaigns.edit"))
      actions.push(
        <Button
          key="release"
          variant="primary"
          loading={release.pending}
          onClick={async () => {
            const ok = await confirmAction({
              title: others ? `Liberar ${others.length} números?` : `Liberar o número ${num}?`,
              description: `${others ? `Os números ${formatNumberRanges(others, campaign.quantity)} voltarão` : "O número voltará"} a ficar disponível para venda. O registro cancelado continua no histórico.`,
              confirmLabel: "Liberar para venda",
            });
            if (ok) await release.runSafe(sale.id);
          }}
        >
          <Unlock /> Liberar para nova venda
        </Button>,
      );
  }

  return (
    <>
      <Sheet open={!!slot} onOpenChange={onOpenChange}>
        <SheetContent
          eyebrow="Número da rifa"
          title={
            <span className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[34px] leading-none tracking-[-0.03em]">{num}</span>
              <Badge tone={meta.tone} dot>
                {meta.label}
              </Badge>
            </span>
          }
          description={meta.description}
          footer={actions.length ? actions : undefined}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-line bg-sunken px-3 py-2.5">
                <p className="eyebrow !text-[10px]">Venda</p>
                <p className="mt-1.5 text-[13.5px] font-semibold">{saleState}</p>
              </div>
              <div className="rounded-lg border border-line bg-sunken px-3 py-2.5">
                <p className="eyebrow !text-[10px]">Pagamento</p>
                <p className={cn("mt-1.5 text-[13.5px] font-semibold", slot.status === "paid" && "text-ok", slot.status === "pending" && "text-warn")}>{payState}</p>
              </div>
            </div>

            {!sale && (
              <p className="text-[13px] text-fg-muted">
                {active
                  ? canSell
                    ? "Este número está livre. Registre uma venda ou uma reserva."
                    : "Este número está livre, mas seu perfil não está autorizado a registrar vendas nesta campanha."
                  : "A campanha está encerrada e não aceita novas vendas."}{" "}
                Valor: <b className="tnum font-mono text-fg">{formatMoney(campaign.unitPrice)}</b>.
              </p>
            )}

            {sale && (
              <>
                {others && (
                  <div className="rounded-lg border border-info/25 bg-info/[0.07] px-3.5 py-2.5 text-[12.5px] text-fg-muted">
                    Venda com <b className="text-fg">{others.length} números</b>: <span className="font-mono text-fg">{formatNumberRanges(others, campaign.quantity)}</span>. Alterações afetam
                    todos.
                  </div>
                )}
                <div>
                  <SectionTitle>Comprador e venda</SectionTitle>
                  <DetailList
                    items={[
                      { label: "Comprador", value: buyerAllowed && sale.buyer ? sale.buyer.name : <Restricted /> },
                      { label: "Contato", value: buyerAllowed && sale.buyer ? <span className="font-mono">{sale.buyer.contact}</span> : <Restricted /> },
                      { label: "Responsável pela venda", value: dir.memberName(sale.sellerId) },
                      { label: "Registrado por", value: dir.memberName(sale.registeredById) },
                      { label: "Data da venda", value: formatDateTime(sale.createdAt) },
                      { label: "Situação", value: SALE_STATUS[sale.status].label },
                    ]}
                  />
                </div>
                {sale.status !== "reserved" && sale.status !== "cancelled" && (
                  <div>
                    <SectionTitle>Pagamento</SectionTitle>
                    <DetailList
                      items={[
                        { label: "Forma de pagamento", value: sale.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod] : "Não informada" },
                        { label: "Confirmado em", value: sale.paidAt ? formatDateTime(sale.paidAt) : "Aguardando confirmação" },
                        { label: "Confirmado por", value: sale.confirmedById ? dir.memberName(sale.confirmedById) : "—", hidden: !sale.confirmedById },
                      ]}
                    />
                    <div className="mt-2 border-t border-line pt-1">
                      <p className="pt-2 text-[13px] text-fg-subtle">Comprovante</p>
                      <ReceiptView sale={sale} />
                    </div>
                  </div>
                )}
                {sale.status === "cancelled" && (
                  <div>
                    <SectionTitle>Cancelamento</SectionTitle>
                    <DetailList
                      items={[
                        { label: "Motivo", value: sale.cancelReason ?? "—" },
                        { label: "Cancelada por", value: dir.memberName(sale.cancelledById) },
                        { label: "Em", value: formatDateTime(sale.cancelledAt) },
                      ]}
                    />
                  </div>
                )}
                {sale.notes && (
                  <div>
                    <SectionTitle>Observações</SectionTitle>
                    <p className="text-[13px] whitespace-pre-line text-fg-muted">{sale.notes}</p>
                  </div>
                )}
                <div>
                  <SectionTitle>Histórico de alterações</SectionTitle>
                  <HistoryTimeline entries={sale.history} />
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {sale && (
        <>
          <EditSaleDialog open={editOpen} onOpenChange={setEditOpen} campaign={campaign} sale={sale} />
          <ConfirmPaymentDialog open={payOpen} onOpenChange={setPayOpen} campaign={campaign} sale={sale} />
        </>
      )}
    </>
  );
}

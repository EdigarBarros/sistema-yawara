"use client";

import { useState } from "react";
import { BadgeCheck, ChevronRight, Lock, MessageCircle } from "lucide-react";
import type { Campaign, Sale } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory } from "@/hooks/use-data";
import { canSeeBuyer } from "@/lib/policies";
import { daysBetween, formatMoney, toDateOnly, todayDateOnly } from "@/lib/format";
import { formatNumberRanges } from "@/lib/raffle";
import { whatsappLink, whatsappNumber } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { Dialog, BigSheetContent } from "@/components/ui/dialog";
import { ConfirmPaymentDialog } from "../sale-dialogs";
import { chargeText } from "../share-text";
import { STALE_SALE_DAYS } from "@/features/home/pending-rules";

export type UnpaidView = "pendentes" | "reservados";

interface UnpaidSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  sales: Sale[];
  view: UnpaidView;
  onViewChange: (v: UnpaidView) => void;
  onOpenNumber: (n: number) => void;
}

function age(sale: Sale) {
  return daysBetween(toDateOnly(new Date(sale.createdAt)), todayDateOnly());
}

function ageLabel(days: number) {
  return days <= 0 ? "hoje" : days === 1 ? "ontem" : `há ${days} dias`;
}

/** "Quem não pagou": lista para cobrar no WhatsApp e marcar o pagamento recebido. */
export function UnpaidSheet(props: UnpaidSheetProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <UnpaidBody {...props} />}
    </Dialog>
  );
}

function UnpaidBody({ campaign, sales, view, onViewChange, onOpenNumber }: UnpaidSheetProps) {
  const access = useAccess();
  const dir = useDirectory();
  const canApprove = access.can("campaigns.approve");
  const [paying, setPaying] = useState<Sale | null>(null);

  const status = view === "pendentes" ? "pending" : "reserved";
  const list = sales.filter((s) => s.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const count = (st: Sale["status"]) => sales.filter((s) => s.status === st).length;
  const owed = list.reduce((sum, s) => sum + s.numbers.length * campaign.unitPrice, 0);

  return (
    <BigSheetContent
      title={view === "pendentes" ? "Quem ainda não pagou" : "Números reservados"}
      description={
        list.length === 0
          ? campaign.name
          : view === "pendentes"
            ? `${list.length} ${list.length === 1 ? "venda" : "vendas"} · ${formatMoney(owed)} para receber`
            : `${list.length} ${list.length === 1 ? "reserva" : "reservas"} esperando virar venda`
      }
    >
      <div role="tablist" aria-label="Escolher lista" className="mb-4 grid grid-cols-2 gap-1.5 rounded-2xl bg-sunken p-1.5">
        {(
          [
            ["pendentes", "Falta pagar", count("pending")],
            ["reservados", "Reservados", count("reserved")],
          ] as [UnpaidView, string, number][]
        ).map(([v, label, n]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className={cn("press h-11 rounded-xl text-[15px] font-semibold transition-colors", view === v ? "bg-surface-3 text-fg shadow-[0_0_0_1px_var(--line-strong)]" : "text-fg-muted")}
          >
            {label} <span className="tnum opacity-70">({n})</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="anim-rise rounded-[22px] border border-ok/30 bg-ok/[0.09] p-5 text-center">
          <p className="text-[17px] font-semibold">{view === "pendentes" ? "Ninguém devendo! 🎉" : "Nenhuma reserva parada."}</p>
          <p className="mt-1 text-[14px] text-fg-muted">{view === "pendentes" ? "Todas as vendas desta rifa já estão pagas." : "Todos os números reservados já viraram venda."}</p>
        </div>
      ) : (
        <ul key={view} className="space-y-3">
          {list.map((sale, i) => {
            const visible = !!access.ctx && canSeeBuyer(access.ctx, campaign, sale) && !!sale.buyer;
            const phone = visible ? whatsappNumber(sale.buyer?.contact) : null;
            const days = age(sale);
            const late = view === "pendentes" && days >= STALE_SALE_DAYS;
            return (
              <li key={sale.id} className="anim-row rounded-[22px] border border-line bg-sunken p-4" style={{ animationDelay: `${Math.min(i * 50, 500)}ms` }}>
                <button type="button" onClick={() => onOpenNumber(sale.numbers[0])} className="flex w-full items-start gap-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[16px] font-semibold">
                      {visible ? (
                        sale.buyer!.name
                      ) : (
                        <>
                          <Lock className="size-4 text-fg-subtle" aria-hidden /> Comprador restrito
                        </>
                      )}
                    </span>
                    <span className="block font-mono text-[14px] text-fg-muted">{formatNumberRanges(sale.numbers, campaign.quantity)}</span>
                    <span className="mt-0.5 block text-[13px] text-fg-muted">
                      <span className={cn(late && "font-semibold text-danger")}>{ageLabel(days)}</span> · vendido por {sale.sellerId === access.user?.id ? "você" : dir.memberName(sale.sellerId)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-display text-[20px] font-bold tnum">
                    {formatMoney(sale.numbers.length * campaign.unitPrice)}
                    <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
                  </span>
                </button>
                {view === "pendentes" && (phone || canApprove) && (
                  <div className={cn("mt-3 grid gap-2", phone && canApprove ? "grid-cols-2" : "grid-cols-1")}>
                    {phone && (
                      <a
                        href={whatsappLink(chargeText(campaign, sale), sale.buyer?.contact)}
                        target="_blank"
                        rel="noreferrer"
                        className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#25d366] text-[15px] font-bold text-[#052e16]"
                      >
                        <MessageCircle className="size-[18px]" aria-hidden /> Cobrar
                      </a>
                    )}
                    {canApprove && (
                      <button type="button" onClick={() => setPaying(sale)} className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gold text-[15px] font-bold text-gold-ink">
                        <BadgeCheck className="size-[18px]" aria-hidden /> Já pagou
                      </button>
                    )}
                  </div>
                )}
                {view === "pendentes" && visible && !phone && <p className="mt-2 text-[12.5px] text-fg-subtle">Sem telefone cadastrado para cobrar pelo WhatsApp.</p>}
              </li>
            );
          })}
        </ul>
      )}
      {paying && <ConfirmPaymentDialog open onOpenChange={(o) => !o && setPaying(null)} campaign={campaign} sale={paying} />}
    </BigSheetContent>
  );
}

"use client";

import { useMemo } from "react";
import { ArrowRight, BellRing, Megaphone } from "lucide-react";
import type { Campaign, NumberStatus, Sale } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory } from "@/hooks/use-data";
import { buildSlots, isSaleActive, padNumber, summarize } from "@/lib/raffle";
import { canSellIn } from "@/lib/policies";
import { CAMPAIGN_STATUS, NUMBER_STATUS, SALE_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { ButtonLink } from "@/components/ui/button";
import { DetailList, SectionTitle } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/badges";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { ProgressRing } from "@/components/shared/showcase";
import { CAMPAIGN_COLOR, drawLabel } from "./campaign-card";

const SLOT_COLORS: Record<NumberStatus, string> = {
  available: "bg-surface-3",
  reserved: "bg-ice",
  pending: "bg-warn",
  paid: "bg-ok",
  cancelled: "bg-danger",
};

/** Prévia lateral de uma rifa: o essencial para decidir se precisa abrir a campanha. */
export function CampaignPreview({ campaign, sales, onClose }: { campaign: Campaign | null; sales: Sale[] | undefined; onClose: () => void }) {
  return (
    <Sheet open={!!campaign} onOpenChange={(open) => !open && onClose()}>
      {campaign && <PreviewBody campaign={campaign} sales={sales} />}
    </Sheet>
  );
}

function PreviewBody({ campaign: c, sales: allSales }: { campaign: Campaign; sales: Sale[] | undefined }) {
  const access = useAccess();
  const dir = useDirectory();
  const sales = useMemo(() => (allSales ?? []).filter((s) => s.campaignId === c.id), [allSales, c.id]);
  const summary = allSales ? summarize(c, sales) : null;
  const slots = useMemo(() => buildSlots(c, sales), [c, sales]);

  const sellers = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sales) if (isSaleActive(s) && (s.status === "paid" || s.status === "pending")) map.set(s.sellerId, (map.get(s.sellerId) ?? 0) + s.numbers.length);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales]);
  const topCount = sellers[0]?.[1] ?? 1;
  const latest = useMemo(() => [...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [sales]);

  const canSell = !!access.ctx && c.status === "active" && canSellIn(access.ctx, c);
  const href = `/campanhas/${c.id}`;

  return (
    <SheetContent
      width="lg"
      eyebrow={
        <span className="flex items-center gap-2 normal-case tracking-normal">
          <span className="font-mono">{c.code}</span>
          <StatusBadge meta={CAMPAIGN_STATUS[c.status]} />
        </span>
      }
      title={c.name}
      description={`Prêmio: ${c.prize}`}
      footer={
        <>
          <ButtonLink href={href} variant="primary">
            Abrir campanha <ArrowRight />
          </ButtonLink>
          {summary && summary.pending > 0 && (
            <ButtonLink href={`${href}?ver=pendentes`}>
              <BellRing /> Cobrar pendentes ({summary.pending})
            </ButtonLink>
          )}
          {canSell && (
            <ButtonLink href={`${href}?ver=divulgar`} variant="ghost">
              <Megaphone /> Divulgar
            </ButtonLink>
          )}
        </>
      }
    >
      <div className="space-y-7">
        {summary ? (
          <div className="anim-flip flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-surface-2 p-4">
            <ProgressRing value={summary.sold} max={summary.total} size={104} stroke={9} color={CAMPAIGN_COLOR} label={`${summary.sold} de ${summary.total} vendidos`}>
              <span className="tnum block font-display text-[26px] font-extrabold">{Math.round((summary.sold / summary.total) * 100)}%</span>
              <span className="mt-0.5 block text-[11px] text-fg-subtle">vendido</span>
            </ProgressRing>
            <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fig label="Vendidos" value={`${summary.sold}/${summary.total}`} />
              <Fig label="Pagos" value={String(summary.paid)} tone="text-ok" />
              <Fig label="Pendentes" value={String(summary.pending)} tone={summary.pending ? "text-warn" : undefined} />
              <Fig label="Reservados" value={String(summary.reserved)} />
              <Fig label="Recebido" value={formatMoney(summary.receivedCents)} tone="text-ok" />
              <Fig label="A receber" value={formatMoney(summary.receivableCents)} tone={summary.receivableCents ? "text-warn" : undefined} />
            </dl>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-surface-2 p-4 text-[13px] text-fg-muted">Não foi possível carregar as vendas desta campanha agora. Abra a campanha para tentar de novo.</p>
        )}

        {summary && (
          <section>
            <SectionTitle>Grade de números</SectionTitle>
            <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`${summary.available} disponíveis, ${summary.reserved} reservados, ${summary.pending} pendentes, ${summary.paid} pagos`}>
              {slots.map((slot, i) => (
                <span
                  key={slot.number}
                  title={`${padNumber(slot.number, c.quantity)} · ${NUMBER_STATUS[slot.status].label}`}
                  className={cn("anim-pop size-2.5 rounded-[3px]", SLOT_COLORS[slot.status])}
                  style={{ animationDelay: `${Math.min(i, 300) * 2}ms` }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-muted">
              {(["available", "reserved", "pending", "paid"] as const).map((k) => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-[3px]", SLOT_COLORS[k])} aria-hidden />
                  {k === "pending" ? "Pendente" : NUMBER_STATUS[k].label}
                </li>
              ))}
            </ul>
          </section>
        )}

        {sellers.length > 0 && (
          <section>
            <SectionTitle>Quem mais vendeu</SectionTitle>
            <ol className="space-y-2.5">
              {sellers.map(([id, count], i) => (
                <li key={id} className="anim-row flex items-center gap-3" style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="tnum w-4 text-right font-mono text-[12px] text-fg-subtle">{i + 1}</span>
                  <MemberAvatar id={id} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2 text-[13px]">
                      <span className="truncate font-medium">{dir.memberName(id)}</span>
                      <span className="tnum shrink-0 font-mono text-fg-muted">{count}</span>
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span className="anim-grow block h-full rounded-full" style={{ width: `${(count / topCount) * 100}%`, background: CAMPAIGN_COLOR }} />
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {latest.length > 0 && (
          <section>
            <SectionTitle>Últimas vendas</SectionTitle>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {latest.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                  <span className="tnum w-24 shrink-0 truncate font-mono text-fg">
                    {s.numbers.slice(0, 3).map((n) => padNumber(n, c.quantity)).join(", ")}
                    {s.numbers.length > 3 && ` +${s.numbers.length - 3}`}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.buyer?.name ?? dir.memberName(s.sellerId)}</span>
                    <span className="block truncate text-[11.5px] text-fg-subtle">
                      {s.buyer ? `por ${dir.memberName(s.sellerId)} · ` : ""}
                      {formatRelative(s.createdAt)}
                    </span>
                  </span>
                  <StatusBadge meta={SALE_STATUS[s.status]} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionTitle>Detalhes</SectionTitle>
          <DetailList
            items={[
              { label: "Sorteio", value: drawLabel(c) },
              { label: "Período de vendas", value: c.startDate || c.endDate ? `${formatDate(c.startDate)} a ${formatDate(c.endDate)}` : "—" },
              { label: "Números", value: `${c.quantity} × ${formatMoney(c.unitPrice)}` },
              { label: "Arrecadação possível", value: formatMoney(c.quantity * c.unitPrice) },
              { label: "Criada por", value: `${dir.memberName(c.createdBy)} em ${formatDate(c.createdAt)}` },
            ]}
          />
        </section>
      </div>
    </SheetContent>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-fg-subtle">{label}</dt>
      <dd className={cn("tnum truncate font-mono text-[15px] font-semibold", tone)}>{value}</dd>
    </div>
  );
}

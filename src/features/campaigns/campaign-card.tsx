"use client";

import { CalendarClock, Gift, Ticket } from "lucide-react";
import type { Campaign, CampaignSummary } from "@/types";
import { AREA_COLORS } from "@/components/layout/nav";
import { CAMPAIGN_STATUS } from "@/lib/labels";
import { daysBetween, formatDate, formatMoneyCompact, todayDateOnly } from "@/lib/format";
import { OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { ProgressRing, ShowcaseCard, countdownLabel } from "@/components/shared/showcase";
import { Skeleton } from "@/components/ui/misc";

export const CAMPAIGN_COLOR = AREA_COLORS["/campanhas"] ?? "#e1af37";

/** Texto do sorteio: "Sorteio em 5 dias", "Sorteio hoje", "Sorteado em 12/03"... */
export function drawLabel(c: Campaign) {
  if (!c.drawDate) return "Sem data de sorteio";
  const days = daysBetween(todayDateOnly(), c.drawDate);
  if (days < 0) return `Sorteio foi em ${formatDate(c.drawDate)}`;
  return `Sorteio ${countdownLabel(days)}`;
}

/** Cartão de uma rifa na vitrine: progresso em anel, dinheiro e prazo do sorteio. */
export function CampaignCard({
  campaign: c,
  summary: s,
  salesState,
  creatorName,
  ...target
}: ({ href: string; onClick?: never } | { onClick: () => void; href?: never }) & {
  campaign: Campaign;
  summary?: CampaignSummary;
  salesState: "ok" | "loading" | "failed";
  creatorName: string;
}) {
  const pct = s && s.total > 0 ? Math.round((s.sold / s.total) * 100) : 0;
  const closed = c.status === "closed";
  const soon = !!c.drawDate && !closed && daysBetween(todayDateOnly(), c.drawDate) <= 7 && daysBetween(todayDateOnly(), c.drawDate) >= 0;

  return (
    <ShowcaseCard {...target} color={CAMPAIGN_COLOR} label={`Campanha ${c.name}`} className={closed ? "opacity-80" : undefined}>
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl text-[#06102e] transition-transform duration-300 group-hover:-rotate-6"
            style={{ background: `linear-gradient(145deg, ${CAMPAIGN_COLOR}, ${CAMPAIGN_COLOR}b8)` }}
          >
            <Ticket className="size-[18px]" strokeWidth={2.2} aria-hidden />
          </span>
          <span className="truncate font-mono text-[12px] text-fg-subtle">{c.code}</span>
        </span>
        <StatusBadge meta={CAMPAIGN_STATUS[c.status]} />
      </span>

      <span className="mt-3 block min-w-0">
        <span className="line-clamp-2 block font-display text-[21px] leading-tight font-bold">{c.name}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
          <Gift className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">{c.prize}</span>
        </span>
      </span>

      <span className="mt-4 flex items-center gap-4">
        {s ? (
          <ProgressRing value={s.sold} max={s.total} label={`${s.sold} de ${s.total} números vendidos`} color={CAMPAIGN_COLOR}>
            <span className="tnum block font-display text-[19px] font-extrabold">{pct}%</span>
            <span className="mt-0.5 block text-[10px] text-fg-subtle">vendido</span>
          </ProgressRing>
        ) : salesState === "loading" ? (
          <Skeleton className="size-[76px] rounded-full" />
        ) : (
          <span className="grid size-[76px] shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-center text-[11px] text-fg-subtle">
            Indisponível
          </span>
        )}
        <span className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2.5">
          <Mini label="Vendidos" value={s ? `${s.sold}/${s.total}` : "—"} />
          <Mini label="Reservados" value={s ? String(s.reserved) : "—"} />
          <Mini label="Recebido" value={s ? formatMoneyCompact(s.receivedCents) : "—"} tone="ok" />
          <Mini label="A receber" value={s ? formatMoneyCompact(s.receivableCents) : "—"} tone={s && s.receivableCents > 0 ? "warn" : undefined} />
        </span>
      </span>

      <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${soon ? "font-semibold text-gold-fg" : "text-fg-muted"}`}>
          <CalendarClock className="size-3.5" aria-hidden />
          {drawLabel(c)}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="hidden truncate text-[12px] text-fg-subtle xl:inline">{creatorName}</span>
          <OwnershipBadge record={c} />
        </span>
      </span>
    </ShowcaseCard>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <span className="block min-w-0">
      <span className="block text-[11px] text-fg-subtle">{label}</span>
      <span className={`tnum block truncate font-mono text-[14px] font-semibold ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg"}`}>{value}</span>
    </span>
  );
}

"use client";

import { memo, useState } from "react";
import type { NumberSlot } from "@/types";
import { NUMBER_STATUS } from "@/lib/labels";
import { padNumber } from "@/lib/raffle";
import { cn } from "@/lib/utils";
import { CELL_STYLES } from "../raffle-grid";

/** Números desenhados de uma vez; o resto aparece em "Mostrar mais" (rifas grandes). */
const PAGE = 100;

interface CellProps {
  slot: NumberSlot;
  total: number;
  selected: boolean;
  dimmed: boolean;
  onTap: (n: number) => void;
}

const Cell = memo(function Cell({ slot, total, selected, dimmed, onTap }: CellProps) {
  const meta = NUMBER_STATUS[slot.status];
  return (
    <button
      type="button"
      onClick={() => onTap(slot.number)}
      aria-label={`Número ${padNumber(slot.number, total)}: ${meta.label}${selected ? ", escolhido" : ""}`}
      aria-pressed={selected}
      className={cn(
        "relative grid h-14 place-items-center rounded-xl border font-mono text-[16px] font-semibold tabular-nums transition-[transform,background-color,border-color] duration-200 active:scale-90",
        CELL_STYLES[slot.status],
        slot.status === "available" && "text-fg",
        selected && "scale-[1.04] border-gold bg-gold text-gold-ink hover:text-gold-ink ring-2 ring-gold/50 ring-offset-2 ring-offset-surface",
        dimmed && "opacity-35",
      )}
    >
      {padNumber(slot.number, total)}
      {meta.symbol && !selected && (
        <span className="absolute top-1 right-1.5 font-sans text-[10px] leading-none font-bold no-underline" aria-hidden>
          {meta.symbol}
        </span>
      )}
    </button>
  );
});

interface NumberPadProps {
  slots: NumberSlot[];
  total: number;
  selected?: Set<number>;
  onTap: (n: number) => void;
  /** Deixa apagados os números que não podem ser escolhidos agora. */
  dimUnavailable?: boolean;
}

/** Grade de números com botões grandes, para tocar com o dedo. */
export function NumberPad({ slots, total, selected, onTap, dimUnavailable }: NumberPadProps) {
  const [limit, setLimit] = useState(PAGE);
  const visible = slots.slice(0, limit);
  return (
    <div>
      <div className="grid grid-cols-5 gap-2 min-[420px]:grid-cols-6">
        {visible.map((s) => (
          <Cell key={s.number} slot={s} total={total} selected={!!selected?.has(s.number)} dimmed={!!dimUnavailable && s.status !== "available"} onTap={onTap} />
        ))}
      </div>
      {slots.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="press mt-3 h-12 w-full rounded-2xl border border-line-strong text-[15px] font-semibold">
          Mostrar mais números ({slots.length - limit})
        </button>
      )}
    </div>
  );
}

/** Legenda curta das cores, em linguagem simples. */
export function SimpleLegend() {
  const items: [keyof typeof CELL_STYLES, string][] = [
    ["available", "Livre"],
    ["reserved", "Reservado"],
    ["pending", "Falta pagar"],
    ["paid", "Pago"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-fg-muted" aria-label="Legenda">
      {items.map(([s, label]) => (
        <li key={s} className="inline-flex items-center gap-2">
          <span className={cn("inline-block h-5 w-7 rounded-md border", CELL_STYLES[s])} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}

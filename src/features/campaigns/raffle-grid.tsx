"use client";

import { memo, useMemo, useState } from "react";
import { CheckSquare, Hash, X } from "lucide-react";
import type { NumberSlot, NumberStatus } from "@/types";
import { NUMBER_STATUS } from "@/lib/labels";
import { padNumber } from "@/lib/raffle";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/shared/filters";
import { EmptyState } from "@/components/shared/states";

export const CELL_STYLES: Record<NumberStatus, string> = {
  available: "border-line bg-sunken text-fg-muted hover:border-gold/60 hover:text-fg",
  reserved: "border-ice/45 bg-ice/[0.09] text-ice",
  pending:
    "border-dashed border-warn/75 text-warn bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--warn)_15%,transparent)_0_5px,color-mix(in_oklab,var(--warn)_4%,transparent)_5px_10px)]",
  paid: "border-ok/45 bg-ok/[0.11] text-ok",
  cancelled: "border-line bg-transparent text-fg-subtle line-through opacity-60",
};

type Filter = "all" | NumberStatus;
const BLOCK = 200;

interface NumberCellProps {
  slot: NumberSlot;
  total: number;
  selected: boolean;
  onClick: (n: number) => void;
}

const NumberCell = memo(function NumberCell({ slot, total, selected, onClick }: NumberCellProps) {
  const meta = NUMBER_STATUS[slot.status];
  return (
    <button
      type="button"
      onClick={() => onClick(slot.number)}
      aria-label={`Número ${padNumber(slot.number, total)}: ${meta.label}${selected ? ", selecionado" : ""}`}
      aria-pressed={selected}
      data-number={slot.number}
      className={cn(
        "relative grid h-10 place-items-center rounded-md border font-mono text-[13px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1",
        CELL_STYLES[slot.status],
        selected && "border-gold bg-gold/15 text-fg ring-2 ring-gold ring-offset-1 ring-offset-surface",
      )}
    >
      {padNumber(slot.number, total)}
      {meta.symbol && <span className="absolute top-0.5 right-1 font-sans text-[9px] leading-none font-bold no-underline" aria-hidden>{meta.symbol}</span>}
    </button>
  );
});

export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-fg-muted", className)} aria-label="Legenda">
      {(Object.keys(NUMBER_STATUS) as NumberStatus[]).map((s) => (
        <li key={s} className="inline-flex items-center gap-2">
          <span className={cn("relative inline-block h-[18px] w-6 rounded border", CELL_STYLES[s])} aria-hidden>
            {NUMBER_STATUS[s].symbol && <span className="absolute -top-px right-0.5 text-[8px] font-bold">{NUMBER_STATUS[s].symbol}</span>}
          </span>
          {s === "cancelled" ? <s>{NUMBER_STATUS[s].label}</s> : NUMBER_STATUS[s].label}
        </li>
      ))}
    </ul>
  );
}

interface RaffleBoardProps {
  slots: NumberSlot[];
  total: number;
  /** Modo de seleção para vender vários números de uma vez. */
  selecting: boolean;
  onToggleSelecting?: () => void;
  selected: Set<number>;
  onToggleSelect: (n: number) => void;
  onClearSelection: () => void;
  onOpen: (n: number) => void;
  canSelect: boolean;
  onSellSelected?: () => void;
  /** Filtro ao abrir (ex.: "Números livres" já mostra só os disponíveis). */
  initialFilter?: Filter;
}

/** Grade interativa com filtros, busca direta e seleção múltipla. */
export function RaffleBoard({
  slots,
  total,
  selecting,
  onToggleSelecting,
  selected,
  onToggleSelect,
  onClearSelection,
  onOpen,
  canSelect,
  onSellSelected,
  initialFilter = "all",
}: RaffleBoardProps) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [jump, setJump] = useState("");
  const [jumpError, setJumpError] = useState<string>();
  const [block, setBlock] = useState(0);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: slots.length, available: 0, reserved: 0, pending: 0, paid: 0, cancelled: 0 };
    for (const s of slots) c[s.status]++;
    return c;
  }, [slots]);

  const filtered = useMemo(() => (filter === "all" ? slots : slots.filter((s) => s.status === filter)), [slots, filter]);
  const blocks = Math.ceil(filtered.length / BLOCK);
  const currentBlock = Math.min(block, Math.max(0, blocks - 1));
  const visible = filtered.length > BLOCK * 1.5 ? filtered.slice(currentBlock * BLOCK, currentBlock * BLOCK + BLOCK) : filtered;

  const handleClick = (n: number) => {
    if (selecting) {
      const slot = slots[n - 1];
      if (slot?.status === "available") onToggleSelect(n);
      else onOpen(n);
    } else {
      onOpen(n);
    }
  };

  const goTo = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(jump.trim());
    if (!Number.isInteger(n) || n < 1 || n > total) {
      setJumpError(`Digite um número entre 1 e ${total}.`);
      return;
    }
    setJumpError(undefined);
    setFilter("all");
    if (total > BLOCK * 1.5) setBlock(Math.floor((n - 1) / BLOCK));
    setJump("");
    onOpen(n);
  };

  const selectedList = [...selected].sort((a, b) => a - b);

  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
        <FilterChips
          ariaLabel="Filtrar números por situação"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setBlock(0);
          }}
          options={[
            { value: "all", label: "Todos", count: counts.all },
            { value: "available", label: "Disponíveis", count: counts.available },
            { value: "reserved", label: "Reservados", count: counts.reserved },
            { value: "pending", label: "Pendentes", count: counts.pending },
            { value: "paid", label: "Pagos", count: counts.paid },
            ...(counts.cancelled > 0 ? [{ value: "cancelled" as const, label: "Cancelados", count: counts.cancelled }] : []),
          ]}
        />
        <div className="flex flex-wrap items-start gap-2">
          <form onSubmit={goTo} className="relative">
            <Hash className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              value={jump}
              onChange={(e) => {
                setJump(e.target.value.replace(/\D/g, ""));
                setJumpError(undefined);
              }}
              inputMode="numeric"
              placeholder="Ir para número"
              aria-label="Ir para número"
              aria-invalid={!!jumpError}
              className="h-9 w-36 rounded-lg border border-line-strong bg-sunken pr-2 pl-8 text-[13px] focus:border-gold/60 focus:outline-none aria-[invalid=true]:border-danger/70"
            />
            {jumpError && <p role="alert" className="absolute top-full left-0 mt-1 w-56 text-[11.5px] text-danger">{jumpError}</p>}
          </form>
          {canSelect && onToggleSelecting && (
            <Button size="md" variant={selecting ? "primary" : "secondary"} onClick={onToggleSelecting} aria-pressed={selecting} className="h-9">
              <CheckSquare /> {selecting ? "Selecionando" : "Selecionar vários"}
            </Button>
          )}
        </div>
      </div>

      {selecting && (
        <div className="flex flex-col gap-2 border-b border-line bg-gold/[0.05] px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-fg-muted">
            {selected.size === 0 ? (
              "Toque nos números disponíveis para selecioná-los. Números já ocupados abrem os detalhes."
            ) : (
              <>
                <b className="text-fg">{selected.size} selecionado(s):</b>{" "}
                <span className="font-mono">{selectedList.slice(0, 12).map((n) => padNumber(n, total)).join(", ")}{selectedList.length > 12 ? "…" : ""}</span>
              </>
            )}
          </p>
          <div className="flex gap-2">
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={onClearSelection}>
                <X /> Limpar
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={selected.size === 0} onClick={onSellSelected}>
              Registrar venda ({selected.size})
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState compact title="Nenhum número nesta situação" description="Escolha outro filtro para ver os demais números." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5 p-4 sm:grid-cols-[repeat(auto-fill,minmax(58px,1fr))] sm:p-5">
          {visible.map((slot) => (
            <NumberCell key={slot.number} slot={slot} total={total} selected={selected.has(slot.number)} onClick={handleClick} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-line px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <StatusLegend />
        {filtered.length > BLOCK * 1.5 && (
          <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
            <span className="tnum font-mono">
              {visible[0] && padNumber(visible[0].number, total)}–{visible.at(-1) && padNumber(visible.at(-1)!.number, total)}
            </span>
            <select
              aria-label="Trecho da grade"
              value={currentBlock}
              onChange={(e) => setBlock(Number(e.target.value))}
              className="h-8 rounded-md border border-line-strong bg-sunken px-2 text-[12.5px]"
            >
              {Array.from({ length: blocks }).map((_, i) => (
                <option key={i} value={i}>
                  Trecho {i + 1} de {blocks}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </section>
  );
}

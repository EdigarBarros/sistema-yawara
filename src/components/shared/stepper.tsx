import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Indicador de etapas para formulários longos. */
export function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: { key: string; title: string; description?: string }[];
  current: number;
  /** Permite voltar para etapas anteriores. */
  onSelect?: (index: number) => void;
}) {
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = onSelect && i < current;
        return (
          <li key={s.key} className="min-w-[150px] flex-1 lg:min-w-0">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect(i)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                active && "bg-gold/[0.08]",
                clickable && "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[12px] font-semibold",
                  done && "border-gold bg-gold text-gold-ink",
                  active && "border-gold text-gold-fg",
                  !done && !active && "border-line-strong text-fg-subtle",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-[13px] font-semibold", active ? "text-fg" : "text-fg-muted")}>{s.title}</span>
                {s.description && <span className="hidden truncate text-[11.5px] text-fg-subtle lg:block">{s.description}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

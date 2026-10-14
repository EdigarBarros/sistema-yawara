"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
  className,
  label = "Buscar",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-line-strong bg-sunken pr-8 pl-9 text-[13.5px] text-fg focus:border-gold/60 focus:ring-[3px] focus:ring-gold/15 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpar busca"
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-subtle hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: ReactNode;
}

/** Filtros rápidos em "pílulas", com contagem. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors [&_svg]:size-3.5",
              active ? "border-line-strong bg-surface-3 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && <span className={cn("font-mono text-[11px]", active ? "text-gold-fg" : "text-fg-subtle")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Barra de filtros acima de listas. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between", className)}>{children}</div>;
}

/** Seletor compacto usado em barras de filtro. */
export function FilterSelect({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-full min-w-0 rounded-lg sm:w-auto sm:max-w-full border border-line-strong bg-sunken pr-8 pl-3 text-[13px] text-fg focus:border-gold/60 focus:outline-none",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

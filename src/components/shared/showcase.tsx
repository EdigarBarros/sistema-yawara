"use client";

import Link from "next/link";
import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";

/* -------------------------------- Grade -------------------------------- */

/**
 * Vitrine de cartões: entrada escalonada, esqueleto enquanto carrega e "Mostrar mais"
 * no lugar da paginação da tabela.
 */
export function ShowcaseGrid<T>({
  items,
  getId,
  render,
  loading,
  empty,
  pageSize = 24,
  label,
  className,
}: {
  items: T[];
  getId: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  loading?: boolean;
  empty?: ReactNode;
  pageSize?: number;
  label: string;
  className?: string;
}) {
  const [limit, setLimit] = useState(pageSize);
  if (loading)
    return (
      <div className={cn("grid gap-4 sm:grid-cols-2 2xl:grid-cols-3", className)} aria-busy aria-label={`${label}: carregando`}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[228px] rounded-[20px]" />
        ))}
      </div>
    );
  if (items.length === 0) return <>{empty}</>;
  const shown = items.slice(0, limit);
  return (
    <div className={className}>
      <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" aria-label={label}>
        {shown.map((item, i) => (
          <li key={getId(item)} className="anim-rise min-w-0" style={{ animationDelay: `${Math.min(i, 11) * 45}ms` }}>
            {render(item, i)}
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <div className="mt-5 flex justify-center">
          <Button onClick={() => setLimit((l) => l + pageSize)}>
            <ChevronDown /> Mostrar mais ({items.length - limit})
          </Button>
        </div>
      )}
    </div>
  );
}

/** Título de um grupo dentro da vitrine ("Esta semana", "Este mês"...). */
export function ShowcaseGroup({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2">
        <span className="eyebrow">{title}</span>
        {count !== undefined && <span className="tnum rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[11px] text-fg-muted">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/* -------------------------------- Cartão ------------------------------- */

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type CardTarget = { href: string; onClick?: never } | { onClick: () => void; href?: never };

/**
 * Cartão da vitrine: faixa colorida no topo, inclinação 3D seguindo o cursor e
 * leve "afundada" ao tocar. Vira link (`href`) ou botão (`onClick`).
 */
export function ShowcaseCard({
  color,
  label,
  className,
  children,
  ...target
}: CardTarget & { color: string; label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);

  const move = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-y * 7).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
  };

  const classes = cn(
    "tilt press group relative flex h-full w-full flex-col overflow-hidden rounded-[20px] border border-line bg-surface p-5 text-left hover:border-line-strong",
    className,
  );
  const style = { "--card-color": color } as CSSProperties;
  const inner = (
    <>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, ${color}55)` }} />
      {/* Brilho que acompanha o cursor */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(420px circle at var(--gx, 50%) var(--gy, 0%), ${color}1f, transparent 60%)` }}
      />
      <span className="relative flex h-full flex-col">{children}</span>
    </>
  );

  if (target.href !== undefined)
    return (
      <Link ref={(el) => void (ref.current = el)} href={target.href} aria-label={label} className={classes} style={style} onPointerMove={move} onPointerLeave={leave}>
        {inner}
      </Link>
    );
  return (
    <button
      ref={(el) => void (ref.current = el)}
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={target.onClick}
      className={classes}
      style={style}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {inner}
    </button>
  );
}

/* ------------------------------ Anel de progresso ------------------------------ */

/** Anel que se preenche ao aparecer. `value`/`max` como no Progress. */
export function ProgressRing({
  value,
  max,
  size = 76,
  stroke = 7,
  color = "var(--gold)",
  label,
  children,
  className,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color?: string;
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - pct)}
          className="anim-ring-fill"
          style={{ "--ring-len": `${len}` } as CSSProperties}
        />
      </svg>
      <span className="relative text-center leading-none">{children}</span>
    </div>
  );
}

/** Contagem regressiva curta para datas "yyyy-mm-dd": "hoje", "amanhã", "em 5 dias", "há 3 dias". */
export function countdownLabel(days: number) {
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  return days > 0 ? `em ${days} dias` : `há ${-days} dias`;
}

import type { HTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/labels";
import { cn, initials } from "@/lib/utils";

/* -------------------------------- Badge -------------------------------- */

const TONES: Record<Tone, string> = {
  neutral: "border-fg-muted/25 bg-fg-muted/10 text-fg-muted",
  gold: "border-gold/35 bg-gold/12 text-gold-fg",
  ok: "border-ok/30 bg-ok/12 text-ok",
  warn: "border-warn/35 bg-warn/12 text-warn",
  danger: "border-danger/35 bg-danger/12 text-danger",
  info: "border-info/30 bg-info/12 text-info",
  ice: "border-ice/35 bg-ice/12 text-ice",
};

export function Badge({
  tone = "neutral",
  dot,
  icon,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11.5px] leading-none font-semibold whitespace-nowrap [&_svg]:size-3",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ------------------------------- Skeleton ------------------------------ */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("rounded-md bg-[linear-gradient(110deg,var(--surface-3)_30%,var(--surface-2)_50%,var(--surface-3)_70%)] bg-[length:200%_100%] [animation:shimmer_1.6s_linear_infinite]", className)} {...props} />;
}

/* -------------------------------- Avatar ------------------------------- */

const AVATAR_COLORS = [
  "from-[#1b3f96] to-[#0b1a55]",
  "from-[#134cb6] to-[#0a2a72]",
  "from-[#2a3f7a] to-[#101a45]",
  "from-[#5a4310] to-[#2a1f06]",
  "from-[#1f5f73] to-[#0d2b36]",
];

export function Avatar({ name, id, size = 32, className }: { name: string; id?: string; size?: number; className?: string }) {
  const key = (id ?? name).split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-[#f3d27c] ring-1 ring-gold/30",
        AVATAR_COLORS[key % AVATAR_COLORS.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/* ------------------------------- Progress ------------------------------ */

export function Progress({ value, max = 100, className, label }: { value: number; max?: number; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div className="h-full rounded-full bg-gradient-to-r from-[#b28413] to-gold transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong px-1.5 py-px font-mono text-[11px] text-fg-muted">{children}</kbd>;
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-line", className)} />;
}

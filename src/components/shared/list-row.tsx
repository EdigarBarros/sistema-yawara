import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Linha de lista clicável usada em painéis resumidos. */
export function ListRow({
  href,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  className,
}: {
  href?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const content = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-fg">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[12px] text-fg-subtle">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0 text-right">{trailing}</span>}
      {(href || onClick) && <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
    </>
  );
  const cls = cn("flex items-center gap-3 px-5 py-3", (href || onClick) && "transition-colors hover:bg-surface-2", className);
  if (href)
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cn(cls, "w-full text-left")}>
        {content}
      </button>
    );
  return <div className={cls}>{content}</div>;
}

/** Bloco de data compacto (dia + mês) para listas de agenda. */
export function DateChip({ date }: { date: string }) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return (
    <span className="grid w-11 place-items-center rounded-lg border border-line bg-surface-2 py-1 leading-none">
      <span className="font-mono text-[15px] font-semibold text-fg">{day}</span>
      <span className="mt-0.5 text-[10px] font-semibold tracking-wide text-gold-fg uppercase">{month}</span>
    </span>
  );
}

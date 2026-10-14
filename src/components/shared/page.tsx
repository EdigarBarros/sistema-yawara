import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Cabeçalho padrão de todas as páginas. */
export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  back,
  badge,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  badge?: ReactNode;
}) {
  return (
    <header className="mb-6 sm:mb-7">
      {back && (
        <Link href={back.href} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow !text-gold-fg">{eyebrow}</div>}
          <h1 className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 font-display text-[28px] leading-[1.08] font-bold tracking-[-0.01em] sm:text-[34px]", eyebrow && "mt-2.5")}>
            <span className="min-w-0 break-words">{title}</span>
            {badge}
          </h1>
          {description && <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-fg-muted">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-fg-muted">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">{actions}</div>}
      </div>
    </header>
  );
}

export function MetaItem({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 [&_b]:font-semibold [&_b]:text-fg [&_svg]:size-[15px] [&_svg]:text-fg-subtle">
      {icon}
      <span>{children}</span>
    </span>
  );
}

/** Bloco de conteúdo com título opcional. Use com moderação — nem tudo precisa de cartão. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[14.5px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(bodyClassName ?? "p-5")}>{children}</div>
    </section>
  );
}

/** Indicador numérico. */
export function Stat({
  label,
  value,
  suffix,
  footer,
  className,
  children,
}: {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface px-4 py-4 sm:px-5", className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-3 mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="tnum font-mono text-[20px] leading-none font-semibold whitespace-nowrap tracking-[-0.02em] min-[400px]:text-[22px] sm:text-[28px]">{value}</strong>
        {suffix && <span className="font-mono text-[13px] text-fg-subtle">{suffix}</span>}
      </div>
      {children}
      {footer && <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">{footer}</div>}
    </div>
  );
}

/** Lista de pares rótulo/valor para painéis de detalhes. */
export function DetailList({ items, className }: { items: { label: string; value: ReactNode; hidden?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items
        .filter((i) => !i.hidden)
        .map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-6 py-2.5 text-[13px]">
            <dt className="shrink-0 text-fg-subtle">{item.label}</dt>
            <dd className="min-w-0 text-right font-medium break-words text-fg">{item.value}</dd>
          </div>
        ))}
    </dl>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="eyebrow">{children}</h3>
      {action}
    </div>
  );
}

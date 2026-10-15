import { isDemoMode } from "@/lib/mode";
import type { ReactNode } from "react";
import { AlertTriangle, FlaskConical, Inbox, Loader2, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className="mb-4 grid size-11 place-items-center rounded-xl border border-line-strong bg-surface-2 text-fg-muted [&_svg]:size-5">
        {icon ?? <Inbox />}
      </div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-11 place-items-center rounded-xl border border-danger/30 bg-danger/10 text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold">Não foi possível carregar</h3>
      <p className="mt-1.5 max-w-md text-[13px] text-fg-muted">{message}</p>
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          <RotateCcw /> Tentar novamente
        </Button>
      )}
    </div>
  );
}

/** Exibido quando o perfil demonstrativo não tem acesso à área. */
export function RestrictedState({ title = "Área não disponível para este perfil", description }: { title?: string; description?: ReactNode }) {
  return (
    <EmptyState
      icon={<Lock />}
      title={title}
      description={
        description ??
        (isDemoMode
          ? "O perfil de demonstração em uso não tem permissão para esta área. Troque de perfil no topo da tela para experimentar outras visões."
          : "Seu cargo não tem permissão para esta área. Se precisar de acesso, fale com a presidência.")
      }
    />
  );
}

export function FullPageLoader({ label = "Carregando a Central…" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <div className="flex items-center gap-3 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin text-gold" />
        {label}
      </div>
    </div>
  );
}

export function InlineLoader({ label = "Carregando…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 py-10 text-[13px] text-fg-muted">
      <Loader2 className="size-4 animate-spin text-gold" />
      {label}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-5 py-4">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-1/3" : "w-1/6")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-3 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

/** Aviso explícito de que algo é demonstrativo ou depende do backend. */
export function DemoNotice({ children, className, tone = "info" }: { children: ReactNode; className?: string; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed",
        tone === "info" ? "border-info/25 bg-info/[0.07] text-fg-muted" : "border-warn/30 bg-warn/[0.08] text-fg-muted",
        className,
      )}
    >
      <FlaskConical className={cn("mt-0.5 size-4 shrink-0", tone === "info" ? "text-info" : "text-warn")} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

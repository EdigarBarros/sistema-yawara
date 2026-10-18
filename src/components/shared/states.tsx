"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, FlaskConical, Inbox, Loader2, Lock, PowerOff, RotateCcw, SearchX } from "lucide-react";
import type { ModuleKey } from "@/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { ServiceError } from "@/services/errors";
import { Skeleton } from "@/components/ui/misc";
import { useAccess } from "@/hooks/use-access";
import { cn } from "@/lib/utils";
import { moduleForPath, restrictedNotice } from "./module-route";
import { BrandEmblem } from "@/components/layout/brand";

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

/**
 * Falha ao abrir um registro (página de detalhe). Sem permissão e "não
 * encontrado" não oferecem "Tentar novamente" — repetir não muda o resultado.
 */
export function RecordErrorState({
  error,
  notFound,
  backHref,
  backLabel = "Voltar à lista",
  onRetry,
}: {
  error: unknown;
  notFound: string;
  backHref?: string;
  backLabel?: string;
  onRetry?: () => void;
}) {
  const code = error instanceof ServiceError ? error.code : null;
  const back = backHref ? <ButtonLink href={backHref}>{backLabel}</ButtonLink> : undefined;
  if (!error || code === "not_found") {
    return (
      <EmptyState
        icon={<SearchX />}
        title={notFound}
        description={error instanceof ServiceError ? error.message : "O registro pode ter sido removido ou o link está incorreto."}
        action={back}
      />
    );
  }
  if (code === "forbidden") {
    return (
      <EmptyState
        icon={<Lock />}
        title="Registro não disponível para o seu perfil"
        description={`${(error as ServiceError).message} Se precisar de acesso, fale com quem criou o registro ou com a presidência.`}
        action={back}
      />
    );
  }
  const message = error instanceof Error && error.message ? error.message : "Não foi possível carregar os dados agora. Tente novamente.";
  return <ErrorState message={message} onRetry={onRetry} />;
}

/**
 * Exibido quando o perfil não tem acesso à área. Se o módulo da área (deduzido
 * da rota, ou informado em `module`) estiver desativado nas Configurações, o
 * aviso diz isso em vez de falar em permissão do cargo.
 */
export function RestrictedState({ title, description, module }: { title?: string; description?: ReactNode; module?: ModuleKey }) {
  const pathname = usePathname();
  const access = useAccess();
  const notice = restrictedNotice({ module: module ?? moduleForPath(pathname), moduleEnabled: access.moduleEnabled, title, description });
  return <EmptyState icon={notice.disabled ? <PowerOff /> : <Lock />} title={notice.title} description={notice.description} />;
}

export function FullPageLoader({ label = "Carregando a Central…" }: { label?: string }) {
  return (
    <div role="status" className="atmos grid min-h-dvh place-items-center overflow-hidden bg-bg">
      <div className="relative flex flex-col items-center gap-5">
        <span aria-hidden className="absolute top-[-40px] size-[200px] rounded-full bg-[radial-gradient(closest-side,var(--halo-a),var(--halo-b),transparent)]" style={{ animation: "breathe 2.4s ease-in-out infinite" }} />
        <div className="relative" style={{ animation: "pop .6s cubic-bezier(.2,1.3,.4,1) both, float-soft 3s ease-in-out .6s infinite" }}>
          <BrandEmblem size={88} className="drop-shadow-[0_14px_30px_var(--emblem-shadow)]" priority />
        </div>
        <span className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 rounded-full bg-gold" style={{ animation: `dot-bounce 1.1s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
        </span>
        <p className="text-[13.5px] text-fg-muted">{label}</p>
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
    <div role="status" aria-label="Carregando" className="space-y-6 [animation:fade-in_.3s_ease-out_.15s_both]">
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

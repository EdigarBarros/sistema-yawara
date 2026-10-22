"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCheck } from "lucide-react";
import { services } from "@/services";
import { useAction } from "@/hooks/use-action";
import { useNotifications } from "@/hooks/use-data";
import { useSession } from "@/stores/session";
import { formatRelative } from "@/lib/format";
import { errorMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page";
import { EmptyState, ErrorState, InlineLoader } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { NOTIFICATION_ICONS } from "@/components/layout/notifications";
import { PENDING_ICONS, usePending } from "@/features/home/pending";

export default function AvisosPage() {
  const router = useRouter();
  const userId = useSession((s) => s.userId) ?? "";
  const pending = usePending();
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const markRead = useAction((id: string) => services.notifications.markRead(id));
  const markAll = useAction(() => services.notifications.markAllRead(), { success: "Avisos marcados como lidos" });
  const unread = (data ?? []).filter((n) => !n.readBy.includes(userId)).length;

  return (
    <>
      <PageHeader
        title="Avisos"
        description="O que precisa de você e as novidades compartilhadas com você."
        actions={
          unread > 0 && (
            <Button variant="secondary" loading={markAll.pending} onClick={() => markAll.runSafe()}>
              <CheckCheck /> Marcar todos como lidos
            </Button>
          )
        }
      />

      <section className="mb-8">
        <h2 className="eyebrow mb-3 !text-gold-fg">Precisa de você</h2>
        {pending.error ? (
          <ErrorState className="py-8" message={errorMessage(pending.error)} onRetry={pending.retry} />
        ) : pending.loading ? (
          <InlineLoader />
        ) : pending.items.length === 0 ? (
          <div className="anim-rise flex items-center gap-3 rounded-2xl border border-ok/30 bg-ok/10 px-4 py-4 text-[14px]">
            <CheckCheck className="size-5 text-ok" aria-hidden />
            Tudo em dia. Nada esperando por você agora.
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {pending.items.map((p, i) => (
              <li key={p.id} className="anim-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <Link
                  href={p.href}
                  className={cn(
                    "press group flex items-center gap-3 rounded-2xl border p-4",
                    p.urgent ? "border-danger/40 bg-danger/10" : "border-gold/30 bg-gradient-to-br from-gold/10 to-transparent",
                  )}
                >
                  <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5", p.urgent ? "bg-danger text-white" : "bg-gold text-gold-ink")}>{PENDING_ICONS[p.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[11px] font-bold tracking-[0.08em] uppercase", p.urgent ? "text-danger" : "text-gold-fg")}>{p.label}</span>
                    <span className="block truncate text-[15px] font-semibold">{p.title}</span>
                    <span className="block truncate text-[12.5px] text-fg-muted">{p.detail}</span>
                  </span>
                  <span className={cn("hidden shrink-0 text-[12.5px] font-semibold sm:inline", p.urgent ? "text-danger" : "text-gold-fg")}>{p.action}</span>
                  <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-active:translate-x-1" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-3">Novidades</h2>
        {isLoading ? (
          <InlineLoader />
        ) : isError ? (
          <ErrorState className="py-8" message={errorMessage(error)} onRetry={() => refetch()} />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState compact title="Nada por aqui" description="Quando algo for compartilhado com você, aparecerá nesta lista." />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {data!.map((n, i) => {
              const isUnread = !n.readBy.includes(userId);
              return (
                <li key={n.id} className="anim-row border-b border-line last:border-0" style={{ animationDelay: `${Math.min(i * 50, 600)}ms` }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isUnread) markRead.runSafe(n.id);
                      router.push(n.href);
                    }}
                    className={cn("flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-3", isUnread && "bg-gold/[0.05]")}
                  >
                    <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]", isUnread ? "bg-gold/15 text-gold-fg" : "bg-surface-2 text-fg-muted")}>
                      {NOTIFICATION_ICONS[n.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className={cn("text-[14px] leading-snug", isUnread ? "font-semibold text-fg" : "text-fg-muted")}>{n.title}</span>
                        {isUnread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" aria-label="Não lida" />}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-muted">{n.body}</span>
                      <span className="mt-1 block text-[11.5px] text-fg-subtle">{formatRelative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

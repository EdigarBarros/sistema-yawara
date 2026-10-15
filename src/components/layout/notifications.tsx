"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, CheckCheck, ClipboardCheck, FileText, Lock, Sparkles, Ticket } from "lucide-react";
import type { AppNotification } from "@/types";
import { services } from "@/services";
import { useNotifications } from "@/hooks/use-data";
import { useAction } from "@/hooks/use-action";
import { useSession } from "@/stores/session";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/mode";
import { errorMessage } from "@/lib/notify";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, InlineLoader } from "@/components/shared/states";

const ICONS: Record<AppNotification["kind"], React.ReactNode> = {
  document_shared: <FileText />,
  event_updated: <CalendarClock />,
  campaign_closed: <Lock />,
  campaign_shared: <Ticket />,
  meeting_registered: <ClipboardCheck />,
  content_approved: <Sparkles />,
  report_shared: <FileText />,
};

/** Notificações internas — nenhum e-mail ou mensagem externa é enviado. */
export function NotificationsButton() {
  const router = useRouter();
  const userId = useSession((s) => s.userId) ?? "";
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const [open, setOpen] = useState(false);

  // Tempo real (quando a fonte de dados oferece): novas notificações atualizam a lista sem recarregar a página.
  useEffect(() => {
    const service = services.notifications;
    if (!userId || !service.subscribe) return;
    return service.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: [userId, "notifications"] });
    });
  }, [userId, queryClient]);

  const markRead = useAction((id: string) => services.notifications.markRead(id));
  const markAll = useAction(() => services.notifications.markAllRead(), { success: "Notificações marcadas como lidas" });
  const unread = (data ?? []).filter((n) => !n.readBy.includes(userId)).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong text-fg-muted hover:bg-surface-2 hover:text-fg data-[state=open]:bg-surface-2"
        aria-label={unread > 0 ? `Notificações: ${unread} não lidas` : "Notificações"}
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full bg-gold px-1 font-mono text-[10px] leading-[18px] font-semibold text-gold-ink ring-2 ring-bg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-[14px] font-semibold">Notificações</p>
            <p className="text-[11.5px] text-fg-subtle">{isDemoMode ? "Avisos internos da demonstração" : "Avisos internos da Central"}</p>
          </div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" loading={markAll.pending} onClick={() => markAll.runSafe()}>
              <CheckCheck /> Marcar todas
            </Button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading && <InlineLoader />}
          {!isLoading && isError && <ErrorState className="py-8" message={errorMessage(error)} onRetry={() => refetch()} />}
          {!isLoading && !isError && (data?.length ?? 0) === 0 && <EmptyState compact title="Nada por aqui" description="Quando algo for compartilhado com você, aparecerá nesta lista." />}
          <ul className="divide-y divide-line">
            {data?.map((n) => {
              const isUnread = !n.readBy.includes(userId);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isUnread) markRead.runSafe(n.id);
                      setOpen(false);
                      router.push(n.href);
                    }}
                    className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2", isUnread && "bg-gold/[0.04]")}
                  >
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-fg-muted [&_svg]:size-4">
                      {ICONS[n.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className={cn("text-[13px] leading-snug", isUnread ? "font-semibold text-fg" : "text-fg-muted")}>{n.title}</span>
                        {isUnread && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" aria-label="Não lida" />}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">{n.body}</span>
                      <span className="mt-1 block text-[11px] text-fg-subtle">{formatRelative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

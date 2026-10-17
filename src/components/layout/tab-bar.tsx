"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, House, LayoutGrid, Ticket, type LucideIcon } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useNotifications } from "@/hooks/use-data";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

interface Tab {
  label: string;
  href: string;
  icon: LucideIcon;
}

function startsWith(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Barra de baixo do celular: o que mais se usa a um toque; o resto fica em "Mais". */
export function TabBar() {
  const pathname = usePathname();
  const access = useAccess();
  const userId = useSession((s) => s.userId) ?? "";
  const { data } = useNotifications();
  const unread = (data ?? []).filter((n) => !n.readBy.includes(userId)).length;

  const tabs: Tab[] = [
    { label: "Início", href: "/inicio", icon: House },
    ...(access.canModule("campaigns") ? [{ label: "Rifas", href: "/campanhas", icon: Ticket }] : []),
    { label: "Agenda", href: "/agenda", icon: CalendarDays },
    { label: "Avisos", href: "/avisos", icon: Bell },
    { label: "Mais", href: "/mais", icon: LayoutGrid },
  ];
  const direct = tabs.slice(0, -1).find((t) => startsWith(pathname, t.href));
  const activeHref = direct?.href ?? "/mais";

  return (
    <nav
      aria-label="Navegação rápida"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto flex max-w-[520px] items-stretch justify-around px-1">
        {tabs.map((t) => {
          const active = t.href === activeHref;
          const Icon = t.icon;
          return (
            <li key={t.href} className="flex-1">
              <Link href={t.href} aria-current={active ? "page" : undefined} className="press flex h-[62px] flex-col items-center justify-center gap-1">
                <span
                  key={active ? "on" : "off"}
                  className={cn("relative grid h-8 w-14 place-items-center rounded-full transition-colors", active ? "bg-gold text-gold-ink" : "text-fg-muted")}
                  style={active ? { animation: "bump .35s ease both" } : undefined}
                >
                  <Icon className="size-[20px]" aria-hidden />
                  {t.href === "/avisos" && unread > 0 && (
                    <span className="absolute -top-1 right-2 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] leading-[18px] font-bold text-white ring-2 ring-bg" aria-label={`${unread} não lidas`}>
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </span>
                <span className={cn("text-[11px] font-medium", active ? "text-fg" : "text-fg-subtle")}>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

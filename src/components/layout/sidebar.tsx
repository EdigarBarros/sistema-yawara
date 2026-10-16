"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useUI } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { isFirebaseMode } from "@/lib/mode";
import { USE_EMULATORS } from "@/services/firebase/app";
import { NAV } from "./nav";
import { BrandLockup } from "./brand";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Lista de navegação reutilizada na barra lateral e no menu do celular. */
export function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const access = useAccess();

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-0.5">
      {NAV.map((group, gi) => {
        const items = group.items.filter((i) => !i.module || access.canModule(i.module));
        if (items.length === 0) return null;
        return (
          <div key={gi} className="flex flex-col gap-0.5">
            {group.label &&
              (collapsed ? (
                <div className="mx-auto my-3 h-px w-6 bg-line" aria-hidden />
              ) : (
                <div className="eyebrow px-3 pt-5 pb-2">{group.label}</div>
              ))}
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "relative flex h-[38px] items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors",
                    collapsed && "justify-center px-0",
                    active ? "bg-gold/10 text-fg" : "text-fg-muted hover:bg-surface hover:text-fg",
                  )}
                >
                  {active && <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r bg-gold" aria-hidden />}
                  <Icon className={cn("size-[18px] shrink-0", active && "text-gold")} aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function DemoFootnote({ collapsed }: { collapsed?: boolean }) {
  // Ambiente real: sem aviso. Desenvolvimento com emuladores: aviso discreto.
  if (isFirebaseMode) {
    if (!USE_EMULATORS) return null;
    return collapsed ? (
      <div className="flex justify-center" title="Ambiente de desenvolvimento: Firebase Emulator Suite (dados locais de teste).">
        <FlaskConical className="size-4 text-info" aria-label="Ambiente de desenvolvimento" />
      </div>
    ) : (
      <p className="text-[12px] leading-relaxed text-fg-subtle">
        <span className="font-semibold text-fg-muted">Ambiente de desenvolvimento.</span> Firebase Emulator Suite — dados locais de teste.
      </p>
    );
  }
  if (collapsed) {
    return (
      <div className="flex justify-center" title="Ambiente de demonstração: dados fictícios, salvos apenas neste navegador.">
        <FlaskConical className="size-4 text-gold-fg" aria-label="Ambiente de demonstração" />
      </div>
    );
  }
  return (
    <p className="text-[12px] leading-relaxed text-fg-subtle">
      <span className="font-semibold text-fg-muted">Ambiente de demonstração.</span> Dados fictícios, salvos apenas neste navegador.
    </p>
  );
}

export function Sidebar() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const toggle = useUI((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col self-start border-r border-line bg-bg/60 backdrop-blur-sm lg:flex",
        collapsed ? "w-[72px]" : "w-[252px]",
      )}
    >
      <div className={cn("flex h-[60px] items-center border-b border-line", collapsed ? "justify-center px-2" : "px-4")}>
        <Link href="/inicio" aria-label="Central Yawara — início" className="min-w-0">
          <BrandLockup collapsed={collapsed} />
        </Link>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
        <NavList collapsed={collapsed} />
      </div>
      <div className={cn("space-y-3 border-t border-line py-4", collapsed ? "px-2" : "px-4")}>
        <DemoFootnote collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md text-[12.5px] text-fg-subtle hover:bg-surface hover:text-fg",
            collapsed ? "justify-center" : "px-2",
          )}
          aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && "Recolher menu"}
        </button>
      </div>
    </aside>
  );
}

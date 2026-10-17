"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, LogOut, Moon, RotateCcw, Search, Settings2, Sun, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useSession } from "@/stores/session";
import { resolveTheme, useUI } from "@/stores/ui";
import { LOGOUT_LEAD_MS, useScene } from "@/stores/scene";
import { firstName } from "@/lib/format";
import { useCrumbTitles } from "@/stores/breadcrumb";
import { notifyError, notifySuccess } from "@/lib/notify";
import { Avatar, Kbd } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { confirmAction } from "@/components/shared/confirm";
import { isDemoMode } from "@/lib/mode";
import { ROUTE_LABELS } from "./nav";
import { ProfileSwitcher } from "./profile-switcher";
import { NotificationsButton } from "./notifications";
import { BrandEmblem } from "./brand";

function Breadcrumbs() {
  const pathname = usePathname();
  const titles = useCrumbTitles();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = parts.map((part, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    return { href, label: titles[href] ?? ROUTE_LABELS[part] ?? "Detalhes" };
  });
  if (crumbs.length === 0) return null;
  const current = crumbs[crumbs.length - 1];
  return (
    <nav aria-label="Você está em" className="min-w-0">
      <ol className="hidden min-w-0 items-center gap-1.5 text-[13px] text-fg-subtle md:flex">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-fg">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="truncate hover:text-fg">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <p className="truncate text-[14px] font-semibold md:hidden">{current.label}</p>
    </nav>
  );
}

function AccountMenu() {
  const router = useRouter();
  const qc = useQueryClient();
  const access = useAccess();
  const signOut = useSession((s) => s.signOut);
  const { theme, setTheme } = useUI();
  const playScene = useScene((s) => s.play);
  const isDark = resolveTheme(theme) === "dark";
  if (!access.user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex shrink-0 items-center gap-2.5 rounded-full border border-line-strong py-1 pr-1 pl-1 hover:bg-surface-2 sm:pr-3" aria-label="Menu da conta">
        <Avatar name={access.user.name} id={access.user.id} size={28} />
        <span className="hidden text-left leading-tight xl:block">
          <span className="block max-w-[150px] truncate text-[13px] font-semibold">{access.user.name}</span>
          <span className="block max-w-[150px] truncate text-[11px] text-fg-subtle">{access.role?.name}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[280px]">
        <div className="flex items-center gap-3 px-2.5 py-2.5">
          <Avatar name={access.user.name} id={access.user.id} size={36} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold">{access.user.name}</p>
            <p className="truncate text-[12px] text-fg-muted">{access.role?.name}</p>
            {access.user.email && (
              <p className="truncate text-[11.5px] text-fg-subtle">
                {access.user.email}
                {isDemoMode && " · fictício"}
              </p>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<UserRound />} onSelect={() => router.push(`/diretoria?integrante=${access.user!.id}`)}>
          Meu perfil e permissões
        </DropdownMenuItem>
        <DropdownMenuItem icon={isDark ? <Sun /> : <Moon />} onSelect={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? "Usar modo claro" : "Usar modo escuro"}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Settings2 />} onSelect={() => router.push("/configuracoes?secao=preferencias")}>
          Preferências da interface
        </DropdownMenuItem>
        {isDemoMode && (
          <DropdownMenuItem
            icon={<RotateCcw />}
            hint="Desfaz as alterações feitas neste navegador"
            onSelect={async () => {
              const ok = await confirmAction({
                title: "Restaurar dados de demonstração?",
                description: "Todas as rifas, vendas, eventos e demais registros criados ou alterados neste navegador serão substituídos pelos dados fictícios originais.",
                confirmLabel: "Restaurar dados",
                tone: "danger",
              });
              if (!ok) return;
              try {
                await services.settings.resetDemoData();
                await qc.invalidateQueries();
                notifySuccess("Dados de demonstração restaurados");
                router.push("/inicio");
              } catch (e) {
                notifyError(e);
              }
            }}
          >
            Restaurar dados de demonstração
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<LogOut />}
          onSelect={async () => {
            playScene("logout", `Até logo, ${firstName(access.user!.name)}`, "Encerrando a sessão com segurança…");
            await new Promise((r) => setTimeout(r, LOGOUT_LEAD_MS));
            try {
              await services.auth.signOut();
            } finally {
              signOut();
              qc.clear();
              router.replace("/login");
            }
          }}
        >
          {isDemoMode ? "Sair da demonstração" : "Sair"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  const setSearchOpen = useUI((s) => s.setSearchOpen);

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b border-line bg-bg/80 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
      <Link href="/inicio" aria-label="Central Yawara — início" className="shrink-0 lg:hidden">
        <BrandEmblem size={34} priority />
      </Link>
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex h-9 shrink-0 items-center gap-2.5 rounded-lg border border-line-strong bg-sunken px-2.5 text-[13px] text-fg-subtle hover:border-gold/40 sm:w-[260px] xl:w-[320px]"
        aria-label="Abrir busca global (Ctrl K)"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 truncate text-left sm:inline">Buscar na Central…</span>
        <span className="hidden sm:inline">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      {isDemoMode && <ProfileSwitcher />}
      <div className="hidden lg:block">
        <NotificationsButton />
      </div>
      <AccountMenu />
    </header>
  );
}

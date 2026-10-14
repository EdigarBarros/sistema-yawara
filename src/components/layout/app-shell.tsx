"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useSession, useSessionReady } from "@/stores/session";
import { useUI } from "@/stores/ui";
import { useAccess } from "@/hooks/use-access";
import { FullPageLoader, PageSkeleton } from "@/components/shared/states";
import { DemoFootnote, NavList, Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { BrandLockup } from "./brand";

function MobileNav() {
  const open = useUI((s) => s.mobileNavOpen);
  const setOpen = useUI((s) => s.setMobileNav);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname, setOpen]);

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in lg:hidden" />
        <RD.Content className="fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[320px] flex-col border-r border-line-strong bg-bg shadow-pop outline-none lg:hidden">
          <RD.Title className="sr-only">Menu</RD.Title>
          <RD.Description className="sr-only">Navegação entre os módulos da Central</RD.Description>
          <div className="flex h-[60px] items-center justify-between border-b border-line px-4">
            <BrandLockup />
            <RD.Close className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2" aria-label="Fechar menu">
              <X className="size-5" />
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <NavList onNavigate={() => setOpen(false)} />
          </div>
          <div className="border-t border-line px-4 py-4">
            <DemoFootnote />
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Layout das áreas internas: exige um perfil demonstrativo ativo. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { ready: hydrated, userId } = useSessionReady();
  const signOut = useSession((s) => s.signOut);
  const access = useAccess();

  useEffect(() => {
    if (hydrated && !userId) router.replace("/login");
  }, [hydrated, userId, router]);

  // Perfil removido ou dados restaurados: volta para o login.
  useEffect(() => {
    if (hydrated && userId && access.ready && !access.user) {
      signOut();
      router.replace("/login");
    }
  }, [hydrated, userId, access.ready, access.user, signOut, router]);

  if (!hydrated || !userId || !access.ready || !access.user) return <FullPageLoader />;

  return (
    <div className="atmos flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="conteudo" className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-6 pb-16 sm:px-6 lg:px-9 lg:pt-8">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
    </div>
  );
}

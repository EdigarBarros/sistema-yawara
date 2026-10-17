"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession, useSessionReady } from "@/stores/session";
import { useAccess } from "@/hooks/use-access";
import { ErrorState, FullPageLoader, PageSkeleton } from "@/components/shared/states";
import { useDirectory } from "@/hooks/use-data";
import { errorMessage } from "@/lib/notify";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { TabBar, tabPosition } from "./tab-bar";
import { UploadTray } from "@/components/shared/upload-tray";
import { services } from "@/services";

/**
 * Conteúdo da rota com animação de entrada. No celular a tela desliza para o
 * lado da aba escolhida; no computador (e dentro da mesma aba) sobe de leve.
 */
function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [nav, setNav] = useState({ path: pathname, dir: "" as "" | "left" | "right" });
  if (nav.path !== pathname) {
    const delta = tabPosition(pathname) - tabPosition(nav.path);
    setNav({ path: pathname, dir: delta > 0 ? "right" : delta < 0 ? "left" : "" });
  }
  return (
    <>
      <span key={`bar-${pathname}`} aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-gradient-to-r from-gold to-[#f0c75a] [animation:route-bar_.7s_ease-out_both]" />
      <div key={pathname} className="page-in" data-dir={nav.dir || undefined}>
        {children}
      </div>
    </>
  );
}

/** Layout das áreas internas: exige uma sessão ativa (perfil demonstrativo ou conta real). */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { ready: hydrated, userId } = useSessionReady();
  const signOut = useSession((s) => s.signOut);
  const access = useAccess();
  const dir = useDirectory();

  useEffect(() => {
    if (hydrated && !userId) router.replace("/login");
  }, [hydrated, userId, router]);

  // Perfil removido, conta sem cadastro ou dados restaurados: volta para o login.
  useEffect(() => {
    // Uma falha momentânea ao carregar a estrutura NÃO encerra a sessão.
    if (hydrated && userId && access.ready && !access.user && !dir.error) {
      void services.auth.signOut().finally(() => {
        signOut();
        router.replace("/login");
      });
    }
  }, [hydrated, userId, access.ready, access.user, dir.error, signOut, router]);

  if (hydrated && userId && dir.error) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <ErrorState message={errorMessage(dir.error, "Não foi possível carregar a Central.")} onRetry={() => void dir.refetch()} />
      </div>
    );
  }
  if (!hydrated || !userId || !access.ready || !access.user) return <FullPageLoader />;

  return (
    <div className="atmos flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="conteudo" className="mx-auto w-full max-w-[1320px] flex-1 overflow-x-clip px-4 pt-5 pb-28 sm:px-6 lg:px-9 lg:pt-8 lg:pb-16">
          <PageTransition>
            <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
          </PageTransition>
        </main>
      </div>
      <TabBar />
      <CommandPalette />
      <UploadTray />
    </div>
  );
}

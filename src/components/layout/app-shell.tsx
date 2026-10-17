"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession, useSessionReady } from "@/stores/session";
import { useAccess } from "@/hooks/use-access";
import { ErrorState, FullPageLoader, PageSkeleton } from "@/components/shared/states";
import { useDirectory } from "@/hooks/use-data";
import { errorMessage } from "@/lib/notify";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { TabBar } from "./tab-bar";
import { UploadTray } from "@/components/shared/upload-tray";
import { services } from "@/services";

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
        <main id="conteudo" className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-9 lg:pt-8 lg:pb-16">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
      </div>
      <TabBar />
      <CommandPalette />
      <UploadTray />
    </div>
  );
}

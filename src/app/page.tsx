"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSessionReady } from "@/stores/session";
import { FullPageLoader } from "@/components/shared/states";

/** Encaminha para a página inicial ou para o login, conforme o perfil demonstrativo ativo. */
export default function RootPage() {
  const router = useRouter();
  const { ready: hydrated, userId } = useSessionReady();
  useEffect(() => {
    if (!hydrated) return;
    router.replace(userId ? "/inicio" : "/login");
  }, [hydrated, userId, router]);
  return <FullPageLoader />;
}

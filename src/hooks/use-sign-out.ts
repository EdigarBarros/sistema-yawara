"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import { useSession } from "@/stores/session";
import { LOGOUT_LEAD_MS, useScene } from "@/stores/scene";
import { firstName } from "@/lib/format";

/** Sair da conta com a cena de saída (usado no menu da conta e em "Meu perfil"). */
export function useSignOut() {
  const router = useRouter();
  const qc = useQueryClient();
  const signOut = useSession((s) => s.signOut);
  const playScene = useScene((s) => s.play);
  return async (name: string) => {
    playScene("logout", `Até logo, ${firstName(name)}`, "Encerrando a sessão com segurança…");
    await new Promise((r) => setTimeout(r, LOGOUT_LEAD_MS));
    try {
      await services.auth.signOut();
    } finally {
      signOut();
      qc.clear();
      router.replace("/login");
    }
  };
}

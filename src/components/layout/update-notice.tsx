"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/** Identificador do build que esta aba está rodando (fixado na compilação; ver next.config.ts). */
const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID;
const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Quem deixa a Central aberta continua rodando a versão antiga do site depois
 * de uma atualização. Esta verificação pergunta ao servidor qual é a versão
 * publicada (ao voltar para a aba e a cada 5 minutos) e, se mudou, mostra um
 * aviso fixo com o botão "Atualizar". Não é preciso sair da conta: as
 * permissões já se atualizam sozinhas (src/components/auth/firebase-session.tsx).
 */
export function UpdateNotice() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !CURRENT) return;
    let shown = false;
    let busy = false;
    const check = async () => {
      if (shown || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await res.json()) as { build: string | null };
        if (build && build !== CURRENT) {
          shown = true;
          toast("Nova versão da Central disponível", {
            id: "update-available",
            description: "Atualize para ver as novidades. Você continua conectado.",
            duration: Infinity,
            action: { label: "Atualizar", onClick: () => window.location.reload() },
          });
        }
      } catch {
        // Sem conexão agora: tenta de novo na próxima verificação.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return null;
}

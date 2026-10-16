"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ConfirmHost } from "@/components/shared/confirm";
import { FirebaseSessionBridge } from "@/components/auth/firebase-session";
import { isFirebaseMode } from "@/lib/mode";
import { useUI } from "@/stores/ui";

const LIGHT_QUERY = "(prefers-color-scheme: light)";
function subscribeScheme(callback: () => void) {
  const mq = window.matchMedia(LIGHT_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function prefersLight() {
  return window.matchMedia(LIGHT_QUERY).matches;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const qc: QueryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
      },
      // Toda escrita atualiza as consultas abertas: indicadores, listas e busca ficam coerentes.
      mutationCache: new MutationCache({ onSuccess: () => qc.invalidateQueries() }),
    });
    return qc;
  });
  const theme = useUI((s) => s.theme);
  const systemLight = useSyncExternalStore(subscribeScheme, prefersLight, () => false);
  const resolved: "dark" | "light" = theme === "system" ? (systemLight ? "light" : "dark") : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  return (
    <QueryClientProvider client={client}>
      {isFirebaseMode && <FirebaseSessionBridge />}
      {children}
      <ConfirmHost />
      <Toaster
        theme={resolved}
        position="top-center"
        closeButton
        toastOptions={{
          classNames: {
            toast: "!bg-surface !border-line-strong !text-fg !shadow-pop !rounded-lg",
            description: "!text-fg-muted",
            success: "[&_[data-icon]]:!text-ok",
            error: "[&_[data-icon]]:!text-danger",
          },
        }}
      />
    </QueryClientProvider>
  );
}

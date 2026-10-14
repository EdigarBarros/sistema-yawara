"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ID } from "@/types";
import { useMounted } from "@/hooks/use-mounted";

/**
 * Sessão DEMONSTRATIVA: guarda apenas qual perfil fictício está em uso neste
 * navegador. Não é autenticação. Na Etapa 2 será substituída pelo estado do
 * Firebase Authentication.
 */
interface SessionState {
  userId: ID | null;
  startedAt: string | null;
  /** Como a sessão foi iniciada — exibido para deixar claro que é demonstração. */
  method: "demo-profile" | "demo-email" | null;
  hydrated: boolean;
  signIn: (userId: ID, method: SessionState["method"]) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      userId: null,
      startedAt: null,
      method: null,
      hydrated: false,
      signIn: (userId, method) => set({ userId, method, startedAt: new Date().toISOString() }),
      signOut: () => set({ userId: null, method: null, startedAt: null }),
    }),
    {
      name: "central-yawara:demo-session",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ userId, startedAt, method }) => ({ userId, startedAt, method }),
      onRehydrateStorage: () => () => {
        // A store ainda está sendo criada quando a reidratação termina; adia a marcação.
        queueMicrotask(() => useSession.setState({ hydrated: true }));
      },
    },
  ),
);

export function getSessionUserId() {
  return useSession.getState().userId;
}

/**
 * Sessão pronta para uso na interface: só depois de montar no navegador,
 * para que a primeira renderização seja igual à do servidor.
 */
export function useSessionReady() {
  const mounted = useMounted();
  const hydrated = useSession((s) => s.hydrated);
  const userId = useSession((s) => s.userId);
  return { ready: mounted && hydrated, userId: mounted ? userId : null };
}

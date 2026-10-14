"use client";

import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ID } from "@/types";
import { useMounted } from "@/hooks/use-mounted";
import { isDemoMode } from "@/lib/mode";

/**
 * Sessão da interface.
 *
 * - Demonstração: guarda apenas qual perfil fictício está em uso neste
 *   navegador (não é autenticação).
 * - Firebase: espelha o usuário autenticado no Firebase Authentication. É
 *   preenchida pela ponte de sessão (components/auth/firebase-session.tsx) e
 *   NÃO é persistida aqui — quem guarda a sessão é o próprio Firebase Auth.
 */
interface SessionState {
  userId: ID | null;
  startedAt: string | null;
  /** Como a sessão foi iniciada. */
  method: "demo-profile" | "demo-email" | "firebase" | null;
  hydrated: boolean;
  signIn: (userId: ID, method: SessionState["method"]) => void;
  signOut: () => void;
}

const creator: StateCreator<SessionState> = (set) => ({
  userId: null,
  startedAt: null,
  method: null,
  hydrated: false,
  signIn: (userId, method) => set({ userId, method, startedAt: new Date().toISOString() }),
  signOut: () => set({ userId: null, method: null, startedAt: null }),
});

export const useSession = create<SessionState>()(
  isDemoMode
    ? (persist(creator, {
        name: "central-yawara:demo-session",
        storage: createJSONStorage(() => localStorage),
        partialize: ({ userId, startedAt, method }) => ({ userId, startedAt, method }),
        onRehydrateStorage: () => () => {
          // A store ainda está sendo criada quando a reidratação termina; adia a marcação.
          queueMicrotask(() => useSession.setState({ hydrated: true }));
        },
      }) as unknown as StateCreator<SessionState>)
    : creator,
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

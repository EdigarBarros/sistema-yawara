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
/**
 * "Ver como" da conta de suporte: a interface usa a identidade da pessoa
 * (`userId` passa a ser o dela), mas quem está logado continua sendo o suporte
 * (`realUid`). O servidor confere tudo de novo a cada chamada.
 */
export interface ViewAs {
  uid: ID;
  name: string;
  roleName?: string;
  realUid: ID;
  /** Para onde voltar ao sair da visão. */
  returnTo: string;
}

interface SessionState {
  /** Identidade efetiva da interface (no "ver como", a pessoa vista). */
  userId: ID | null;
  viewAs: ViewAs | null;
  startedAt: string | null;
  /** Como a sessão foi iniciada. */
  method: "demo-profile" | "demo-email" | "firebase" | null;
  hydrated: boolean;
  signIn: (userId: ID, method: SessionState["method"]) => void;
  signOut: () => void;
}

const creator: StateCreator<SessionState> = (set) => ({
  userId: null,
  viewAs: null,
  startedAt: null,
  method: null,
  hydrated: false,
  // Trocar de perfil ou sair encerra o "ver como".
  signIn: (userId, method) => set({ userId, method, startedAt: new Date().toISOString(), viewAs: null }),
  signOut: () => set({ userId: null, method: null, startedAt: null, viewAs: null }),
});

export const useSession = create<SessionState>()(
  isDemoMode
    ? (persist(creator, {
        name: "central-yawara:demo-session",
        storage: createJSONStorage(() => localStorage),
        partialize: ({ userId, startedAt, method, viewAs }) => ({ userId, startedAt, method, viewAs }),
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

/** Pessoa na visão de quem o suporte está (ou null). */
export function getViewAs() {
  return useSession.getState().viewAs;
}

/** Firebase: o "ver como" sobrevive ao recarregar a aba (não passa para outras abas). */
const VIEW_AS_KEY = "central-yawara:view-as";

export function saveViewAs(viewAs: ViewAs | null) {
  try {
    if (viewAs) sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(viewAs));
    else sessionStorage.removeItem(VIEW_AS_KEY);
  } catch {
    // Sem armazenamento: vale só até recarregar.
  }
}

export function loadSavedViewAs(realUid: string): ViewAs | null {
  try {
    const raw = sessionStorage.getItem(VIEW_AS_KEY);
    const v = raw ? (JSON.parse(raw) as ViewAs) : null;
    return v && v.realUid === realUid && typeof v.uid === "string" ? v : null;
  } catch {
    return null;
  }
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

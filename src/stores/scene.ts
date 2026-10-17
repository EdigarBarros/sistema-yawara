"use client";

import { create } from "zustand";

export type SceneKind = "login" | "logout";

interface TransitionState {
  scene: { kind: SceneKind; title: string; subtitle: string; id: number } | null;
  /** Cobre a tela com a cena de entrada ou saída enquanto a navegação acontece. */
  play: (kind: SceneKind, title: string, subtitle: string) => void;
  clear: () => void;
}

export const useScene = create<TransitionState>()((set) => ({
  scene: null,
  play: (kind, title, subtitle) => set({ scene: { kind, title, subtitle, id: Date.now() } }),
  clear: () => set({ scene: null }),
}));

/** Tempo mínimo que a cena fica na tela (ms), para a troca não "piscar". */
export const SCENE_MS = { login: 1500, logout: 1300 } as const;

/** Espera curta para a cena de saída aparecer antes de encerrar a sessão. */
export const LOGOUT_LEAD_MS = 650;

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "dark" | "light" | "system";

/** Preferências de interface deste navegador (não são compartilhadas). */
interface UIState {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  /** Animações reduzidas: escolha feita aqui, não o aviso do sistema (o Windows o liga só por "Efeitos de animação" desligado). */
  reducedMotion: boolean;
  searchOpen: boolean;
  setTheme: (theme: ThemePreference) => void;
  setReducedMotion: (on: boolean) => void;
  toggleSidebar: () => void;
  setSearchOpen: (open: boolean) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarCollapsed: false,
      reducedMotion: false,
      searchOpen: false,
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      setReducedMotion: (reducedMotion) => {
        set({ reducedMotion });
        applyMotion(reducedMotion);
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
    }),
    {
      name: "central-yawara:ui",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ theme, sidebarCollapsed, reducedMotion }) => ({ theme, sidebarCollapsed, reducedMotion }),
    },
  ),
);

export function resolveTheme(theme: ThemePreference): "dark" | "light" {
  if (theme !== "system") return theme;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(theme);
}

export function applyMotion(reduced: boolean) {
  if (typeof document === "undefined") return;
  if (reduced) document.documentElement.dataset.motion = "reduced";
  else delete document.documentElement.dataset.motion;
}

/** Animações reduzidas escolhidas em Configurações (o aviso do sistema não conta). */
export function motionReduced() {
  return typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced";
}

/** Script inline que aplica o tema antes da pintura, evitando "piscar" no carregamento. */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('central-yawara:ui')||'{}');var t=(s.state&&s.state.theme)||'dark';if(t==='system'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t;if(s.state&&s.state.reducedMotion)document.documentElement.dataset.motion='reduced'}catch(e){document.documentElement.dataset.theme='dark'}})();`;

"use client";

import { useSyncExternalStore } from "react";
import { hasWebGL } from "@/features/sports/court/court-geometry";
import { useUI } from "@/stores/ui";

const noop = () => () => {};
let webglCache: boolean | null = null;
function cachedWebGL() {
  webglCache ??= hasWebGL();
  return webglCache;
}

/**
 * Pode mostrar 3D? Precisa de WebGL e da opção "Animações reduzidas" (Configurações) desligada.
 * O aviso do sistema (prefers-reduced-motion) NÃO conta: no Windows ele liga só por "Efeitos de
 * animação" desligado, e o 3D sumia sem a pessoa ter pedido (mesma regra de globals.css e stores/ui.ts).
 */
export function useCan3D() {
  const reduced = useUI((s) => s.reducedMotion);
  const webgl = useSyncExternalStore(noop, cachedWebGL, () => true);
  return webgl && !reduced;
}

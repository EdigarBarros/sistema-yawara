"use client";

import { useSyncExternalStore } from "react";

/** Mesmo ponto de corte do Tailwind `lg` (barra lateral do computador). */
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Indica se a tela tem largura de computador. Usado quando celular e computador
 * mostram componentes diferentes (montar só um evita buscar e animar o outro à toa).
 */
export function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

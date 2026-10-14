"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** `false` no servidor e durante a hidratação; `true` depois, no navegador. */
export function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

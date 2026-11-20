"use client";

import { useEffect, useRef, useState } from "react";
import { motionReduced } from "@/stores/ui";

/**
 * Conta de 0 (ou do valor anterior) até `target` em `duration` ms, com
 * desaceleração no fim. Com "reduzir movimento" ligado, mostra o valor direto.
 */
export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  const shown = useRef(0);

  useEffect(() => {
    const reduce = motionReduced();
    const start = from.current;
    if (reduce || start === target) {
      from.current = target;
      shown.current = target;
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (target - start) * eased);
      shown.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Recomeça de onde parou (no modo estrito do React o efeito roda duas vezes ao montar).
      from.current = shown.current;
    };
  }, [target, duration]);

  return value;
}

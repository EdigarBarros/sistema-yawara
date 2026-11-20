"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Destaque que desliza de um item para outro (abas, filtros, menu).
 *
 * Mede o item ativo dentro do contêiner (por padrão `[data-glide-active]`) e
 * devolve o estilo de um elemento `.glide` que acompanha a posição e o tamanho
 * dele. O contêiner precisa de `position: relative`. Remede sozinho quando o
 * item ativo muda (atributos), quando algo muda de tamanho ou quando `deps` muda.
 * Na primeira medição aparece direto, sem deslizar a partir do canto.
 */
export function useGlide<T extends HTMLElement>(deps: unknown[] = [], selector = "[data-glide-active]") {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; ready: boolean } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) return setBox(null);
      const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      setBox((prev) => {
        if (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return prev;
        return { ...next, ready: prev !== null };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    Array.from(root.children).forEach((el) => ro.observe(el));
    const mo = new MutationObserver(measure);
    mo.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-state", "data-glide-active", "aria-pressed", "aria-selected"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, ...deps]);

  const style: CSSProperties = box
    ? {
        width: box.w,
        height: box.h,
        transform: `translate(${box.x}px, ${box.y}px)`,
        transition: box.ready ? undefined : "none",
      }
    : { opacity: 0 };

  return [ref, style] as const;
}

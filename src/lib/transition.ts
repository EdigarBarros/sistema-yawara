"use client";

import { flushSync } from "react-dom";
import { motionReduced } from "@/stores/ui";

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

function canAnimate() {
  if (typeof document === "undefined") return false;
  const doc = document as DocumentWithVT;
  if (!doc.startViewTransition) return false;
  if (motionReduced()) return false;
  // Sem "match-element" cada item precisaria de um nome único escrito à mão.
  return typeof CSS !== "undefined" && CSS.supports("view-transition-name", "match-element");
}

/**
 * Troca de elementos animada (View Transitions do navegador).
 *
 * O navegador tira uma "foto" da tela, aplica a mudança e anima a diferença:
 * itens com a classe `vt-item` deslizam até a nova posição, os que somem
 * desbotam e os que chegam aparecem. Só use com estado local (useState):
 * a mudança precisa acontecer na hora, dentro do flushSync.
 * Sem suporte ou com "reduzir movimento", só aplica a mudança.
 */
export function swap(update: () => void) {
  if (!canAnimate()) return update();
  const doc = document as DocumentWithVT;
  doc.documentElement.dataset.vt = "list";
  const t = doc.startViewTransition!(() => flushSync(update));
  void t.finished.finally(() => {
    delete doc.documentElement.dataset.vt;
  });
}

"use client";

import { isValidElement, type ReactNode } from "react";
import { useCountUp } from "@/hooks/use-count-up";

/** Separa "R$ 1.250,50 mil" em prefixo, número e sufixo (formato brasileiro). */
export function splitNumber(text: string) {
  const m = text.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/);
  if (!m || m.index === undefined) return null;
  const raw = m[0];
  const decimals = raw.includes(",") ? raw.split(",")[1].length : 0;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return { before: text.slice(0, m.index), n, decimals, after: text.slice(m.index + raw.length) };
}

function Counting({ text }: { text: string }) {
  const parts = splitNumber(text)!;
  const scale = 10 ** parts.decimals;
  const v = useCountUp(Math.round(parts.n * scale)) / scale;
  const shown = v.toLocaleString("pt-BR", { minimumFractionDigits: parts.decimals, maximumFractionDigits: parts.decimals });
  return (
    <>
      {parts.before}
      {shown}
      {parts.after}
    </>
  );
}

/**
 * Número que conta de 0 até o valor ao aparecer (e do valor antigo ao novo
 * quando muda), mantendo o texto em volta: "R$ 1.250,00", "41", "+3".
 * Se não for número nem texto com número, mostra como veio.
 */
export function CountUp({ value }: { value: ReactNode }) {
  if (isValidElement(value) || value === null || value === undefined || typeof value === "boolean") return <>{value}</>;
  const text = typeof value === "number" ? value.toLocaleString("pt-BR") : String(value);
  if (!splitNumber(text)) return <>{value}</>;
  return <Counting text={text} />;
}

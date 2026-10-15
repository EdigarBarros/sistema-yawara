"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { isDemoMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { DemoNotice } from "@/components/shared/states";

/**
 * Aviso informativo das telas de campanhas.
 * Demonstração: mantém o aviso de demonstração de sempre. Firebase: aviso
 * neutro (sem o ícone de "experimento"), com o texto do ambiente real.
 * Sem texto para o modo atual, não renderiza nada.
 */
export function CampaignNotice({
  demo,
  live,
  tone = "info",
  className,
}: {
  /** Texto no modo demonstração. */
  demo?: ReactNode;
  /** Texto no modo Firebase (dados reais). */
  live?: ReactNode;
  tone?: "info" | "warn";
  className?: string;
}) {
  if (isDemoMode) {
    return demo ? (
      <DemoNotice tone={tone} className={className}>
        {demo}
      </DemoNotice>
    ) : null;
  }
  if (!live) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed",
        tone === "info" ? "border-info/25 bg-info/[0.07] text-fg-muted" : "border-warn/30 bg-warn/[0.08] text-fg-muted",
        className,
      )}
    >
      <Info className={cn("mt-0.5 size-4 shrink-0", tone === "info" ? "text-info" : "text-warn")} aria-hidden />
      <div className="min-w-0">{live}</div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Erro devolvido pelo servidor ao enviar um formulário.
 *
 * Em janelas longas o corpo do formulário rola e o botão de enviar fica no
 * rodapé fixo: um aviso no fim do corpo ficaria fora da área visível e o
 * clique pareceria não ter efeito. Por isso, quando o aviso aparece (ou muda),
 * ele rola até ficar visível ("nearest": só o necessário).
 */
export function FormAlert({ message, icon, className }: { message?: string | null; icon?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message || !ref.current) return;
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current.scrollIntoView?.({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [message]);

  if (!message) return null;
  return (
    <div ref={ref} role="alert" className={cn("rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger", icon && "flex items-start gap-2", className)}>
      {icon && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      {icon ? <span className="min-w-0">{message}</span> : message}
    </div>
  );
}

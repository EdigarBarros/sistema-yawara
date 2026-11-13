"use client";

import { Loader2 } from "lucide-react";
import { useUploads } from "@/stores/uploads";
import { Progress } from "@/components/ui/misc";

/**
 * Progresso dos envios em andamento dentro da janela que está salvando. A
 * porcentagem só avança quando o armazenamento confirma cada parte; depois,
 * "Conferindo arquivo…" até o servidor terminar a conferência.
 */
export function UploadProgress() {
  // Seleciona a lista (referência estável) e filtra fora do seletor, para não renderizar em laço.
  const items = useUploads((s) => s.items).filter((i) => i.state === "uploading" || i.state === "verifying");
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-line px-5 py-3 sm:px-6" role="status" aria-live="polite">
      {items.map((item) => {
        const pct = Math.round(item.progress * 100);
        return (
          <div key={item.id}>
            <div className="mb-1.5 flex items-center gap-2 text-[12.5px]">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-gold" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 font-mono text-fg-muted">{item.state === "verifying" ? "Conferindo arquivo…" : `Enviando ${pct}%`}</span>
            </div>
            <Progress value={pct} label={`Envio de ${item.name}`} className={item.state === "verifying" ? "animate-pulse" : undefined} />
          </div>
        );
      })}
    </div>
  );
}

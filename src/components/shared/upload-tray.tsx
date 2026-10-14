"use client";

import { CheckCircle2, Loader2, UploadCloud, X, XCircle } from "lucide-react";
import { useUploads } from "@/stores/uploads";
import { Progress } from "@/components/ui/misc";

/** Indicador dos envios de arquivo em andamento, com progresso e cancelamento. */
export function UploadTray() {
  const items = useUploads((s) => s.items);
  if (items.length === 0) return null;
  return (
    <div className="fixed right-4 bottom-4 z-40 w-[min(92vw,340px)] space-y-2" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-line-strong bg-surface px-3.5 py-3 shadow-pop">
          <div className="flex items-center gap-2.5">
            <span className="text-fg-muted [&_svg]:size-4">
              {item.state === "uploading" ? <Loader2 className="animate-spin" /> : item.state === "done" ? <CheckCircle2 className="text-ok" /> : item.state === "error" ? <XCircle className="text-danger" /> : <UploadCloud />}
            </span>
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.name}</p>
            {item.state === "uploading" && item.cancel && (
              <button type="button" onClick={item.cancel} className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label={`Cancelar envio de ${item.name}`}>
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            <Progress value={Math.round(item.progress * 100)} className="flex-1" label={`Envio de ${item.name}`} />
            <span className="w-[86px] text-right font-mono text-[11px] text-fg-subtle">
              {item.state === "uploading" ? `${Math.round(item.progress * 100)}%` : item.state === "done" ? "enviado" : item.state === "cancelled" ? "cancelado" : "falhou"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

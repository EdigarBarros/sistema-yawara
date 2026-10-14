"use client";

import { useState } from "react";
import type { HistoryAction, HistoryEntry } from "@/types";
import { useDirectory } from "@/hooks/use-data";
import { formatDateTimeShort } from "@/lib/format";
import { HISTORY_ACTION_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const DOT: Partial<Record<HistoryAction, string>> = {
  created: "bg-gold",
  payment: "bg-ok",
  sale: "bg-warn",
  cancelled: "bg-danger",
  released: "bg-ice",
  closed: "bg-fg-subtle",
  archived: "bg-fg-subtle",
  shared: "bg-info",
  status: "bg-info",
  version: "bg-gold",
};

/**
 * Histórico visual reutilizável. Nesta etapa é representativo: os registros
 * de auditoria reais serão gravados pelo backend.
 */
export function HistoryTimeline({ entries, limit = 8, className }: { entries: HistoryEntry[]; limit?: number; className?: string }) {
  const dir = useDirectory();
  const [showAll, setShowAll] = useState(false);
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  const visible = showAll ? sorted : sorted.slice(0, limit);

  if (entries.length === 0) {
    return <p className="text-[13px] text-fg-subtle">Nenhuma alteração registrada.</p>;
  }

  return (
    <div className={className}>
      <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[3.5px] before:w-px before:bg-line">
        {visible.map((e) => (
          <li key={e.id} className="relative grid grid-cols-[8px_1fr] gap-3">
            <span className={cn("mt-1.5 size-2 rounded-full ring-4 ring-surface", DOT[e.action] ?? "bg-surface-3")} aria-hidden />
            <div className="min-w-0 text-[13px]">
              <p className="leading-snug">
                <span className="font-semibold text-fg">{e.summary}</span>
              </p>
              <p className="mt-1 text-[12px] text-fg-subtle">
                <span className="sr-only">{HISTORY_ACTION_LABELS[e.action]} · </span>
                {dir.memberName(e.actorId)} · <span className="tnum font-mono text-[11.5px]">{formatDateTimeShort(e.at)}</span>
              </p>
            </div>
          </li>
        ))}
      </ol>
      {sorted.length > limit && (
        <Button variant="link" size="sm" className="mt-3 text-[12.5px]" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Mostrar menos" : `Ver todas as ${sorted.length} alterações`}
        </Button>
      )}
      <p className="mt-4 text-[11.5px] text-fg-subtle">Histórico demonstrativo. A auditoria oficial será registrada pelo backend.</p>
    </div>
  );
}

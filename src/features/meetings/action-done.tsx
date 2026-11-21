"use client";

import { Check, Loader2 } from "lucide-react";
import type { Meeting, MeetingAction } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { canToggleAction } from "@/lib/meeting-actions";
import { cn } from "@/lib/utils";

/** Caixinha "feito" de um encaminhamento. Sem permissão, mostra só a situação. */
export function ActionDoneToggle({
  meeting,
  action,
  className,
  onDone,
}: {
  meeting: Meeting;
  action: MeetingAction;
  className?: string;
  /** Chamado quando o encaminhamento acabou de ser marcado como feito (para animar a saída da lista). */
  onDone?: () => void;
}) {
  const access = useAccess();
  const done = !!action.doneAt;
  const allowed = !!access.ctx && canToggleAction(access.ctx, meeting, action);
  const toggle = useAction(() => services.meetings.setActionDone(meeting.id, action.id, !done), {
    success: done ? "Encaminhamento reaberto" : "Encaminhamento feito ✓",
    onSuccess: (m) => {
      if (m.actions.find((a) => a.id === action.id)?.doneAt) onDone?.();
    },
  });
  const label = done ? `Reabrir: ${action.description}` : `Marcar como feito: ${action.description}`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      title={allowed ? (done ? "Reabrir" : "Marcar como feito") : done ? "Feito" : "Só o responsável ou a Secretaria marcam"}
      disabled={!allowed || toggle.pending}
      onClick={() => toggle.runSafe()}
      className={cn(
        "press grid size-6 shrink-0 place-items-center rounded-md border-2 transition-colors disabled:cursor-default",
        done ? "border-ok bg-ok text-white" : "border-line-strong enabled:hover:border-ok",
        !allowed && !done && "opacity-50",
        className,
      )}
    >
      {toggle.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : done ? <Check className="anim-pop size-4" strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}

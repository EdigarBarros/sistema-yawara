/**
 * Encaminhamentos das reuniões: quem pode marcar como feito e o que está em
 * aberto. Regras puras, usadas pela tela, pela demonstração e pelo servidor
 * (functions/src/modules/meetings.ts). Testadas em meeting-actions.test.ts.
 */
import type { DateOnly, Meeting, MeetingAction } from "@/types";
import { canSeeMeeting } from "./policies";
import { hasPermission, type AccessContext } from "./permissions";

/**
 * Marcar como feito vale também em atas aprovadas (o texto da ata continua
 * travado; isto é só o acompanhamento). Pode: o responsável pelo
 * encaminhamento, quem criou a reunião ou quem tem meetings.edit. Reunião
 * arquivada fica travada.
 */
export function canToggleAction(ctx: AccessContext, meeting: Meeting, action: Pick<MeetingAction, "responsibleId">) {
  if (meeting.status === "archived" || !canSeeMeeting(ctx, meeting)) return false;
  return action.responsibleId === ctx.user.id || meeting.createdBy === ctx.user.id || hasPermission(ctx, "meetings.edit");
}

export interface OpenAction {
  action: MeetingAction;
  meeting: Meeting;
  overdue: boolean;
}

/** Encaminhamentos em aberto (de reuniões não arquivadas): atrasados primeiro, depois pelo prazo. */
export function openActions(meetings: Meeting[], today: DateOnly): OpenAction[] {
  const list: OpenAction[] = [];
  for (const meeting of meetings) {
    if (meeting.status === "archived") continue;
    for (const action of meeting.actions) if (!action.doneAt) list.push({ action, meeting, overdue: !!action.dueDate && action.dueDate < today });
  }
  const key = (o: OpenAction) => `${o.overdue ? 0 : 1}${o.action.dueDate ?? "9999-99-99"}${o.meeting.date}`;
  return list.sort((a, b) => key(a).localeCompare(key(b)));
}

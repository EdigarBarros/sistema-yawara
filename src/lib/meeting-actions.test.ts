import { describe, expect, it } from "vitest";
import type { Meeting, MeetingAction } from "@/types";
import { buildSeed } from "@/data/demo/seed";
import { USR } from "@/data/demo/organization";
import type { AccessContext } from "./permissions";
import { canToggleAction, openActions } from "./meeting-actions";

const db = buildSeed(new Date("2026-11-20T15:00:00-03:00"));
const ctxOf = (id: string): AccessContext => {
  const user = db.members.find((m) => m.id === id)!;
  const role = db.roles.find((r) => r.id === user.roleId)!;
  return { user, role, department: db.departments.find((d) => d.id === role.departmentId) };
};
let n = 0;
const action = (p: Partial<MeetingAction>) => ({ id: `a${++n}`, description: "Fazer", ...p }) as MeetingAction;
const meeting = (p: Partial<Meeting>) =>
  ({ id: `m${++n}`, date: "2026-11-10", status: "approved", createdBy: USR.helena, access: { scope: "all", roleIds: [], userIds: [] }, participantIds: [], actions: [], ...p }) as unknown as Meeting;

describe("encaminhamentos das reuniões", () => {
  it("em aberto: sem os feitos e sem reuniões arquivadas, atrasados primeiro", () => {
    const list = openActions(
      [
        meeting({ actions: [action({ description: "B", dueDate: "2026-11-30" }), action({ description: "A", dueDate: "2026-11-01" }), action({ description: "feito", doneAt: "x" })] }),
        meeting({ status: "archived", actions: [action({ description: "arquivada" })] }),
      ],
      "2026-11-20",
    );
    expect(list.map((o) => o.action.description)).toEqual(["A", "B"]);
    expect(list[0].overdue).toBe(true);
  });

  it("quem pode marcar: responsável, quem criou ou meetings.edit; arquivada não", () => {
    const m = meeting({});
    const own = action({ responsibleId: USR.bruno });
    expect(canToggleAction(ctxOf(USR.bruno), m, own)).toBe(true);
    expect(canToggleAction(ctxOf(USR.helena), m, action({}))).toBe(true);
    expect(canToggleAction(ctxOf(USR.bruno), m, action({ responsibleId: USR.caio }))).toBe(false);
    expect(canToggleAction(ctxOf(USR.helena), meeting({ status: "archived" }), own)).toBe(false);
  });
});

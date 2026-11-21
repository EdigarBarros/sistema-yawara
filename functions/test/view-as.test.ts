import { beforeEach, describe, expect, it } from "vitest";
import { supportRoleDefinition } from "@/lib/support";
import type { AtleticaEvent } from "@/types";
import { handleApiCall } from "../src/core/dispatch";
import { normalizeError } from "../src/core/errors";
import { eventsActions } from "../src/modules/events";
import { organizationActions } from "../src/modules/organization";
import { auditFor, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const NOW = "2026-11-21T12:00:00.000Z";

function eventInput() {
  return {
    name: "Evento pelo suporte",
    description: "",
    objective: "",
    type: "festa",
    date: "2026-12-20",
    time: "20:00",
    location: "Quadra",
    departmentId: "eventos",
    responsibleIds: ["evt"],
    access: { scope: "all", roleIds: [], userIds: [] },
  };
}

/** Chamada como faria o navegador (envelope com actAs opcional). */
async function call<R>(actions: Record<string, unknown>, api: string, action: string, uid: string, payload: unknown, actAs?: string): Promise<R> {
  try {
    return (await handleApiCall(api, actions as never, { action, payload, requestId: `req-${Math.random().toString(36).slice(2)}`, ...(actAs ? { actAs } : {}) }, uid)) as R;
  } catch (error) {
    throw normalizeError(error);
  }
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await db.doc("roles/suporte").set({ ...supportRoleDefinition(), createdAt: NOW, updatedAt: NOW });
  await seedPeople();
  await createMember("sup", "Suporte Teste", "suporte");
  await createMember("sup2", "Outro Suporte", "suporte");
  await createMember("inativo", "Inativo Teste", "assessor-eventos", { status: "inactive" });
});

describe("ver como (conta de suporte)", () => {
  it("o suporte age como a pessoa: o registro sai no nome dela e a auditoria marca o suporte", async () => {
    const ev = await call<AtleticaEvent>(eventsActions, "events", "create", "sup", eventInput(), "evt");
    expect(ev.createdBy).toBe("evt");
    expect(ev.history[0].actorId).toBe("evt");
    const audit = (await auditFor(ev.id)).find((a) => a.action === "events.create")!;
    expect(audit).toMatchObject({ actorId: "evt", onBehalfById: "sup", onBehalfByName: "Suporte Teste" });
  });

  it("só o cargo suporte pode usar actAs; tentativa é recusada e auditada", async () => {
    await expectCode(call(eventsActions, "events", "create", "pres", eventInput(), "evt"), "forbidden");
    const denied = await db.collection("auditLogs").where("outcome", "==", "denied").get();
    expect(denied.docs.some((d) => d.data().actorId === "pres" && d.data().details?.actAs === "evt")).toBe(true);
  });

  it("não vale para a própria conta, outro suporte ou conta desativada", async () => {
    await expectCode(call(eventsActions, "events", "create", "sup", eventInput(), "sup"), "invalid");
    await expectCode(call(eventsActions, "events", "create", "sup", eventInput(), "sup2"), "forbidden");
    await expectCode(call(eventsActions, "events", "create", "sup", eventInput(), "inativo"), "forbidden");
  });

  it("vale o que a pessoa pode: vendo como assessor, o suporte não cria eventos", async () => {
    await expectCode(call(eventsActions, "events", "create", "sup", eventInput(), "ass"), "forbidden");
  });

  it("entrar e sair da visão ficam na auditoria e não notificam a pessoa", async () => {
    const r = await call<{ uid: string; name: string }>(organizationActions, "organization", "startViewAs", "sup", { memberId: "evt" });
    expect(r.uid).toBe("evt");
    await call(organizationActions, "organization", "stopViewAs", "sup", { memberId: "evt" });
    const logs = await db.collection("auditLogs").where("actorId", "==", "sup").get();
    const actions = logs.docs.map((d) => d.data().action);
    expect(actions).toEqual(expect.arrayContaining(["organization.startViewAs", "organization.stopViewAs"]));
    expect((await db.collection("notifications").where("recipientId", "==", "evt").get()).size).toBe(0);
    await expectCode(call(organizationActions, "organization", "startViewAs", "pres", { memberId: "evt" }), "forbidden");
  });
});

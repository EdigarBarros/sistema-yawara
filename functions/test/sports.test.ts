import { beforeEach, describe, expect, it } from "vitest";
import type { SportTeam } from "@/types";
import { sportsActions } from "../src/modules/sports";
import { auditFor, caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const sports = caller("sports", sportsActions);
const ALL = { scope: "all", roleIds: [], userIds: [] };

function teamInput(over: Record<string, unknown> = {}) {
  return { name: "Futsal Teste", modality: "futsal", category: "masculino", color: "#e1af37", departmentId: "eventos", coachIds: ["evt"], access: ALL, ...over };
}

const createTeam = (uid = "pres", over: Record<string, unknown> = {}) => sports<SportTeam>("create", uid, teamInput(over));

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("times", () => {
  it("cria com código, readers (criador + técnicos + público) e auditoria", async () => {
    const team = await createTeam("pres", { access: { scope: "people", roleIds: [], userIds: ["fin"] } });
    expect(team.code).toMatch(/^TIM-\d{4}-001$/);
    expect(team).not.toHaveProperty("readers");
    const data = (await db.doc(`sportTeams/${team.id}`).get()).data()!;
    expect(data.readers).toEqual(["u:evt", "u:fin", "u:pres"]);
    expect((await auditFor(team.id)).map((a) => a.action)).toContain("sports.create");
  });

  it("perfis sem sports.create não criam; campos estranhos são recusados", async () => {
    await expectCode(createTeam("evt"), "forbidden");
    await expectCode(sports("create", "pres", { ...teamInput(), readers: ["all"] }), "invalid");
    await expectCode(createTeam("pres", { coachIds: ["ninguem"] }), "invalid");
  });

  it("o técnico (sem permissão no módulo) não altera: precisa de sports.view", async () => {
    const team = await createTeam();
    await expectCode(sports("saveAthlete", "evt", { teamId: team.id, input: { name: "Atleta", number: 1, position: "goleiro", active: true } }), "forbidden");
  });
});

describe("elenco, escalação e jogos", () => {
  it("valida camisa, titulares e placar no servidor", async () => {
    const team = await createTeam();
    let t = await sports<SportTeam>("saveAthlete", "pres", { teamId: team.id, input: { name: "Goleiro", number: 1, position: "goleiro", active: true } });
    await expectCode(sports("saveAthlete", "pres", { teamId: team.id, input: { name: "Outro", number: 1, position: "fixo", active: true } }), "invalid");
    await expectCode(sports("saveAthlete", "pres", { teamId: team.id, input: { name: "Outro", number: 2, position: "levantador", active: true } }), "invalid");
    const gk = t.athletes[0];
    t = await sports<SportTeam>("saveLineup", "pres", { teamId: team.id, formation: "1-2-1", slots: [{ athleteId: gk.id, x: -50, z: 0 }] });
    expect(t.lineup.slots[0]).toMatchObject({ athleteId: gk.id, x: -20, z: 0 });
    await expectCode(sports("saveLineup", "pres", { teamId: team.id, formation: "x", slots: [{ athleteId: "fantasma", x: 0, z: 0 }] }), "invalid");

    const game = { kind: "amistoso", date: "2026-11-20", time: "19:00", location: "Quadra", opponent: "Atlética X", status: "done", score: { us: 3, them: 1 } };
    t = await sports<SportTeam>("saveSession", "pres", { teamId: team.id, input: game });
    expect(t.sessions[0]).toMatchObject({ opponent: "Atlética X", score: { us: 3, them: 1 } });
    await expectCode(sports("saveSession", "pres", { teamId: team.id, input: { ...game, kind: "treino" } }), "invalid");

    t = await sports<SportTeam>("removeAthlete", "pres", { teamId: team.id, athleteId: gk.id });
    expect(t.lineup.slots).toEqual([]);
  });

  it("time arquivado não aceita alterações", async () => {
    const team = await createTeam();
    await sports("setStatus", "pres", { id: team.id, status: "archived" });
    await expectCode(sports("saveLineup", "pres", { teamId: team.id, formation: "x", slots: [] }), "conflict");
  });
});

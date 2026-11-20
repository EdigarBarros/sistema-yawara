import { beforeEach, describe, expect, it } from "vitest";
import type { SportTeam } from "@/types";
import { sportsActions } from "../src/modules/sports";
import { auditFor, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const sports = caller("sports", sportsActions);

const ALL = { scope: "all", roleIds: [], userIds: [] };
const BOARD = { scope: "board", roleIds: [], userIds: [] };

function teamInput(over: Record<string, unknown> = {}) {
  return { name: "Futsal Feminino", sport: "Futsal", category: "feminino", description: "Time da Yawara", coach: "Técnica Teste", responsibleId: "esp", access: ALL, ...over };
}

async function createTeam(uid = "esp", over: Record<string, unknown> = {}) {
  return sports<SportTeam>("create", uid, teamInput(over));
}

async function stored(id: string) {
  return (await db.doc(`sportsTeams/${id}`).get()).data()!;
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
  await createMember("esp", "Diretor Esportes Teste", "diretor-esportes");
  await createMember("assesp", "Assessora Esportes Teste", "assessor-esportes");
});

describe("modalidades", () => {
  it("a diretoria de Esportes cria; servidor define código, situação, readers, histórico, busca e auditoria", async () => {
    const t = await createTeam();
    expect(t.code).toMatch(/^ESP-\d{4}-001$/);
    expect(t).toMatchObject({ name: "Futsal Feminino", status: "active", createdBy: "esp", responsibleId: "esp", trainings: [], athletes: [], matches: [], competitions: [] });
    const data = await stored(t.id);
    expect(data.readers).toEqual(expect.arrayContaining(["all", "u:esp"]));
    expect((await db.doc(`searchIndex/team__${t.id}`).get()).data()).toMatchObject({ module: "sports", title: "Futsal Feminino" });
    expect((await auditFor(t.id)).map((a) => a.action)).toEqual(["sports.create"]);
  });

  it("quem não tem sports.create não cria; responsável precisa ser integrante ativo", async () => {
    await expectCode(createTeam("sec"), "forbidden");
    await expectCode(createTeam("assesp"), "forbidden");
    await expectCode(createTeam("esp", { responsibleId: "ninguem" }), "invalid");
  });

  it("público: modalidade só da diretoria não aparece para a assessoria; o responsável sempre vê", async () => {
    const t = await createTeam("esp", { access: BOARD });
    await expectCode(sports("saveAthlete", "assesp", { id: t.id, item: { name: "Atleta Teste" } }), "forbidden");
    const shared = await createTeam("esp", { name: "Vôlei Misto", access: BOARD, responsibleId: "assesp" });
    const updated = await sports<SportTeam>("saveAthlete", "assesp", { id: shared.id, item: { name: "Atleta Teste" } });
    expect(updated.athletes).toHaveLength(1);
    expect((await stored(shared.id)).readers).toEqual(expect.arrayContaining(["board", "u:esp", "u:assesp"]));
  });

  it("editar: sports.edit, criador ou responsável; a presidência edita tudo", async () => {
    const t = await createTeam();
    const byPres = await sports<SportTeam>("update", "pres", { id: t.id, input: { coach: null, description: "Atualizada" } });
    expect(byPres.coach).toBeUndefined();
    expect(byPres.description).toBe("Atualizada");
    await expectCode(sports("update", "sec", { id: t.id, input: { name: "Outro nome" } }), "forbidden");
    expect((await auditFor(t.id)).some((a) => a.action === "sports.update")).toBe(true);
  });
});

describe("treinos, elenco, jogos e competições", () => {
  it("inclui, atualiza, ordena e remove itens; validações do servidor", async () => {
    const t = await createTeam();
    await sports("saveTraining", "esp", { id: t.id, item: { weekday: 4, start: "19:00", end: "20:30", location: "Quadra" } });
    let team = await sports<SportTeam>("saveTraining", "esp", { id: t.id, item: { weekday: 2, start: "19:00", location: "Quadra" } });
    expect(team.trainings.map((s) => s.weekday)).toEqual([2, 4]);
    await expectCode(sports("saveTraining", "esp", { id: t.id, item: { weekday: 1, start: "20:00", end: "19:00", location: "Quadra" } }), "invalid");

    team = await sports<SportTeam>("saveAthlete", "esp", { id: t.id, item: { name: "Atleta  Um", number: "10", captain: true } });
    expect(team.athletes[0]).toMatchObject({ name: "Atleta Um", number: "10", captain: true });
    await expectCode(sports("saveAthlete", "esp", { id: t.id, item: { name: "Atleta Dois", number: "10" } }), "conflict");
    await expectCode(sports("saveAthlete", "esp", { id: t.id, item: { name: "atleta um" } }), "conflict");
    const athleteId = team.athletes[0].id;
    team = await sports<SportTeam>("saveAthlete", "esp", { id: t.id, item: { id: athleteId, name: "Atleta Um", number: "7" } });
    expect(team.athletes).toHaveLength(1);
    expect(team.athletes[0]).toMatchObject({ id: athleteId, number: "7" });
    expect(team.athletes[0].captain).toBeUndefined();

    team = await sports<SportTeam>("saveCompetition", "esp", { id: t.id, item: { name: "Copa Teste", startDate: "2026-11-01", endDate: "2026-11-10", location: "Ginásio", status: "upcoming" } });
    const compId = team.competitions[0].id;
    await expectCode(sports("saveMatch", "esp", { id: t.id, item: { date: "2026-11-02", opponent: "Rival", location: "Ginásio", status: "played", scoreFor: 2 } }), "invalid");
    await expectCode(sports("saveMatch", "esp", { id: t.id, item: { date: "2026-11-02", opponent: "Rival", location: "Ginásio", status: "scheduled", competitionId: "nao-existe" } }), "invalid");
    team = await sports<SportTeam>("saveMatch", "esp", { id: t.id, item: { date: "2026-11-02", time: "18:00", opponent: "Rival", location: "Ginásio", status: "played", scoreFor: 3, scoreAgainst: 1, competitionId: compId } });
    expect(team.matches[0]).toMatchObject({ scoreFor: 3, scoreAgainst: 1, competitionId: compId });

    // Remover a competição não apaga os jogos: eles ficam sem competição.
    team = await sports<SportTeam>("removeItem", "esp", { id: t.id, list: "competitions", itemId: compId });
    expect(team.competitions).toHaveLength(0);
    expect(team.matches).toHaveLength(1);
    expect(team.matches[0].competitionId).toBeUndefined();
    team = await sports<SportTeam>("removeItem", "esp", { id: t.id, list: "matches", itemId: team.matches[0].id });
    expect(team.matches).toHaveLength(0);
    await expectCode(sports("removeItem", "esp", { id: t.id, list: "matches", itemId: "nao-existe" }), "not_found");

    // Nomes de atletas não vão para a auditoria nem para o histórico.
    const audit = JSON.stringify(await auditFor(t.id));
    expect(audit).not.toContain("Atleta Um");
    expect(JSON.stringify((await stored(t.id)).history)).not.toContain("Atleta Um");
  });

  it("a assessoria (sports.edit) edita itens, mas não arquiva; modalidade arquivada não é editada", async () => {
    const t = await createTeam();
    await sports("saveTraining", "assesp", { id: t.id, item: { weekday: 3, start: "18:00", location: "Quadra" } });
    await expectCode(sports("setStatus", "assesp", { id: t.id, status: "archived" }), "forbidden");
    const archived = await sports<SportTeam>("setStatus", "esp", { id: t.id, status: "archived" });
    expect(archived.status).toBe("archived");
    expect((await db.doc(`searchIndex/team__${t.id}`).get()).get("archived")).toBe(true);
    await expectCode(sports("saveTraining", "esp", { id: t.id, item: { weekday: 5, start: "18:00", location: "Quadra" } }), "conflict");
    const back = await sports<SportTeam>("setStatus", "esp", { id: t.id, status: "active" });
    expect(back.status).toBe("active");
  });

  it("módulo desativado recusa as operações", async () => {
    const t = await createTeam();
    await db.doc("settings/system").set({ modules: { sports: false } }, { merge: true });
    await expectCode(sports("saveTraining", "esp", { id: t.id, item: { weekday: 3, start: "18:00", location: "Quadra" } }), "unavailable");
  });
});

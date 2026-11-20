import { beforeEach, describe, expect, it } from "vitest";
import { buildSeed } from "@/data/demo/seed";
import { USR } from "@/data/demo/organization";
import { TEAM } from "@/data/demo/sports";
import { setDBForTests } from "./db";
import { disableLatencyForTests, setActorForTests } from "./context";
import { localSports as sports } from "./sports";

disableLatencyForTests();

beforeEach(() => {
  setDBForTests(buildSeed(new Date("2026-10-14T15:00:00-03:00")));
  setActorForTests(USR.gabriel);
});

const all = { scope: "all" as const, roleIds: [], userIds: [] };

describe("times", () => {
  it("o diretor de esportes cria um time com código", async () => {
    const t = await sports.create({ name: "Handebol Misto", modality: "handebol", category: "misto", color: "#e1af37", departmentId: "dep-esportes", coachIds: [USR.gabriel], access: all });
    expect(t.code).toMatch(/^TIM-\d{4}-\d{3}$/);
    expect(t.athletes).toEqual([]);
  });

  it("quem não tem o módulo não cria times", async () => {
    setActorForTests(USR.caio);
    await expect(sports.create({ name: "Time X", modality: "futsal", category: "misto", color: "#e1af37", departmentId: "dep-esportes", coachIds: [], access: all })).rejects.toThrow(/não pode criar/);
  });

  it("não troca a modalidade de um time com atletas", async () => {
    await expect(sports.update(TEAM.futsal, { modality: "volei" })).rejects.toThrow(/modalidade/);
  });

  it("time arquivado fica bloqueado até ser reativado", async () => {
    await sports.setStatus(TEAM.basquete, "archived");
    await expect(sports.saveLineup(TEAM.basquete, { formation: "2-3", slots: [] })).rejects.toThrow(/arquivado/);
    await sports.setStatus(TEAM.basquete, "active");
    await expect(sports.saveLineup(TEAM.basquete, { formation: "2-3", slots: [] })).resolves.toBeTruthy();
  });
});

describe("elenco e escalação", () => {
  it("não aceita duas camisas iguais entre atletas ativos", async () => {
    await expect(sports.saveAthlete(TEAM.futsal, { name: "Novo Atleta", number: 7, position: "ala", active: true })).rejects.toThrow(/camisa 7/);
  });

  it("não escala mais titulares do que a modalidade permite", async () => {
    const team = await sports.get(TEAM.futsal);
    const slots = team.athletes.slice(0, 6).map((a, i) => ({ athleteId: a.id, x: -i, z: 0 }));
    await expect(sports.saveLineup(TEAM.futsal, { formation: "livre", slots })).rejects.toThrow(/no máximo 5 titulares/);
  });

  it("prende a posição dentro da quadra", async () => {
    const team = await sports.get(TEAM.basquete);
    const saved = await sports.saveLineup(TEAM.basquete, { formation: "livre", slots: [{ athleteId: team.athletes[0].id, x: -99, z: 40 }] });
    expect(saved.lineup.slots[0]).toMatchObject({ x: -14, z: 7.5 });
  });

  it("atleta removido(a) ou inativado(a) sai da escalação", async () => {
    const team = await sports.get(TEAM.futsal);
    const [first, second] = team.lineup.slots;
    const removed = await sports.removeAthlete(TEAM.futsal, first.athleteId);
    expect(removed.lineup.slots.some((s) => s.athleteId === first.athleteId)).toBe(false);
    const athlete = removed.athletes.find((a) => a.id === second.athleteId)!;
    const inactive = await sports.saveAthlete(TEAM.futsal, { ...athlete, active: false }, athlete.id);
    expect(inactive.lineup.slots.some((s) => s.athleteId === second.athleteId)).toBe(false);
  });
});

describe("treinos e jogos", () => {
  const base = { date: "2026-10-20", time: "19:00", location: "Quadra" };

  it("treino não tem placar e jogo exige adversário", async () => {
    await expect(sports.saveSession(TEAM.futsal, { ...base, kind: "treino", status: "done", score: { us: 1, them: 0 } })).rejects.toThrow(/Treinos não têm placar/);
    await expect(sports.saveSession(TEAM.futsal, { ...base, kind: "amistoso", status: "scheduled" })).rejects.toThrow(/adversário/);
  });

  it("placar só em jogo realizado; cancelado não aceita placar", async () => {
    await expect(sports.saveSession(TEAM.futsal, { ...base, kind: "amistoso", opponent: "Atlética X", status: "cancelled", score: { us: 2, them: 1 } })).rejects.toThrow(/realizados/);
    const t = await sports.saveSession(TEAM.futsal, { ...base, kind: "amistoso", opponent: "Atlética X", status: "done", score: { us: 2, them: 1 } });
    expect(t.sessions.at(-1)).toMatchObject({ opponent: "Atlética X", score: { us: 2, them: 1 }, status: "done" });
  });

  it("quem não tem o módulo de esportes não vê times", async () => {
    setActorForTests(USR.pedro);
    await expect(sports.list()).resolves.toEqual([]);
  });
});

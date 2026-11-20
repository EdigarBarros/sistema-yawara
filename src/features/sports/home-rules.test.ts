import { describe, expect, it } from "vitest";
import type { Match, SportTeam } from "@/types";
import { countdown, nextGame, seasonNumbers, weekAgenda } from "./home-rules";

const TODAY = "2026-11-20"; // sexta-feira
let n = 0;
const match = (p: Partial<Match>) => ({ id: `m${++n}`, date: "2026-11-25", opponent: "Atlética X", location: "Ginásio", status: "scheduled", ...p }) as Match;
const team = (p: Partial<SportTeam>) =>
  ({ id: `t${++n}`, name: "Futsal", sport: "Futsal", status: "active", trainings: [], athletes: [], matches: [], competitions: [], ...p }) as unknown as SportTeam;

describe("tela do diretor de esportes", () => {
  it("acha o próximo jogo entre as modalidades ativas", () => {
    const a = team({ matches: [match({ date: "2026-11-28" }), match({ date: "2026-11-10" })] });
    const b = team({ matches: [match({ date: "2026-11-22", time: "10:00" })] });
    const off = team({ status: "archived", matches: [match({ date: "2026-11-21" })] });
    const g = nextGame([a, b, off], TODAY)!;
    expect(g.team).toBe(b);
    expect(g.inDays).toBe(2);
    expect(nextGame([], TODAY)).toBeNull();
  });

  it("monta a semana com treinos fixos e jogos", () => {
    const t = team({
      trainings: [{ id: "s1", weekday: 2, start: "19:00", location: "Quadra" }], // terça
      matches: [match({ date: "2026-11-21", time: "15:00" })],
    });
    const week = weekAgenda([t], TODAY);
    expect(week.map((i) => `${i.kind}:${i.date}`)).toEqual(["match:2026-11-21", "training:2026-11-24"]);
  });

  it("números da temporada: aproveitamento, saldo e jogos do mês", () => {
    const t = team({
      athletes: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      matches: [
        match({ date: "2026-11-05", status: "played", scoreFor: 3, scoreAgainst: 1 }),
        match({ date: "2026-10-05", status: "played", scoreFor: 2, scoreAgainst: 2 }),
        match({ date: "2026-11-25" }),
        match({ date: "2026-11-26", status: "cancelled" }),
      ],
    });
    const s = seasonNumbers([t], TODAY);
    expect(s).toMatchObject({ monthGames: 2, monthPlayed: 1, wins: 1, draws: 1, losses: 0, scored: 5, conceded: 3, athletes: 2 });
    expect(s.efficiency).toBeCloseTo(4 / 6);
    expect(seasonNumbers([], TODAY).efficiency).toBeNull();
  });

  it("contagem regressiva", () => {
    expect(countdown(0)).toBe("É hoje!");
    expect(countdown(1)).toBe("Amanhã");
    expect(countdown(5)).toBe("Em 5 dias");
  });
});

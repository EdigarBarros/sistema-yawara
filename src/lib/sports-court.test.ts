import { describe, expect, it } from "vitest";
import type { Athlete } from "@/types";
import { cleanLineup, courtModalityOf, lineupWithout, positionShort, samePosition } from "./sports-court";

const athletes: Athlete[] = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, name: `Atleta ${i}`, number: String(i + 1) }));

describe("quadra da área de esportes", () => {
  it("descobre a quadra pelo nome do esporte (sem acento e sem caixa)", () => {
    expect(courtModalityOf("Futsal")).toBe("futsal");
    expect(courtModalityOf("VÔLEI de quadra")).toBe("volei");
    expect(courtModalityOf("Basquete 3x3")).toBe("basquete");
    expect(courtModalityOf("Handebol")).toBe("handebol");
    expect(courtModalityOf("Xadrez")).toBeNull();
  });

  it("posição curta e comparação de posições", () => {
    expect(positionShort("Pivô")).toBe("PIV");
    expect(positionShort(undefined)).toBe("—");
    expect(samePosition("Goleira", "goleiro")).toBe(true);
    expect(samePosition("Ala", "pivo")).toBe(false);
  });

  it("limita titulares, recusa quem não é do elenco e prende na quadra", () => {
    const team = { sport: "Futsal", athletes };
    const six = athletes.slice(0, 6).map((a) => ({ athleteId: a.id, x: 0, z: 0 }));
    expect(cleanLineup(team, { formation: "x", slots: six })).toEqual({ error: "No futsal entram no máximo 5 titulares." });
    expect(cleanLineup(team, { formation: "x", slots: [{ athleteId: "fora", x: 0, z: 0 }] })).toHaveProperty("error");
    expect(cleanLineup(team, { formation: "x", slots: [{ athleteId: "a0", x: 0, z: 0 }, { athleteId: "a0", x: 1, z: 1 }] })).toHaveProperty("error");
    expect(cleanLineup(team, { formation: "", slots: [{ athleteId: "a0", x: -99, z: 40.04 }] })).toEqual({ lineup: { formation: "livre", slots: [{ athleteId: "a0", x: -20, z: 10 }] } });
    expect(cleanLineup({ sport: "Xadrez", athletes }, { formation: "", slots: [] })).toHaveProperty("error");
  });

  it("quem sai do elenco sai da escalação", () => {
    expect(lineupWithout({ formation: "1-2-1", slots: [{ athleteId: "a0", x: 0, z: 0 }, { athleteId: "a1", x: 1, z: 1 }] }, "a0")?.slots).toEqual([{ athleteId: "a1", x: 1, z: 1 }]);
    expect(lineupWithout(undefined, "a0")).toBeUndefined();
  });
});

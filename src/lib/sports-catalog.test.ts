import { describe, expect, it } from "vitest";
import { findSport, SPORTS, sportSummary } from "./sports-catalog";

describe("catálogo de modalidades", () => {
  it("tem as sete modalidades, cada uma com posições e titulares", () => {
    expect(SPORTS.map((s) => s.key)).toEqual(["futsal", "society", "campo", "volei", "areia", "handebol", "basquete"]);
    for (const s of SPORTS) {
      expect(s.starters).toBeGreaterThan(0);
      expect(s.positions.length).toBeGreaterThan(0);
      expect(s.goalkeeper).toBe(s.positions.some((p) => p.short === "GOL"));
    }
  });

  it("reconhece o nome gravado, com ou sem acento, e os apelidos", () => {
    expect(findSport("Futsal")?.key).toBe("futsal");
    expect(findSport("VÔLEI")?.key).toBe("volei");
    expect(findSport("volei")?.key).toBe("volei");
    expect(findSport("Vôlei de praia")?.key).toBe("areia");
    expect(findSport("Futebol society")?.key).toBe("society");
    expect(findSport("  futebol   de campo ")?.key).toBe("campo");
    expect(findSport("Handball")?.key).toBe("handebol");
  });

  it("devolve null para esportes fora da lista", () => {
    expect(findSport("Xadrez")).toBeNull();
    expect(findSport("")).toBeNull();
    expect(findSport(undefined)).toBeNull();
  });

  it("resume quantos jogam", () => {
    expect(sportSummary(findSport("futsal")!)).toBe("5 em quadra · com goleiro(a)");
    expect(sportSummary(findSport("volei")!)).toBe("6 em quadra + líbero");
    expect(sportSummary(findSport("campo")!)).toBe("11 em campo · com goleiro(a)");
  });
});

import { describe, expect, it } from "vitest";
import { parseRosterLine, parseRosterText, planRosterAdd, shortName } from "./sports-roster";

describe("lista colada do elenco", () => {
  it("separa o número da camisa no começo ou no fim", () => {
    expect(parseRosterLine("10 Ana Souza")).toEqual({ name: "Ana Souza", number: "10" });
    expect(parseRosterLine("07 - Bia")).toEqual({ name: "Bia", number: "7" });
    expect(parseRosterLine("Carla Dias (9)")).toEqual({ name: "Carla Dias", number: "9" });
    expect(parseRosterLine("Duda - 12")).toEqual({ name: "Duda", number: "12" });
  });

  it("ignora numeração da lista, marcadores e emojis", () => {
    expect(parseRosterLine("1. Ana Souza")).toEqual({ name: "Ana Souza", number: undefined });
    expect(parseRosterLine("2) Bia")).toEqual({ name: "Bia", number: undefined });
    expect(parseRosterLine("- Carla")).toEqual({ name: "Carla", number: undefined });
    expect(parseRosterLine("⚽️ Duda")).toEqual({ name: "Duda", number: undefined });
    expect(parseRosterLine("• 5 Eva")).toEqual({ name: "Eva", number: "5" });
  });

  it("descarta linhas vazias ou sem nome", () => {
    expect(parseRosterText("Ana\n\n   \n123\n--\nBia")).toEqual([
      { name: "Ana", number: undefined },
      { name: "Bia", number: undefined },
    ]);
  });

  it("não repete quem já está no elenco nem a camisa de outra pessoa", () => {
    const plan = planRosterAdd(
      [{ name: "Ana Souza", number: "10" }],
      [
        { name: "ana souza", number: "3" },
        { name: "Bia", number: "10" },
        { name: "Carla", number: "4" },
        { name: "Dani", number: "4" },
        { name: "Carla" },
      ],
    );
    expect(plan.add).toEqual([{ name: "Bia" }, { name: "Carla", number: "4" }, { name: "Dani" }]);
    expect(plan.duplicates).toEqual(["ana souza", "Carla"]);
    expect(plan.numberTaken).toEqual(["Bia", "Dani"]);
  });

  it("usa o apelido ou o primeiro nome", () => {
    expect(shortName({ name: "Ana Souza", nickname: "Aninha" })).toBe("Aninha");
    expect(shortName({ name: "Ana Souza" })).toBe("Ana");
  });
});

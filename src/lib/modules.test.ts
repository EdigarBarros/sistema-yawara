import { describe, expect, it } from "vitest";
import { MODULES } from "./modules";

describe("catálogo de módulos", () => {
  it("textos das permissões valem nos dois modos (sem termos da demonstração)", () => {
    const texts = MODULES.flatMap((m) => [m.label, m.description, ...Object.values(m.actions)]);
    for (const text of texts) expect(text).not.toMatch(/demonstra|fictíci|neste navegador/i);
  });
});

import { describe, expect, it } from "vitest";
import { moduleLabel, resourceLabel } from "./audit-labels";

describe("auditoria: coluna Registro sem identificadores técnicos", () => {
  it("operação recusada (registro novo) aparece como 'Operação'", () => {
    expect(resourceLabel({ resourceType: "operation", module: "campaigns" })).toBe("Operação");
  });

  it("recusas já gravadas com o nome interno da API mostram o nome do módulo", () => {
    const stored: [string, Parameters<typeof resourceLabel>[0]["module"]][] = [
      ["campaigns", "campaigns"],
      ["extension", "extension"],
      ["organization", "organization"],
      ["system", "settings"],
      ["auth", "auth"],
    ];
    for (const [resourceType, module] of stored) {
      const label = resourceLabel({ resourceType, module });
      expect(label).toBe(moduleLabel(module));
      expect(label).not.toBe(resourceType);
    }
    expect(resourceLabel({ resourceType: "system", module: "settings" })).toBe("Configurações");
    expect(resourceLabel({ resourceType: "auth", module: "auth" })).toBe("Acesso e contas");
  });

  it("tipos conhecidos mantêm o próprio nome", () => {
    expect(resourceLabel({ resourceType: "sale", module: "campaigns" })).toBe("Venda");
    expect(resourceLabel({ resourceType: "settings", module: "settings" })).toBe("Configurações");
  });
});

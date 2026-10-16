import { describe, expect, it } from "vitest";
import { disabledModuleNotice, moduleForPath, restrictedNotice } from "./module-route";

describe("módulo da rota (aviso de módulo desativado)", () => {
  it("identifica o módulo pela rota e pelas sub-rotas", () => {
    expect(moduleForPath("/marketing")).toBe("marketing");
    expect(moduleForPath("/financeiro/relatorios")).toBe("finance");
    expect(moduleForPath("/campanhas/nova")).toBe("campaigns");
    expect(moduleForPath("/secretaria/abc/editar")).toBe("meetings");
    expect(moduleForPath("/extensao/prj-1")).toBe("extension");
    expect(moduleForPath("/eventos")).toBe("events");
    expect(moduleForPath("/documentos")).toBe("documents");
  });

  it("rotas sem módulo (ou só com prefixo parecido) não são confundidas", () => {
    expect(moduleForPath("/inicio")).toBeNull();
    expect(moduleForPath("/marketingx")).toBeNull();
    expect(moduleForPath(null)).toBeNull();
  });

  it("texto diz que o módulo foi desativado (não que falta permissão)", () => {
    const notice = disabledModuleNotice("marketing");
    expect(notice.title).toBe("Módulo desativado");
    expect(notice.description).toBe("O módulo Marketing foi desativado nas Configurações. Os dados foram mantidos e voltam quando o módulo for reativado.");
    expect(notice.description).not.toMatch(/permissão/);
  });
});

describe("restrictedNotice: módulo desativado x falta de permissão", () => {
  const enabledExcept = (off: string) => (m: string) => m !== off;

  it("módulo da rota desativado: diz que foi desativado, mesmo com texto próprio da tela", () => {
    for (const description of [undefined, "Seu perfil não tem acesso aos eventos."]) {
      const n = restrictedNotice({ module: moduleForPath("/marketing"), moduleEnabled: enabledExcept("marketing"), description });
      expect(n.disabled).toBe(true);
      expect(n.title).toBe("Módulo desativado");
      expect(n.description).toMatch(/^O módulo Marketing foi desativado nas Configurações\./);
    }
  });

  it("módulo ativo: continua o aviso de permissão (padrão do modo ou texto da tela)", () => {
    const n = restrictedNotice({ module: "marketing", moduleEnabled: enabledExcept("finance") });
    expect(n).toMatchObject({ disabled: false, title: "Área não disponível para este perfil" });
    // Os testes rodam no modo demonstração (padrão): mantém o texto da demonstração.
    expect(n.description).toMatch(/perfil de demonstração/);
    const custom = restrictedNotice({ module: "finance", moduleEnabled: () => true, title: "Dados financeiros restritos", description: "Texto da tela." });
    expect(custom).toEqual({ title: "Dados financeiros restritos", description: "Texto da tela.", disabled: false });
  });

  it("outro módulo desativado não muda o aviso desta área; rota sem módulo também não", () => {
    expect(restrictedNotice({ module: "documents", moduleEnabled: enabledExcept("marketing") }).disabled).toBe(false);
    expect(restrictedNotice({ module: moduleForPath("/inicio"), moduleEnabled: () => false }).disabled).toBe(false);
  });
});

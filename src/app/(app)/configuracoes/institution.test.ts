import { describe, expect, it } from "vitest";
import { defaultSystemSettings } from "@/data/structure/default-structure";
import { changedInstitutionFields } from "./institution";

const current = { ...defaultSystemSettings().institution, motto: "#Yawara" };

describe("dados institucionais: só o que mudou é enviado", () => {
  it("envia apenas o campo alterado (não o formulário inteiro)", () => {
    expect(changedInstitutionFields(current, { ...current, motto: "#VemProYawara" })).toEqual({ motto: "#VemProYawara" });
    expect(changedInstitutionFields(current, { ...current, city: "Cidade Fictícia", shortName: "Atlética Fictícia" })).toEqual({
      shortName: "Atlética Fictícia",
      city: "Cidade Fictícia",
    });
  });

  it("formulário igual ao salvo (ou só com espaços nas pontas): nada para salvar", () => {
    expect(changedInstitutionFields(current, null)).toEqual({});
    expect(changedInstitutionFields(current, { ...current })).toEqual({});
    expect(changedInstitutionFields(current, { ...current, legalName: `  ${current.legalName} ` })).toEqual({});
  });

  it("limpar um campo opcional conta como mudança; campos fora da tela não são enviados", () => {
    expect(changedInstitutionFields(current, { ...current, motto: "" })).toEqual({ motto: "" });
    const withExtra = { ...current, extra: "x" } as typeof current;
    expect(changedInstitutionFields(current, withExtra)).toEqual({});
  });
});

describe("dados institucionais: edições parciais", () => {
  it("só os campos editados entram; um campo alterado por outra pessoa enquanto a tela estava aberta não é sobrescrito", () => {
    // A pessoa editou só o lema; enquanto isso, outra pessoa mudou a cidade (dado atual já atualizado).
    const updatedByOther = { ...current, city: "Cidade Nova" };
    expect(changedInstitutionFields(updatedByOther, { motto: "#Novo" })).toEqual({ motto: "#Novo" });
  });
});

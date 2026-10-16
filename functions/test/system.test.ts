import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultSystemSettings } from "@/data/structure/default-structure";
import type { InstitutionSettings, SystemSettings } from "@/types";
import { zodMessage } from "../src/core/errors";
import { systemActions } from "../src/modules/system";
import { auditFor, caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const system = caller("system", systemActions);
const GENERIC_INVALID = "Alguns dados enviados são inválidos. Revise o formulário e tente novamente.";

/** Texto com cara de mensagem padrão do Zod (em inglês, com detalhes técnicos). */
const ZOD_DEFAULT = /too (small|big)|expected|invalid|characters|>=|<=/i;

async function institutionAudits() {
  return (await auditFor("system")).filter((a) => a.action === "settings.updateInstitution");
}

async function storedInstitution() {
  return ((await db.doc("settings/system").get()).data() as SystemSettings).institution;
}

describe("zodMessage: só mensagens escritas nos esquemas chegam ao usuário", () => {
  it("mensagem padrão do Zod (mínimo, máximo, tipo, enum) vira a mensagem genérica em português", () => {
    const cases = [
      z.string().min(3).safeParse("ab"),
      z.string().max(2).safeParse("abc"),
      z.number().safeParse("1"),
      z.enum(["a", "b"]).safeParse("c"),
      z.object({ name: z.string() }).safeParse({}),
    ];
    for (const result of cases) {
      expect(result.success).toBe(false);
      expect(zodMessage(result.error!)).toBe(GENERIC_INVALID);
    }
  });

  it("mensagem própria do esquema é mantida", () => {
    const result = z.string().trim().min(3, "Informe pelo menos 3 caracteres.").safeParse(" a ");
    expect(zodMessage(result.error!)).toBe("Informe pelo menos 3 caracteres.");
    const refined = z.string().refine((v) => v === "x", "Use x.").safeParse("y");
    expect(zodMessage(refined.error!)).toBe("Use x.");
  });

  it("trocar o idioma do Zod não traz de volta as mensagens padrão", () => {
    const original = z.config().localeError;
    try {
      z.config(z.locales.pt());
      expect(zodMessage(z.string().min(3).safeParse("ab").error!)).toBe(GENERIC_INVALID);
      z.config(z.locales.en());
      expect(zodMessage(z.string().max(1).safeParse("ab").error!)).toBe(GENERIC_INVALID);
    } finally {
      z.config({ localeError: original });
    }
  });

  it("segunda proteção: texto padrão do Zod (inglês ou português) é filtrado mesmo sem a configuração global", () => {
    // O mapa de erros da própria validação tem precedência sobre a configuração global:
    // aqui ele devolve exatamente o texto padrão do idioma, como se a configuração tivesse sido trocada.
    for (const locale of [z.locales.en(), z.locales.pt()]) {
      const cases = [
        z.string().min(3).safeParse("ab", { error: locale.localeError }),
        z.string().max(2).safeParse("abc", { error: locale.localeError }),
        z.number().safeParse("1", { error: locale.localeError }),
        z.enum(["a", "b"]).safeParse("c", { error: locale.localeError }),
        z.email().safeParse("x", { error: locale.localeError }),
        z.object({ name: z.string() }).safeParse({}, { error: locale.localeError }),
      ];
      for (const result of cases) {
        expect(result.success).toBe(false);
        expect(result.error!.issues[0].message).not.toBe(GENERIC_INVALID);
        expect(zodMessage(result.error!), result.error!.issues[0].message).toBe(GENERIC_INVALID);
      }
    }
  });

  it("campos não permitidos continuam com a mensagem específica", () => {
    const result = z.object({ a: z.string() }).strict().safeParse({ a: "x", extra: 1 });
    expect(zodMessage(result.error!)).toBe("A requisição contém campos não permitidos.");
  });
});

describe("system.updateInstitution", () => {
  beforeEach(async () => {
    await resetEmulators();
    await seedStructure();
    await seedPeople();
  });

  it("razão social curta demais é recusada com mensagem em português (nada é gravado)", async () => {
    const before = await storedInstitution();
    const e = await expectCode(system("updateInstitution", "pres", { legalName: "AB" }), "invalid");
    expect(e.message).toBe("A razão social precisa ter pelo menos 3 caracteres.");
    expect(await storedInstitution()).toEqual(before);
    expect(await institutionAudits()).toHaveLength(0);
  });

  it("limites dos demais campos têm mensagens em português", async () => {
    const tooLong = (n: number) => "a".repeat(n + 1);
    const cases: [Partial<InstitutionSettings>, string][] = [
      [{ shortName: "A" }, "O nome curto precisa ter pelo menos 2 caracteres."],
      [{ legalName: tooLong(200) }, "A razão social pode ter no máximo 200 caracteres."],
      [{ shortName: tooLong(80) }, "O nome curto pode ter no máximo 80 caracteres."],
      [{ systemName: tooLong(60) }, "O nome do sistema pode ter no máximo 60 caracteres."],
      [{ course: tooLong(120) }, "O curso pode ter no máximo 120 caracteres."],
      [{ institution: tooLong(160) }, "A instituição de ensino pode ter no máximo 160 caracteres."],
      [{ city: tooLong(120) }, "A cidade pode ter no máximo 120 caracteres."],
      [{ email: `${tooLong(200)}@example.org` }, "O e-mail pode ter no máximo 200 caracteres."],
      [{ instagram: tooLong(60) }, "O Instagram pode ter no máximo 60 caracteres."],
      [{ motto: tooLong(120) }, "O lema pode ter no máximo 120 caracteres."],
    ];
    for (const [input, message] of cases) {
      const e = await expectCode(system("updateInstitution", "pres", input), "invalid");
      expect(e.message, JSON.stringify(Object.keys(input))).toBe(message);
      expect(e.message).not.toMatch(ZOD_DEFAULT);
    }
    // Tipo errado (sem mensagem própria no esquema): mensagem genérica, nunca o texto padrão do Zod.
    const wrongType = await expectCode(system("updateInstitution", "pres", { motto: 123 }), "invalid");
    expect(wrongType.message).toBe(GENERIC_INVALID);
  });

  it("grava e audita só os campos que mudaram", async () => {
    const current = defaultSystemSettings().institution;
    // O formulário envia tudo; só o lema mudou (e a cidade veio com espaços, que o servidor descarta).
    const res = await system<SystemSettings>("updateInstitution", "pres", { ...current, city: `  ${current.city}  `, motto: "#VemProYawara" });
    expect(res.institution).toEqual({ ...current, motto: "#VemProYawara" });
    expect(await storedInstitution()).toEqual({ ...current, motto: "#VemProYawara" });
    const audits = await institutionAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].summary).toBe("Dados institucionais alterados: lema");

    await system("updateInstitution", "pres", { legalName: "Associação Atlética Fictícia", shortName: "Atlética Fictícia" });
    const summaries = (await institutionAudits()).map((a) => a.summary);
    expect(summaries).toContain("Dados institucionais alterados: razão social, nome curto");
  });

  it("sem nenhuma mudança: não grava, não audita e devolve as configurações atuais", async () => {
    await db.doc("settings/system").update({ "institution.motto": "#Yawara" });
    const before = (await db.doc("settings/system").get()).updateTime;
    const current = await storedInstitution();
    const res = await system<SystemSettings>("updateInstitution", "pres", { ...current });
    expect(res.institution).toEqual(current);
    expect(res.modules).toEqual(defaultSystemSettings().modules);
    expect((await db.doc("settings/system").get()).updateTime?.isEqual(before!)).toBe(true);
    expect(await institutionAudits()).toHaveLength(0);
  });

  it("continua exigindo settings.edit", async () => {
    const e = await expectCode(system("updateInstitution", "evt", { motto: "#Teste" }), "forbidden");
    expect(e.message).toBe("Seu perfil não pode editar os dados institucionais.");
    expect((await storedInstitution()).motto).toBe("");
  });
});

describe("categorias: limite do nome em português", () => {
  beforeEach(async () => {
    await resetEmulators();
    await seedStructure();
    await seedPeople();
  });

  it("nome longo demais é recusado com mensagem própria", async () => {
    const e = await expectCode(system("createDocumentCategory", "pres", { name: "a".repeat(81) }), "invalid");
    expect(e.message).toBe("O nome da categoria pode ter no máximo 80 caracteres.");
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { requiredText } from "./validation";

/** Texto com cara de mensagem padrão do Zod (em inglês ou com detalhes técnicos). */
const ZOD_DEFAULT = /too (small|big)|expected|invalid input|characters|>=|<=/i;

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  expect(result.success).toBe(false);
  return result.error!.issues[0].message;
}

describe("validação no navegador: nenhuma mensagem padrão do Zod chega à tela", () => {
  it("limite de tamanho sem mensagem própria vira texto em português", () => {
    expect(firstMessage(z.string().trim().max(800).safeParse("a".repeat(801)))).toBe("Use no máximo 800 caracteres.");
    expect(firstMessage(z.string().min(3).safeParse("ab"))).toBe("Use pelo menos 3 caracteres.");
    expect(firstMessage(z.string().min(1).safeParse(""))).toBe("Preencha este campo.");
    expect(firstMessage(z.array(z.string()).min(2).safeParse(["a"]))).toBe("Escolha pelo menos 2 itens.");
    expect(firstMessage(z.array(z.string()).max(1).safeParse(["a", "b"]))).toBe("Escolha no máximo 1 item.");
  });

  it("demais casos sem mensagem própria recebem um aviso genérico em português", () => {
    for (const result of [z.enum(["a", "b"]).safeParse("c"), z.string().safeParse(1), z.object({ a: z.string() }).safeParse({})]) {
      const message = firstMessage(result);
      expect(message).toBe("Valor inválido. Revise este campo.");
      expect(message).not.toMatch(ZOD_DEFAULT);
    }
  });

  it("mensagens próprias dos esquemas continuam valendo", () => {
    expect(firstMessage(requiredText("o nome", 3).safeParse("ab"))).toBe("O nome precisa ter pelo menos 3 caracteres.");
    expect(firstMessage(z.string().max(2, "Curto demais.").safeParse("abc"))).toBe("Curto demais.");
  });
});

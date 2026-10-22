/**
 * Validações reutilizáveis (Zod) com mensagens em português.
 */
import { z } from "zod";
import { parseMoney } from "./format";

/*
 * As mensagens padrão do Zod são em inglês e técnicas ("Too big: expected
 * string to have <=800 characters"). Regras sem mensagem própria recebem um
 * texto em português. Vale para todo o aplicativo a partir do momento em que
 * este arquivo é carregado — todo formulário com esquema Zod o importa (as
 * telas de login e de convite têm mensagens próprias em todas as regras).
 */
z.config({
  customError: (issue) => {
    if (issue.code === "too_big" || issue.code === "too_small") {
      const big = issue.code === "too_big";
      const limit = Number(issue.code === "too_big" ? issue.maximum : issue.minimum);
      if (issue.origin === "string") {
        if (!big && limit <= 1) return "Preencha este campo.";
        return big ? `Use no máximo ${limit} caracteres.` : `Use pelo menos ${limit} caracteres.`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        const items = `${limit} ${limit === 1 ? "item" : "itens"}`;
        return big ? `Escolha no máximo ${items}.` : `Escolha pelo menos ${items}.`;
      }
    }
    return "Valor inválido. Revise este campo.";
  },
});

export const requiredText = (label: string, min = 2) =>
  z
    .string()
    .trim()
    .min(1, `Informe ${label}.`)
    .min(min, `${label[0].toUpperCase()}${label.slice(1)} precisa ter pelo menos ${min} caracteres.`);

export const optionalText = z.string().trim().optional().or(z.literal(""));

/** Valor monetário digitado ("1.234,56"). */
export const moneyField = (label = "o valor", { allowZero = false } = {}) =>
  z
    .string()
    .trim()
    .min(1, `Informe ${label}.`)
    .refine((v) => parseMoney(v) !== null, "Use apenas números, com até duas casas decimais (ex.: 10,00).")
    .refine((v) => allowZero || (parseMoney(v) ?? 0) > 0, "O valor deve ser maior que zero.");

export const optionalMoneyField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || parseMoney(v) !== null, "Use apenas números, com até duas casas decimais (ex.: 10,00).");

/** Número inteiro digitado em campo de texto. */
export const integerField = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Informe ${label}.`)
    .refine((v) => /^\d+$/.test(v), "Use apenas números inteiros, sem pontos ou vírgulas.")
    .refine((v) => Number(v) >= min && Number(v) <= max, `Escolha um valor entre ${min.toLocaleString("pt-BR")} e ${max.toLocaleString("pt-BR")}.`);

export const dateField = (label: string) => z.string().min(1, `Informe ${label}.`).regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
export const optionalDate = z.string().optional().or(z.literal(""));
export const timeField = (label: string) => z.string().min(1, `Informe ${label}.`).regex(/^\d{2}:\d{2}$/, "Horário inválido.");

export const contactField = z
  .string()
  .trim()
  .min(1, "Informe um contato.")
  .refine(
    (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || v.replace(/\D/g, "").length >= 8,
    "Informe um telefone com DDD ou um e-mail válido.",
  );

/** Contato que pode ficar em branco; quando preenchido, segue a mesma regra de `contactField`. */
export const optionalContactField = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || v.replace(/\D/g, "").length >= 8, "Informe um telefone com DDD ou um e-mail válido.");

export const audienceSchema = z
  .object({
    scope: z.enum(["department", "board", "directors", "directors_advisors", "all", "roles", "people"]),
    departmentId: z.string().optional(),
    roleIds: z.array(z.string()),
    userIds: z.array(z.string()),
  })
  .superRefine((a, ctx) => {
    // Erro no próprio objeto (sem `path`), para que o formulário consiga exibi-lo junto ao seletor.
    if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Escolha pelo menos um cargo." });
    if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Escolha pelo menos uma pessoa." });
  });

/** Primeira mensagem de erro de um campo de público (para exibir abaixo do seletor). */
export function audienceError(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { message?: string; roleIds?: { message?: string }; userIds?: { message?: string } };
  return e.roleIds?.message ?? e.userIds?.message ?? e.message;
}

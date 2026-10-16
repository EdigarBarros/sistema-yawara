/**
 * Erros de negócio com mensagens prontas (em português) para o usuário.
 *
 * As mensagens nunca incluem detalhes internos (pilha, caminhos, consultas,
 * dados de outros usuários). Erros inesperados viram uma mensagem genérica e
 * são registrados no log do servidor sem o conteúdo enviado pelo cliente.
 */
import { HttpsError, type FunctionsErrorCode } from "firebase-functions/https";
import { z, ZodError } from "zod";

export type AppErrorCode = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable" | "internal";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function fail(code: AppErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new AppError(code, message, details);
}

export function ensure(condition: unknown, code: AppErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) fail(code, message, details);
}

const HTTPS_CODE: Record<AppErrorCode, FunctionsErrorCode> = {
  unauthenticated: "unauthenticated",
  forbidden: "permission-denied",
  not_found: "not-found",
  conflict: "failed-precondition",
  invalid: "invalid-argument",
  unavailable: "unavailable",
  internal: "internal",
};

export const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente em instantes.";

/** Dados recusados pela validação quando o esquema não tem mensagem própria para o caso. */
export const INVALID_INPUT = "Alguns dados enviados são inválidos. Revise o formulário e tente novamente.";

/*
 * Mensagens padrão do Zod (em inglês e com detalhes técnicos, como "Too small:
 * expected string to have >=3 characters") nunca chegam ao usuário: só passam
 * as mensagens escritas nos esquemas. O `customError` global vale para toda
 * validação sem mensagem própria e tem precedência sobre o idioma do Zod
 * (`localeError`), então trocar o idioma não traz de volta os textos padrão.
 * (Não usamos `z.locales.pt()`: é português de Portugal e igualmente técnico.)
 */
z.config({ customError: () => INVALID_INPUT });

/**
 * Segunda proteção, caso a configuração acima seja trocada: textos padrão do
 * Zod em inglês e em português (`z.locales.pt`), e qualquer texto com
 * comparação técnica ("tivesse >= 3").
 */
const ZOD_DEFAULT_TEXT =
  /^(Invalid|Expected|Too (small|big)|Unrecognized|Required|Entrada inválida|Opção inválida|Demasiado (pequeno|grande)|Texto inválido|Número inválido|Chaves? inválidas?|Formato d.* inválido|Valor de discriminação inválido)\b|[<>]=?\s*\d/;

/** Primeira mensagem de validação do Zod (os esquemas usam mensagens em português). */
export function zodMessage(error: ZodError) {
  const issue = error.issues[0];
  if (issue?.code === "unrecognized_keys") return "A requisição contém campos não permitidos.";
  const message = issue?.message?.trim();
  return message && !ZOD_DEFAULT_TEXT.test(message) ? message : INVALID_INPUT;
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return new AppError("invalid", zodMessage(error));
  // Conflito de concorrência que esgotou as tentativas da transação.
  const code = (error as { code?: unknown })?.code;
  if (code === 10 || code === "aborted" || code === "ABORTED") {
    return new AppError("conflict", "Outra pessoa alterou estes dados ao mesmo tempo. Atualize a página e tente novamente.");
  }
  return new AppError("internal", GENERIC_ERROR);
}

export function toHttpsError(error: AppError) {
  return new HttpsError(HTTPS_CODE[error.code], error.message, { code: error.code, ...(error.details ?? {}) });
}

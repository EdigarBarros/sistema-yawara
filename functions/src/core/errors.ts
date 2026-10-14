/**
 * Erros de negócio com mensagens prontas (em português) para o usuário.
 *
 * As mensagens nunca incluem detalhes internos (pilha, caminhos, consultas,
 * dados de outros usuários). Erros inesperados viram uma mensagem genérica e
 * são registrados no log do servidor sem o conteúdo enviado pelo cliente.
 */
import { HttpsError, type FunctionsErrorCode } from "firebase-functions/https";
import { ZodError } from "zod";

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

/** Primeira mensagem de validação do Zod (os esquemas usam mensagens em português). */
export function zodMessage(error: ZodError) {
  const issue = error.issues[0];
  return issue?.message && !issue.message.startsWith("Invalid") && !issue.message.startsWith("Expected")
    ? issue.message
    : "Alguns dados enviados são inválidos. Revise o formulário e tente novamente.";
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

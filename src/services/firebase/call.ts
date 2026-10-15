/**
 * Chamadas às Cloud Functions.
 *
 * Toda operação de escrita leva um `requestId`. Se a conexão cair depois de o
 * servidor concluir a operação, o reenvio com o mesmo identificador não
 * duplica nada: o servidor devolve o resultado já registrado (ver
 * functions/src/core/dispatch.ts). O hook useAction reaproveita o
 * identificador ao repetir a mesma ação após uma falha de conexão.
 *
 * IMPORTANTE: nos serviços, chame `takeRequestId()` na PRIMEIRA linha do
 * método (antes de qualquer await).
 */
import { httpsCallable } from "firebase/functions";
import { ServiceError, type ServiceErrorCode } from "../errors";
import { firebase } from "./app";

export type ApiName = "auth" | "organization" | "system" | "campaigns" | "events" | "documents" | "meetings" | "finance" | "marketing" | "extension";

let ambientRequestId: string | null = null;

export function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Executa `fn` com o identificador de requisição informado (consumido de forma síncrona pelo serviço). */
export function withRequestId<T>(id: string, fn: () => T): T {
  ambientRequestId = id;
  try {
    return fn();
  } finally {
    ambientRequestId = null;
  }
}

export function takeRequestId() {
  const id = ambientRequestId ?? newRequestId();
  ambientRequestId = null;
  return id;
}

const GENERIC = "Não foi possível concluir a operação. Tente novamente em instantes.";

const CODE_FROM_FUNCTIONS: Record<string, ServiceErrorCode> = {
  "functions/unauthenticated": "unauthenticated",
  "functions/permission-denied": "forbidden",
  "functions/not-found": "not_found",
  "functions/failed-precondition": "conflict",
  "functions/already-exists": "conflict",
  "functions/aborted": "conflict",
  "functions/invalid-argument": "invalid",
  "functions/unavailable": "unavailable",
  "functions/deadline-exceeded": "unavailable",
  "functions/resource-exhausted": "unavailable",
};

export function mapFunctionsError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  // Verificação pelo código (não por `instanceof`, que é frágil nas classes de erro do SDK).
  const fnCode = (error as { code?: unknown } | null)?.code;
  if (typeof fnCode === "string" && fnCode.startsWith("functions/")) {
    const err = error as { details?: unknown; message?: string };
    const details = (err.details ?? {}) as { code?: ServiceErrorCode };
    const code = details.code ?? CODE_FROM_FUNCTIONS[fnCode] ?? "internal";
    if (code === "internal") return new ServiceError("internal", GENERIC);
    if (fnCode === "functions/unavailable" && !details.code) {
      return new ServiceError("unavailable", "Sem conexão com o servidor. Verifique a internet e tente novamente.");
    }
    // O SDK acrescenta o status HTTP ao fim da mensagem ("… [400]"): não é para o usuário.
    const message = (err.message ?? "").replace(/\s*\[\d{3}\]$/, "").trim();
    return new ServiceError(code, message || GENERIC, details);
  }
  return new ServiceError("internal", GENERIC);
}

/**
 * Remove campos `undefined` (recursivamente). O SDK de funções chamáveis
 * converteria `undefined` em `null`, que o servidor interpreta como "limpar o
 * campo" ou recusa. Convenção: campo ausente = não alterar; `null` explícito =
 * limpar.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v !== undefined) out[k] = stripUndefined(v);
    return out as T;
  }
  return value;
}

export async function callApi<T>(api: ApiName, action: string, payload: unknown = {}, requestId: string = newRequestId()): Promise<T> {
  const { functions } = firebase();
  const fn = httpsCallable<{ action: string; payload: unknown; requestId: string }, T>(functions, `${api}Api`, { timeout: 120_000 });
  try {
    const res = await fn({ action, payload: stripUndefined(payload), requestId });
    return res.data;
  } catch (error) {
    throw mapFunctionsError(error);
  }
}

/** Erros em que vale repetir a mesma requisição (falha de conexão ou indisponibilidade momentânea). */
export function isRetriable(error: unknown) {
  return error instanceof ServiceError && (error.code === "unavailable" || error.code === "internal");
}

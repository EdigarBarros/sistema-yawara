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
import { getToken } from "firebase/app-check";
import { httpsCallable } from "firebase/functions";
import { API_TRANSPORT } from "@/lib/mode";
import { ServiceError, type ServiceErrorCode } from "../errors";
import { firebase } from "./app";
import { settleUploads } from "@/stores/uploads";

export type ApiName = "auth" | "organization" | "system" | "campaigns" | "events" | "documents" | "meetings" | "finance" | "marketing" | "extension" | "sports";

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

const SERVER_CODES: ServiceErrorCode[] = ["unauthenticated", "forbidden", "not_found", "conflict", "invalid", "unavailable", "internal"];

/** Converte a resposta de erro da rota de API em ServiceError (mesmas regras de mapFunctionsError). */
export function mapRouteError(status: number, body: unknown): ServiceError {
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  const raw = typeof err?.code === "string" ? (err.code as ServiceErrorCode) : null;
  const code: ServiceErrorCode = raw && SERVER_CODES.includes(raw) ? raw : status === 401 ? "unauthenticated" : status >= 500 ? "unavailable" : "internal";
  if (code === "internal") return new ServiceError("internal", GENERIC);
  const message = typeof err?.message === "string" && err.message.trim() ? err.message.trim() : GENERIC;
  const details = err?.details && typeof err.details === "object" ? (err.details as Record<string, unknown>) : undefined;
  return new ServiceError(code, message, details);
}

/** Chamada à rota de API do aplicativo (implantação gratuita): token de login no cabeçalho. */
async function callRoute<T>(api: ApiName, body: { action: string; payload: unknown; requestId: string }): Promise<T> {
  const { auth, appCheck } = firebase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const user = auth.currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  if (appCheck) {
    try {
      headers["X-Firebase-AppCheck"] = (await getToken(appCheck, false)).token;
    } catch {
      // Sem token do App Check: o servidor decide (recusa só quando o exige).
    }
  }
  let res: Response;
  try {
    res = await fetch(`/api/${api}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  } catch {
    throw new ServiceError("unavailable", "Sem conexão com o servidor. Verifique a internet e tente novamente.");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Resposta sem JSON (ex.: falha da hospedagem): tratada abaixo.
  }
  if (res.ok && json && typeof json === "object" && "data" in json) return (json as { data: T }).data;
  throw mapRouteError(res.status, json);
}

/** `uploadId`/`uploadIds` citados na entrada (em qualquer nível): os envios que esta operação anexa. */
function uploadIdsIn(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 3) return [];
  return Object.entries(value).flatMap(([key, v]) =>
    key === "uploadId" && typeof v === "string" ? [v] : key === "uploadIds" && Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : uploadIdsIn(v, depth + 1),
  );
}

export async function callApi<T>(api: ApiName, action: string, payload: unknown = {}, requestId: string = newRequestId()): Promise<T> {
  const ids = uploadIdsIn(payload);
  if (!ids.length) return callApiRaw<T>(api, action, payload, requestId);
  // Envios em "verifying" terminam junto com a operação que os anexa (uploadChunk não os afeta: ainda estão "uploading").
  try {
    const result = await callApiRaw<T>(api, action, payload, requestId);
    settleUploads(ids, true);
    return result;
  } catch (error) {
    settleUploads(ids, false);
    throw error;
  }
}

async function callApiRaw<T>(api: ApiName, action: string, payload: unknown, requestId: string): Promise<T> {
  if (API_TRANSPORT === "route") return callRoute<T>(api, { action, payload: stripUndefined(payload), requestId });
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

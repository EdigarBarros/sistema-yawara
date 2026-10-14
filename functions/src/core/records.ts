/**
 * Convenções de armazenamento e conversão de registros.
 *
 *  - Datas e horários de negócio são gravados como texto ISO 8601 em UTC,
 *    gerados pelo relógio do servidor (ex.: "2026-10-14T18:32:00.000Z").
 *    Datas sem horário seguem "yyyy-mm-dd". Isso mantém o formato idêntico ao
 *    dos tipos do aplicativo e permite ordenar consultas.
 *  - Campos técnicos usados por regras de segurança ou TTL (`expireAt`,
 *    `expiresAt` de tíquetes) são Timestamps do Firestore.
 *  - Campos internos (marcadores de público, termos de busca) não fazem parte
 *    dos tipos do aplicativo e são removidos antes de responder.
 */
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { fail } from "./errors";

/** Campos que só existem no Firestore (segurança, busca, TTL). */
export const INTERNAL_FIELDS = ["readers", "editors", "terms", "expireAt", "searchable"] as const;

export function stripInternal<T extends Record<string, unknown>>(data: T): T {
  const copy = { ...data };
  for (const key of INTERNAL_FIELDS) delete (copy as Record<string, unknown>)[key];
  return copy;
}

/** Converte Timestamps (caso existam) em texto ISO, recursivamente. */
export function timestampsToISO<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function" && "seconds" in (value as object)) {
    return (value as unknown as { toDate(): Date }).toDate().toISOString() as unknown as T;
  }
  if (Array.isArray(value)) return value.map(timestampsToISO) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = timestampsToISO(v);
    return out as T;
  }
  return value;
}

/** Dados do documento + id, sem campos internos, no formato dos tipos do aplicativo. */
export function toDTO<T>(snap: DocumentSnapshot): T {
  return timestampsToISO(stripInternal({ ...(snap.data() as Record<string, unknown>), id: snap.id })) as T;
}

export function requireDoc(snap: DocumentSnapshot, label: string): DocumentSnapshot {
  if (!snap.exists) fail("not_found", `${label} não encontrado(a). Pode ter sido removido(a) ou não estar disponível para o seu perfil.`);
  return snap;
}

/** Remove chaves com valor undefined (útil antes de comparar objetos). */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

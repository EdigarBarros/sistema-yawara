/**
 * Conversão dos documentos do Firestore para os tipos do aplicativo.
 * Datas de negócio já são texto ISO; Timestamps técnicos viram texto ISO.
 */
import type { DocumentSnapshot } from "firebase/firestore";
import { ServiceError } from "../errors";

const INTERNAL_FIELDS = ["readers", "editors", "terms", "expireAt", "searchable"];

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

export function fromSnap<T>(snap: DocumentSnapshot): T {
  const data = { ...(snap.data() as Record<string, unknown>) };
  for (const key of INTERNAL_FIELDS) delete data[key];
  return timestampsToISO({ ...data, id: snap.id }) as T;
}

/**
 * Código de um erro do SDK do Firebase (ex.: "permission-denied",
 * "functions/invalid-argument"). Não use `instanceof FirestoreError`: o SDK
 * fixa o protótipo na classe base, e a verificação sempre falha.
 */
export function firebaseErrorCode(error: unknown): string | null {
  if (error instanceof ServiceError) return null;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/** Converte erros de leitura do Firestore em mensagens para o usuário. */
export function mapFirestoreError(error: unknown, notAllowed = "Este registro não está disponível para o seu perfil."): ServiceError {
  if (error instanceof ServiceError) return error;
  const code = firebaseErrorCode(error);
  if (code) {
    if (code === "permission-denied") return new ServiceError("forbidden", notAllowed);
    if (code === "unauthenticated") return new ServiceError("unauthenticated", "Sua sessão expirou. Entre novamente.");
    if (code === "unavailable") return new ServiceError("unavailable", "Sem conexão com o banco de dados. Verifique a internet e tente novamente.");
    if (code === "not-found") return new ServiceError("not_found", "Registro não encontrado.");
    // Índice ausente ou consulta inválida: problema de configuração, não do usuário.
    console.error("[Firestore]", code, (error as { message?: string }).message);
  }
  return new ServiceError("internal", "Não foi possível carregar os dados agora. Tente novamente.");
}

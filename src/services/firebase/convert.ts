/**
 * Conversão dos documentos do Firestore para os tipos do aplicativo.
 * Datas de negócio já são texto ISO; Timestamps técnicos viram texto ISO.
 */
import { FirestoreError, type DocumentSnapshot } from "firebase/firestore";
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

/** Converte erros de leitura do Firestore em mensagens para o usuário. */
export function mapFirestoreError(error: unknown, notAllowed = "Este registro não está disponível para o seu perfil."): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof FirestoreError) {
    if (error.code === "permission-denied") return new ServiceError("forbidden", notAllowed);
    if (error.code === "unauthenticated") return new ServiceError("unauthenticated", "Sua sessão expirou. Entre novamente.");
    if (error.code === "unavailable") return new ServiceError("unavailable", "Sem conexão com o banco de dados. Verifique a internet e tente novamente.");
    if (error.code === "not-found") return new ServiceError("not_found", "Registro não encontrado.");
    // Índice ausente ou consulta inválida: problema de configuração, não do usuário.
    console.error("[Firestore]", error.code, error.message);
  }
  return new ServiceError("internal", "Não foi possível carregar os dados agora. Tente novamente.");
}

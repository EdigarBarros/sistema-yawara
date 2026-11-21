/**
 * Consultas compatíveis com as regras de segurança.
 *
 * Coleções com público por registro (campanhas, eventos, documentos,
 * reuniões, conteúdos, projetos) só podem ser listadas com o filtro
 * `readers array-contains-any <marcadores do usuário>` — ou sem filtro, para
 * quem tem `<módulo>.admin`. As regras recusam qualquer outra consulta.
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";
import type { ModuleKey } from "@/types";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { fromSnap, mapFirestoreError } from "./convert";
import { hasPerm, whenAccess } from "./session";
import { callApi } from "./call";
import { getViewAs } from "@/stores/session";

/** Limite por listagem. Volumes maiores devem usar paginação por cursor (ver docs/backend/arquitetura.md). */
export const LIST_LIMIT = 500;

/** Coleções com público por registro que o servidor lê no "ver como" (functions/src/modules/system.ts). */
const VIEW_AS_COLLECTIONS = new Set(["campaigns", "events", "documents", "meetings", "contents", "projects", "sportsTeams"]);

/**
 * "Ver como" da conta de suporte: as regras do Firestore comparam o público com
 * quem está logado (o suporte), não com a pessoa vista. Por isso a leitura vai
 * pelo servidor, que aplica a mesma regra com a pessoa vista.
 */
async function viewAsRead<T>(collectionName: string, id?: string): Promise<T[]> {
  const { items } = await callApi<{ items: T[] }>("system", "viewAsRead", id ? { collection: collectionName, id } : { collection: collectionName });
  return items;
}

export async function listVisible<T>(collectionName: string, module: ModuleKey, extra: QueryConstraint[] = [], max = LIST_LIMIT): Promise<T[]> {
  if (getViewAs() && VIEW_AS_COLLECTIONS.has(collectionName) && extra.length === 0) return viewAsRead<T>(collectionName);
  const access = await whenAccess();
  if (!hasPerm(access, `${module}.view`)) return [];
  const { db } = firebase();
  const base = collection(db, collectionName);
  const constraints: QueryConstraint[] = hasPerm(access, `${module}.admin`)
    ? [...extra, orderBy("updatedAt", "desc"), limit(max)]
    : [where("readers", "array-contains-any", access.tokens.slice(0, 30)), ...extra, orderBy("updatedAt", "desc"), limit(max)];
  try {
    const snap = await getDocs(query(base, ...constraints));
    return snap.docs.map((d) => fromSnap<T>(d));
  } catch (error) {
    throw mapFirestoreError(error);
  }
}

/** Lê um documento; recusa com mensagem clara quando não existe ou não é permitido. */
export async function getVisible<T>(path: string, label: string): Promise<T> {
  const [collectionName, id, ...rest] = path.split("/");
  if (getViewAs() && VIEW_AS_COLLECTIONS.has(collectionName) && id && rest.length === 0) {
    try {
      const [item] = await viewAsRead<T>(collectionName, id);
      return item;
    } catch (error) {
      if (error instanceof ServiceError && error.code === "forbidden") throw new ServiceError("forbidden", `${label} não está disponível para o perfil desta pessoa.`);
      throw error;
    }
  }
  const { db } = firebase();
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) throw new ServiceError("not_found", `${label} não encontrado(a). Pode ter sido removido(a) ou não estar disponível para o seu perfil.`);
    return fromSnap<T>(snap);
  } catch (error) {
    throw mapFirestoreError(error, `${label} não está disponível para o seu perfil.`);
  }
}

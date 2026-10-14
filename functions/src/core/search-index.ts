/**
 * ÍNDICE DE BUSCA GLOBAL
 * ---------------------------------------------------------------------------
 * O Firestore não tem busca textual. Em vez de adicionar um serviço externo,
 * cada registro pesquisável mantém uma entrada em `searchIndex/{kind}__{id}`
 * com termos normalizados (sem acento, minúsculos, com prefixos) e o mesmo
 * público (`readers`) do registro. A entrada é gravada na mesma transação da
 * criação/edição.
 *
 * A busca é feita pela função `systemApi.search`, que consulta o índice e
 * filtra pelo acesso efetivo de quem pesquisa — o índice nunca é lido
 * diretamente pelo navegador, e a busca não revela registros ocultos.
 */
import type { Transaction } from "firebase-admin/firestore";
import type { SearchResultKind } from "@/types";
import { db } from "./admin";

export { normalizeText, termsFor, words } from "@/lib/search-terms";
import { termsFor } from "@/lib/search-terms";

export type { SearchIndexEntry as SearchEntry } from "@/lib/search-entries";
import type { SearchIndexEntry as SearchEntry } from "@/lib/search-entries";
export { searchEntryFor } from "@/lib/search-entries";

export function searchRef(kind: SearchResultKind, id: string) {
  return db.doc(`searchIndex/${kind}__${id}`);
}

/** Grava/atualiza a entrada (chame na fase de escrita da transação). */
export function indexRecord(tx: Transaction, entry: SearchEntry) {
  tx.set(searchRef(entry.kind, entry.id), {
    kind: entry.kind,
    module: entry.module,
    recordId: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    href: entry.href,
    at: entry.at,
    readers: entry.readers,
    archived: !!entry.archived,
    terms: termsFor([entry.title, ...entry.text]),
  });
}

export function unindexRecord(tx: Transaction, kind: SearchResultKind, id: string) {
  tx.delete(searchRef(kind, id));
}

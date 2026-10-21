/**
 * BUSCA GLOBAL (systemApi.search)
 * ---------------------------------------------------------------------------
 * Consulta o índice `searchIndex` (gravado pelos módulos na mesma transação
 * de cada criação/edição — ver core/search-index.ts) e devolve somente o que
 * quem pesquisa pode abrir:
 *
 *  - o módulo do registro está ativo nas configurações;
 *  - a pessoa tem `<módulo>.view`;
 *  - e tem `<módulo>.admin` OU pertence ao público do registro (`readers`).
 *    Lançamentos financeiros (readers = ["all"]) exigem `finance.view`.
 *
 * O índice nunca é lido pelo navegador (as regras negam), e a resposta leva
 * apenas título, subtítulo, link e data — nunca `readers` ou termos.
 *
 * Termos: palavras normalizadas (sem acento, minúsculas) e seus prefixos até
 * 14 caracteres (src/lib/search-terms.ts). A consulta usa a palavra mais longa
 * da busca (a mais seletiva) em `array-contains`; as demais palavras são
 * conferidas aqui, como prefixo dos termos do registro.
 */
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { intersects } from "@/lib/access-tokens";
import { words } from "@/lib/search-terms";
import type { ModuleKey, Permission, SearchResult, SearchResultKind, SystemSettings } from "@/types";
import { db } from "../core/admin";
import type { Actor } from "../core/actor";
import { query } from "../core/dispatch";

/** Tamanho máximo dos prefixos indexados (igual a src/lib/search-terms.ts). */
const MAX_PREFIX = 14;
/** Entradas lidas por página do índice e número máximo de páginas por busca. */
const PAGE_SIZE = 200;
const MAX_PAGES = 3;
export const MAX_SEARCH_RESULTS = 60;
const MAX_WORDS = 8;

/** Módulo de cada tipo de registro (não depende do campo gravado na entrada). */
const KIND_MODULE: Record<SearchResultKind, ModuleKey> = {
  campaign: "campaigns",
  event: "events",
  document: "documents",
  meeting: "meetings",
  finance: "finance",
  project: "extension",
  content: "marketing",
  team: "sports",
};

interface StoredEntry {
  kind?: unknown;
  recordId?: unknown;
  title?: unknown;
  subtitle?: unknown;
  href?: unknown;
  at?: unknown;
  readers?: unknown;
  terms?: unknown;
}

/** Palavras da busca, sem repetição (no máximo 8). */
export function queryWords(text: string) {
  return [...new Set(words(text))].slice(0, MAX_WORDS);
}

/** Cada palavra da busca precisa ser prefixo de algum termo do registro. */
export function matchesAllWords(terms: readonly string[], ws: readonly string[]) {
  return ws.every((w) => (w.length <= MAX_PREFIX ? terms.includes(w) : terms.some((t) => t.startsWith(w))));
}

/** Quem pesquisa pode abrir este registro? */
export function canSeeEntry(actor: Actor, settings: Pick<SystemSettings, "modules"> | undefined, kind: SearchResultKind, readers: readonly string[]) {
  const moduleKey = KIND_MODULE[kind];
  if (!moduleKey) return false;
  if (settings?.modules?.[moduleKey] === false) return false;
  if (!actor.can(`${moduleKey}.view` as Permission)) return false;
  // Lançamentos: o acesso é pela permissão do Financeiro (readers = ["all"]).
  if (kind === "finance") return actor.can("finance.view");
  if (actor.can(`${moduleKey}.admin` as Permission)) return true;
  return intersects(actor.tokens, readers);
}

function toResult(data: StoredEntry): SearchResult | null {
  const kind = data.kind as SearchResultKind;
  if (typeof kind !== "string" || !(kind in KIND_MODULE)) return null;
  if (typeof data.recordId !== "string" || typeof data.title !== "string" || typeof data.href !== "string") return null;
  return {
    id: data.recordId,
    kind,
    title: data.title,
    subtitle: typeof data.subtitle === "string" ? data.subtitle : "",
    href: data.href,
    at: typeof data.at === "string" ? data.at : undefined,
  };
}

const searchSchema = z
  .object({
    query: z.string("Informe o texto da busca.").max(200, "A busca pode ter no máximo 200 caracteres."),
  })
  .strict();

export const searchActions = {
  search: query({
    module: "system",
    schema: searchSchema,
    async run(actor, input): Promise<SearchResult[]> {
      actor = actor!;
      const ws = queryWords(input.query);
      if (ws.length === 0) return [];
      // A palavra mais longa é a mais seletiva (prefixos acima de 14 letras não são indexados).
      const key = ws.reduce((a, b) => (b.length > a.length ? b : a)).slice(0, MAX_PREFIX);

      const settings = (await db.doc("settings/system").get()).data() as SystemSettings | undefined;
      const results: SearchResult[] = [];
      let cursor: QueryDocumentSnapshot | undefined;

      for (let page = 0; page < MAX_PAGES && results.length < MAX_SEARCH_RESULTS; page++) {
        let q: Query = db.collection("searchIndex").where("terms", "array-contains", key).orderBy("at", "desc").limit(PAGE_SIZE);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        for (const doc of snap.docs) {
          const data = doc.data() as StoredEntry;
          const terms = Array.isArray(data.terms) ? (data.terms as string[]) : [];
          const readers = Array.isArray(data.readers) ? (data.readers as string[]) : [];
          if (!matchesAllWords(terms, ws)) continue;
          if (!canSeeEntry(actor, settings, data.kind as SearchResultKind, readers)) continue;
          const result = toResult(data);
          if (result) results.push(result);
          if (results.length >= MAX_SEARCH_RESULTS) break;
        }
        if (snap.size < PAGE_SIZE) break;
        cursor = snap.docs[snap.docs.length - 1];
      }
      return results;
    },
  }),
};

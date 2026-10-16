import type { SearchResult } from "@/types";
import type { SearchService } from "../contracts";
import { callApi } from "./call";

/**
 * Busca global: feita pelo servidor (`systemApi.search`), que consulta o
 * índice de busca e devolve só o que o perfil pode abrir. O índice nunca é
 * lido diretamente pelo navegador.
 */
export const firebaseSearch: SearchService = {
  async search(query) {
    const q = query.trim();
    if (q.length < 2) return [];
    return callApi<SearchResult[]>("system", "search", { query: q.slice(0, 200) });
  },
};

/**
 * "Banco" local da demonstração.
 *
 * Os dados ficam em memória e são salvos no localStorage deste navegador.
 * Eles NÃO são compartilhados entre pessoas ou dispositivos: cada navegador
 * tem a sua própria cópia. Na Etapa 2, esta camada é substituída pelo
 * Cloud Firestore.
 */
import { buildSeed, DEMO_DB_VERSION, type DemoDB } from "@/data/demo/seed";

const STORAGE_KEY = "central-yawara:demo-db";

let db: DemoDB | null = null;

function canUseStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function load(): DemoDB {
  if (canUseStorage()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoDB;
        if (parsed.version === DEMO_DB_VERSION) return parsed;
      }
    } catch {
      // Dados corrompidos ou de outra versão: recria a demonstração.
    }
  }
  const fresh = buildSeed();
  persist(fresh);
  return fresh;
}

function persist(value: DemoDB) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Armazenamento cheio ou bloqueado: a demonstração continua em memória.
  }
}

export function getDB(): DemoDB {
  if (!db) db = load();
  return db;
}

/**
 * Aplica uma alteração e salva. Toda escrita passa por aqui.
 * A alteração é feita numa cópia: se a operação falhar no meio (validação,
 * permissão), nada é gravado — como uma transação.
 */
export function commit<T>(mutate: (db: DemoDB) => T): T {
  const draft = structuredClone(getDB());
  const result = mutate(draft);
  db = draft;
  persist(draft);
  return result;
}

export function resetDB() {
  db = buildSeed();
  persist(db);
}

/** Usado nos testes automatizados. */
export function setDBForTests(value: DemoDB) {
  db = value;
}

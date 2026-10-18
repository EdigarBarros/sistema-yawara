/**
 * Modo de dados da aplicação.
 *
 * - "demo": dados fictícios guardados apenas neste navegador (desenvolvimento,
 *   apresentações e testes). Nada é enviado ao Firebase.
 * - "firebase": dados reais no Firebase (Authentication, Firestore, Storage e
 *   Cloud Functions).
 *
 * Definido em tempo de build por NEXT_PUBLIC_DATA_SOURCE. Os dois modos nunca
 * se misturam: o modo demonstração não lê nem grava no Firebase.
 */
export type AppMode = "demo" | "firebase";

export const APP_MODE: AppMode = process.env.NEXT_PUBLIC_DATA_SOURCE === "firebase" ? "firebase" : "demo";

export const isDemoMode = APP_MODE === "demo";
export const isFirebaseMode = APP_MODE === "firebase";

/**
 * Onde rodam as operações do servidor no modo "firebase":
 * - "route" (padrão, implantação gratuita): rota de API do próprio aplicativo
 *   (src/app/api/[api]/route.ts), com o Firebase no plano gratuito (Spark).
 * - "functions": Cloud Functions (exige o plano Blaze).
 */
export const API_TRANSPORT: "route" | "functions" = process.env.NEXT_PUBLIC_API_TRANSPORT === "functions" ? "functions" : "route";

/**
 * Como os arquivos (documentos, comprovantes, artes) são guardados:
 * - "links" (padrão, implantação gratuita): a pessoa informa o link do arquivo
 *   (Google Drive, OneDrive…); a Central guarda só o nome e o link.
 * - "database" (implantação gratuita): o arquivo é enviado e guardado em
 *   pedaços no próprio Firestore, com limites menores (até 8 MB, sem vídeo).
 *   Links continuam aceitos como alternativa.
 * - "storage": envio para o Cloud Storage (exige o plano Blaze).
 * No modo demonstração os arquivos ficam no navegador, como antes.
 */
const FILE_STORAGE_MODES = ["links", "database", "storage"] as const;
export const FILE_STORAGE: (typeof FILE_STORAGE_MODES)[number] =
  FILE_STORAGE_MODES.find((m) => m === process.env.NEXT_PUBLIC_FILE_STORAGE) ?? "links";

/** Arquivos guardados no próprio banco (só no modo Firebase). */
export const usesFileDatabase = isFirebaseMode && FILE_STORAGE === "database";

/**
 * Limite por arquivo em MB, por finalidade (o mesmo do servidor:
 * functions/src/core/files.ts). No banco os limites são menores.
 */
export const FILE_LIMIT_MB = usesFileDatabase
  ? { document: 8, saleReceipt: 4, financeReceipt: 4, marketingFile: 8 }
  : { document: 25, saleReceipt: 10, financeReceipt: 15, marketingFile: 50 };

/** Arquivos como links (só no modo Firebase). */
export const usesFileLinks = isFirebaseMode && FILE_STORAGE === "links";

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
 * - "storage": envio para o Cloud Storage (exige o plano Blaze).
 * No modo demonstração os arquivos ficam no navegador, como antes.
 */
export const FILE_STORAGE: "links" | "storage" = process.env.NEXT_PUBLIC_FILE_STORAGE === "storage" ? "storage" : "links";

/** Arquivos como links (só no modo Firebase). */
export const usesFileLinks = isFirebaseMode && FILE_STORAGE === "links";

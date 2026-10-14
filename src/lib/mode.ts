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

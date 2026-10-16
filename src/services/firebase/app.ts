/**
 * Inicialização do Firebase no navegador (somente no modo "firebase").
 *
 * Usa apenas a configuração pública do app web (NEXT_PUBLIC_*). Nenhuma
 * credencial administrativa é usada aqui: a segurança vem das regras do
 * Firestore/Storage, do servidor (rota de API ou Cloud Functions) e do App Check.
 */
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { FILE_STORAGE } from "@/lib/mode";
import { ServiceError } from "../errors";

// Cada variável precisa ser referenciada de forma literal para o Next.js incorporá-la ao build.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const REGION = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "southamerica-east1";
const RECAPTCHA_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
export const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
const EMULATOR_HOST = process.env.NEXT_PUBLIC_EMULATOR_HOST || "127.0.0.1";

export interface FirebaseClients {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
  /** Presente quando o App Check está configurado (chave do reCAPTCHA). */
  appCheck: AppCheck | null;
}

let clients: FirebaseClients | null = null;

export function isFirebaseConfigured() {
  // O bucket só é exigido quando os arquivos vão para o Cloud Storage (plano Blaze).
  return !!(config.apiKey && config.projectId && config.appId && (FILE_STORAGE === "links" || config.storageBucket));
}

/** Clientes do Firebase (inicialização preguiçosa, apenas no navegador). */
export function firebase(): FirebaseClients {
  if (clients) return clients;
  if (typeof window === "undefined") throw new ServiceError("unavailable", "O Firebase só é usado no navegador.");
  if (!isFirebaseConfigured()) {
    throw new ServiceError("unavailable", "O Firebase não está configurado neste ambiente. Preencha as variáveis NEXT_PUBLIC_FIREBASE_* (ver .env.example).");
  }
  const app = getApps()[0] ?? initializeApp(config);
  const appCheck =
    RECAPTCHA_KEY && !USE_EMULATORS ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_KEY), isTokenAutoRefreshEnabled: true }) : null;
  const auth = getAuth(app);
  auth.languageCode = "pt-BR";
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  const storage = getStorage(app);
  const functions = getFunctions(app, REGION);
  if (USE_EMULATORS) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
    connectStorageEmulator(storage, EMULATOR_HOST, 9199);
    connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
  }
  clients = { app, auth, db, storage, functions, appCheck };
  return clients;
}

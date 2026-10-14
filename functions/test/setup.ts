/**
 * Ambiente dos testes: Firebase Emulator Suite (projeto "demo-*", que nunca
 * acessa recursos reais). Os emuladores são iniciados por
 * `npm run test:functions` na raiz do repositório.
 */
const PROJECT = "demo-yawara";
process.env.GCLOUD_PROJECT = PROJECT;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` });
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
process.env.STORAGE_EMULATOR_HOST ??= "http://127.0.0.1:9199";

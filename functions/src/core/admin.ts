/**
 * Inicialização do Admin SDK (somente no servidor).
 *
 * Credenciais:
 *  - Cloud Functions: conta de serviço padrão do projeto (nada a configurar).
 *  - Rota de API do aplicativo (implantação gratuita): variáveis de ambiente
 *    SOMENTE do servidor — FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e
 *    FIREBASE_PRIVATE_KEY (da chave da conta de serviço). Nunca use prefixo
 *    NEXT_PUBLIC_ nelas e nunca as versione.
 *  - Emuladores: só o id do projeto (GCLOUD_PROJECT / FIREBASE_PROJECT_ID).
 * Nenhuma chave privada é guardada no código ou no repositório.
 *
 * ATENÇÃO: o Admin SDK ignora as regras de segurança do Firestore e do
 * Storage. Por isso toda operação feita aqui verifica identidade, permissões
 * e regras de negócio por conta própria (ver core/dispatch.ts e core/actor.ts).
 */
import { cert, getApps, initializeApp, type AppOptions } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { AppError } from "./errors";

/** Região das funções — deve coincidir com NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION. */
export const REGION = "southamerica-east1";

function appOptions(): AppOptions | undefined {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || undefined;
  if (projectId && clientEmail && privateKey) {
    // Painéis de hospedagem costumam guardar as quebras de linha da chave como "\n".
    return { credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") }), projectId, storageBucket };
  }
  // Cloud Functions e `firebase emulators:exec` definem FIREBASE_CONFIG (projeto e bucket): o SDK lê sozinho.
  if (process.env.FIREBASE_CONFIG) return undefined;
  // Outros ambientes com emuladores: só o projeto (e o bucket, se houver).
  return projectId ? { projectId, storageBucket } : undefined;
}

if (getApps().length === 0) initializeApp(appOptions());

export const db = getFirestore();
// Campos opcionais com valor undefined são simplesmente omitidos. (Uma única
// vez por processo: o servidor de desenvolvimento recarrega este módulo.)
const SETTINGS_FLAG = Symbol.for("central-yawara.firestore-settings");
const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
if (!holder[SETTINGS_FLAG]) {
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Já em uso com a mesma configuração (ex.: scripts/bootstrap.ts --senha reaproveita este módulo).
  }
  holder[SETTINGS_FLAG] = true;
}

export const adminAuth = getAuth();

/**
 * Bucket do Cloud Storage. Na implantação gratuita (sem Storage, que exige o
 * plano Blaze) os arquivos são links ou ficam no banco e esta função não é usada; se for, a
 * operação é recusada com uma mensagem clara.
 */
export function bucket() {
  if (process.env.FILE_STORAGE === "links" || process.env.FILE_STORAGE === "database" || process.env.FILE_STORAGE === "drive") {
    throw new AppError("unavailable", "O envio de arquivos não está ativo nesta instalação. Informe um link para o arquivo.");
  }
  return getStorage().bucket();
}

export { FieldValue, Timestamp };

/** Horário do servidor em ISO 8601 (UTC). Nunca usamos o horário enviado pelo navegador. */
export function nowISO() {
  return new Date().toISOString();
}

/** Timestamp do servidor deslocado em dias (para validade e TTL). */
export function timestampInDays(days: number) {
  return Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
}

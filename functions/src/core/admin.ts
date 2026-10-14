/**
 * Inicialização do Admin SDK (somente no servidor).
 *
 * As credenciais vêm do ambiente das Cloud Functions (conta de serviço padrão
 * do projeto). Nenhuma chave privada é guardada no código ou no repositório.
 *
 * ATENÇÃO: o Admin SDK ignora as regras de segurança do Firestore e do
 * Storage. Por isso toda operação feita aqui verifica identidade, permissões
 * e regras de negócio por conta própria (ver core/dispatch.ts e core/actor.ts).
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/** Região das funções — deve coincidir com NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION. */
export const REGION = "southamerica-east1";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
// Campos opcionais com valor undefined são simplesmente omitidos.
db.settings({ ignoreUndefinedProperties: true });

export const adminAuth = getAuth();

export function bucket() {
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

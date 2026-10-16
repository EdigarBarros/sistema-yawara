/**
 * Parâmetros configuráveis por projeto (functions/.env.<projeto>).
 * Ver functions/.env.example.
 */
import { defineBoolean, defineInt, defineString } from "firebase-functions/params";

export const APP_BASE_URL = defineString("APP_BASE_URL", {
  default: "http://localhost:3000",
  description: "Endereço público do aplicativo, usado nos links de convite.",
});

export const ENFORCE_APP_CHECK = defineBoolean("ENFORCE_APP_CHECK", {
  default: false,
  description: "Exigir App Check nas funções chamáveis.",
});

export const INVITE_TTL_DAYS = defineInt("INVITE_TTL_DAYS", { default: 7, description: "Validade dos convites, em dias." });

export const AUDIT_RETENTION_DAYS = defineInt("AUDIT_RETENTION_DAYS", {
  default: 1825,
  description: "Retenção dos registros de auditoria, em dias.",
});

/** Lê um parâmetro numérico com valor padrão seguro (fora do runtime, ex.: testes). */
export function intParam(param: { value(): number }, fallback: number) {
  try {
    const v = param.value();
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function stringParam(param: { value(): string }, fallback: string) {
  try {
    return param.value() || fallback;
  } catch {
    return fallback;
  }
}

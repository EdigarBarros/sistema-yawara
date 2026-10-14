"use client";

import { toast } from "sonner";
import { ServiceError } from "@/services";

/** Mensagem de sucesso: só deve ser chamada depois que a operação realmente aconteceu. */
export function notifySuccess(message: string, description?: string) {
  toast.success(message, { description });
}

export function notifyInfo(message: string, description?: string) {
  toast(message, { description });
}

export function notifyError(error: unknown, fallback = "Não foi possível concluir a operação.") {
  const message = error instanceof ServiceError ? error.message : error instanceof Error && error.message ? error.message : fallback;
  toast.error(message);
}

export function errorMessage(error: unknown, fallback = "Algo deu errado.") {
  if (error instanceof ServiceError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

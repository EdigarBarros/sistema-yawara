"use client";

import { useMutation } from "@tanstack/react-query";
import { notifyError, notifySuccess } from "@/lib/notify";

interface ActionOptions<TResult> {
  /** Mensagem exibida apenas quando a operação foi concluída de fato. */
  success?: string | ((result: TResult) => string);
  successDescription?: string | ((result: TResult) => string | undefined);
  onSuccess?: (result: TResult) => void;
  /** Não mostrar toast de erro (o formulário exibe o erro). */
  silentError?: boolean;
}

/**
 * Executa uma operação de escrita na camada de serviços.
 * Ao concluir, todas as consultas são atualizadas (ver QueryProvider).
 */
export function useAction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Promise<TResult>, options: ActionOptions<TResult> = {}) {
  const mutation = useMutation({
    mutationFn: (args: TArgs) => fn(...args),
  });

  async function run(...args: TArgs): Promise<TResult> {
    try {
      const result = await mutation.mutateAsync(args);
      if (options.success) {
        const msg = typeof options.success === "function" ? options.success(result) : options.success;
        const desc = typeof options.successDescription === "function" ? options.successDescription(result) : options.successDescription;
        notifySuccess(msg, desc);
      }
      options.onSuccess?.(result);
      return result;
    } catch (error) {
      if (!options.silentError) notifyError(error);
      throw error;
    }
  }

  /** Igual a `run`, mas nunca lança erro (retorna undefined em caso de falha). */
  async function runSafe(...args: TArgs): Promise<TResult | undefined> {
    try {
      return await run(...args);
    } catch {
      return undefined;
    }
  }

  return { run, runSafe, pending: mutation.isPending, error: mutation.error, reset: mutation.reset };
}

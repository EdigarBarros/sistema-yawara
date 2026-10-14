"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { notifyError, notifySuccess } from "@/lib/notify";
import { isRetriable, newRequestId, withRequestId } from "@/services/firebase/call";

interface ActionOptions<TResult> {
  /** Mensagem exibida apenas quando a operação foi concluída de fato. */
  success?: string | ((result: TResult) => string);
  successDescription?: string | ((result: TResult) => string | undefined);
  onSuccess?: (result: TResult) => void;
  /** Não mostrar toast de erro (o formulário exibe o erro). */
  silentError?: boolean;
}

/** Chave estável dos argumentos (arquivos entram por nome, tamanho e data). */
function argsKey(args: unknown[]) {
  try {
    return JSON.stringify(args, (_k, v) => (typeof File !== "undefined" && v instanceof File ? { file: v.name, size: v.size, mod: v.lastModified } : v));
  } catch {
    return String(Math.random());
  }
}

/**
 * Executa uma operação de escrita na camada de serviços.
 * Ao concluir, todas as consultas são atualizadas (ver QueryProvider).
 *
 * Reenvio seguro: cada operação leva um identificador de requisição. Se ela
 * falhar por conexão e for repetida com os MESMOS dados, o identificador é
 * reaproveitado — o servidor reconhece a repetição e não duplica nada.
 */
export function useAction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Promise<TResult>, options: ActionOptions<TResult> = {}) {
  const pending = useRef<{ key: string; id: string } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ args, requestId }: { args: TArgs; requestId: string }) => withRequestId(requestId, () => fn(...args)),
  });

  async function run(...args: TArgs): Promise<TResult> {
    const key = argsKey(args);
    const requestId = pending.current?.key === key ? pending.current.id : newRequestId();
    pending.current = { key, id: requestId };
    try {
      const result = await mutation.mutateAsync({ args, requestId });
      pending.current = null;
      if (options.success) {
        const msg = typeof options.success === "function" ? options.success(result) : options.success;
        const desc = typeof options.successDescription === "function" ? options.successDescription(result) : options.successDescription;
        notifySuccess(msg, desc);
      }
      options.onSuccess?.(result);
      return result;
    } catch (error) {
      if (!isRetriable(error)) pending.current = null;
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

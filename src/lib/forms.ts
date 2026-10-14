"use client";

import { get, type FieldValues, type Path, type RegisterOptions, type UseFormReturn } from "react-hook-form";

/**
 * `register` que revalida o campo enquanto a pessoa digita, mas só quando ele
 * já está com erro — a mensagem some assim que o problema é corrigido, sem
 * mostrar erros antes da hora (e sem "pular" o layout no clique seguinte).
 */
export function liveRegister<T extends FieldValues>(form: UseFormReturn<T>) {
  return (name: Path<T>, options?: RegisterOptions<T, Path<T>>) =>
    form.register(name, {
      ...options,
      onChange: (event: unknown) => {
        options?.onChange?.(event);
        if (get(form.formState.errors, name)) void form.trigger(name);
      },
    });
}

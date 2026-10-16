import { ServiceError } from "../errors";

/** Serviço ainda não conectado ao Firebase (usado apenas durante a implementação). */
export function pendingService<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return () => Promise.reject(new ServiceError("unavailable", `${name}: integração com o Firebase em implementação.`));
    },
  });
}

/**
 * Erro com mensagem pronta para ser exibida ao usuário — usado pelos dois
 * modos de dados (demonstração e Firebase).
 */
export type ServiceErrorCode = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable" | "internal";

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

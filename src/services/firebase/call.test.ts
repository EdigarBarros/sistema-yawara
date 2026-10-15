import { FirestoreError } from "firebase/firestore";
import { FunctionsError } from "firebase/functions";
import { describe, expect, it } from "vitest";
import { ServiceError } from "../errors";
import { mapFunctionsError, stripUndefined } from "./call";
import { firebaseErrorCode, mapFirestoreError } from "./convert";

describe("stripUndefined", () => {
  it("remove campos undefined e mantém null explícito", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: null, d: { e: undefined, f: "x" }, g: [{ h: undefined, i: 2 }] })).toEqual({
      a: 1,
      c: null,
      d: { f: "x" },
      g: [{ i: 2 }],
    });
  });
});

describe("mapFunctionsError", () => {
  it("usa o código do servidor e remove o status HTTP que o SDK acrescenta à mensagem", () => {
    const err = new FunctionsError("invalid-argument", "O arquivo é inválido. [400]", { code: "invalid" });
    const mapped = mapFunctionsError(err);
    expect(mapped).toBeInstanceOf(ServiceError);
    expect(mapped.code).toBe("invalid");
    expect(mapped.message).toBe("O arquivo é inválido.");
  });

  it("recusa de permissão vira 'forbidden' com a mensagem do servidor", () => {
    const mapped = mapFunctionsError(new FunctionsError("permission-denied", "Seu perfil não pode fazer isso. [403]"));
    expect(mapped.code).toBe("forbidden");
    expect(mapped.message).toBe("Seu perfil não pode fazer isso.");
  });

  it("erro interno nunca expõe a mensagem original", () => {
    const mapped = mapFunctionsError(new FunctionsError("internal", "stack trace… [500]"));
    expect(mapped.code).toBe("internal");
    expect(mapped.message).not.toContain("stack");
  });
});

// O construtor é privado nos tipos do SDK, mas é a mesma classe que o SDK lança em tempo de execução.
const FirestoreErrorCtor = FirestoreError as unknown as new (code: string, message: string) => Error;

describe("mapFirestoreError", () => {
  it("reconhece erros reais do SDK (instanceof FirestoreError falha no SDK)", () => {
    const err = new FirestoreErrorCtor("permission-denied", "Missing or insufficient permissions.");
    expect(firebaseErrorCode(err)).toBe("permission-denied");
    const mapped = mapFirestoreError(err, "Evento não está disponível para o seu perfil.");
    expect(mapped.code).toBe("forbidden");
    expect(mapped.message).toBe("Evento não está disponível para o seu perfil.");
  });

  it("sem conexão e sessão expirada têm mensagens próprias", () => {
    expect(mapFirestoreError(new FirestoreErrorCtor("unavailable", "x")).code).toBe("unavailable");
    expect(mapFirestoreError(new FirestoreErrorCtor("unauthenticated", "x")).code).toBe("unauthenticated");
  });

  it("mantém ServiceError e trata erros desconhecidos como internos", () => {
    const own = new ServiceError("not_found", "Registro não encontrado.");
    expect(mapFirestoreError(own)).toBe(own);
    expect(mapFirestoreError(new Error("boom")).code).toBe("internal");
  });
});

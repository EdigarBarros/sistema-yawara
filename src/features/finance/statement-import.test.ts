import { describe, expect, it } from "vitest";
import { entryDescription, entryNotes, parseBrMoney, parseStatement } from "./statement-import";

const CSV = `﻿Data;Hora;Onde;Descrição;Tipo;Valor;Categoria
01/09/2026;04:07;Conta principal;Rendimento;Entrada;0,04;Movimento interno (entre conta, caixinhas e CDB)
09/09/2026;13:11;Conta principal;Rebeca Laize;Saída;-50,00;Despesa
09/09/2026;22:09;Conta principal;Danilo N Barbosa;Entrada;5,00;Recebimento
11/09/2026;15:45;Caixinha Atlética Yawara;Recebido da conta principal;Entrada;150,00;Movimento interno (entre conta, caixinhas e CDB)
15/09/2026;11:35;Conta principal;Leila Joelma;Entrada;1.100,00;Recebimento
16/09/2026;11:32;Caixinha Atlética Yawara;Kalunga;Saída;-45,50;Despesa
32/09/2026;11:32;Conta principal;Data errada;Saída;-1,00;Despesa
`;

describe("parseStatement", () => {
  const { rows, problems } = parseStatement(CSV);

  it("separa receitas, despesas e movimentos internos", () => {
    expect(rows.filter((r) => r.kind === "income").map((r) => r.amount)).toEqual([500, 110000]);
    expect(rows.filter((r) => r.kind === "expense").map((r) => r.amount)).toEqual([5000, 4550]);
    expect(rows.filter((r) => r.kind === "internal")).toHaveLength(2);
  });

  it("lê data e onde", () => {
    const k = rows.find((r) => r.name === "Kalunga")!;
    expect(k.date).toBe("2026-09-16");
    expect(k.where).toBe("Caixinha Atlética Yawara");
  });

  it("aponta linhas inválidas sem parar a leitura", () => {
    expect(problems).toEqual([{ line: 8, reason: "Data inválida" }]);
  });

  it("gera chaves estáveis e distintas (mesmo arquivo → mesmas chaves)", () => {
    const again = parseStatement(CSV).rows.map((r) => r.key);
    expect(again).toEqual(rows.map((r) => r.key));
    expect(new Set(again).size).toBe(again.length);
    expect(rows[0].key).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
  });

  it("linhas idênticas viram lançamentos diferentes", () => {
    const dup = parseStatement("Data;Descrição;Valor\n01/10/2026;Fulana;5,00\n01/10/2026;Fulana;5,00").rows;
    expect(dup).toHaveLength(2);
    expect(dup[0].key).not.toBe(dup[1].key);
  });

  it("monta descrição e observação", () => {
    const k = rows.find((r) => r.name === "Kalunga")!;
    expect(entryDescription(k)).toBe("Pix enviado · Kalunga");
    expect(entryNotes(k, "extrato da InfinitePay")).toBe("Importado do extrato da InfinitePay (Caixinha Atlética Yawara), 16/09/2026 às 11:32.");
  });

  it("recusa arquivo sem as colunas obrigatórias", () => {
    expect(parseStatement("Nome;Coisa\nA;B").problems[0].reason).toMatch(/Data, Descrição e Valor/);
  });
});

describe("parseBrMoney", () => {
  it("entende o formato brasileiro", () => {
    expect(parseBrMoney("-1.234,56")).toBe(-123456);
    expect(parseBrMoney("R$ 5,00")).toBe(500);
    expect(parseBrMoney("12,5")).toBe(1250);
    expect(parseBrMoney("abc")).toBeNull();
  });
});

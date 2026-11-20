/**
 * Leitura de extrato bancário em CSV (formato da planilha da InfinitePay):
 *   Data;Hora;Onde;Descrição;Tipo;Valor;Categoria
 *   17/09/2026;11:30;Conta principal;Fulana de Tal;Entrada;25,00;Recebimento
 *
 * - Separador ";" (também aceita "," e tabulação), valores no formato brasileiro.
 * - O sinal do valor (ou a coluna Tipo) decide receita/despesa.
 * - Movimentos internos (entre conta, caixinhas e aplicação) ficam de fora:
 *   o dinheiro só muda de lugar, não entra nem sai da Atlética.
 * - Cada linha ganha uma chave estável (data, hora, onde, descrição, valor):
 *   importar o mesmo extrato de novo não duplica lançamentos.
 */

export type StatementKind = "income" | "expense" | "internal";

export interface StatementRow {
  /** Linha no arquivo (1 = cabeçalho). */
  line: number;
  key: string;
  date: string; // AAAA-MM-DD
  time: string;
  where: string;
  name: string;
  kind: StatementKind;
  /** Centavos, sempre positivo. */
  amount: number;
}

export interface StatementParse {
  rows: StatementRow[];
  /** Linhas que não puderam ser lidas (com o motivo). */
  problems: { line: number; reason: string }[];
}

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function splitLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** "1.234,56" / "-50,00" / "R$ 5,00" → centavos com sinal. */
export function parseBrMoney(raw: string): number | null {
  const s = raw.replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!/^[-+]?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^[-+]?\d+(,\d{1,2})?$|^[-+]?\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "17/09/2026" → "2026-09-17". */
function parseBrDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Hash curto e estável (FNV-1a de 64 bits em duas metades), sem depender de crypto. */
function stableHash(text: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

const INTERNAL_HINTS = ["movimento interno", "interno", "caixinha", "cdb", "rendimento", "resgate", "aplicacao", "guardado na", "tirado da", "recebido da conta principal", "devolvido para a conta"];

export function isInternal(category: string, name: string) {
  const c = norm(category);
  if (c.startsWith("movimento interno") || c === "interno") return true;
  if (c === "recebimento" || c === "despesa" || c.startsWith("atletica")) return false;
  const n = norm(name);
  return INTERNAL_HINTS.some((h) => n.includes(h));
}

export function parseStatement(text: string): StatementParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines[0] ?? "";
  const sep = [";", "\t", ","].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const cols = splitLine(header, sep).map(norm);
  const col = (...names: string[]) => cols.findIndex((c) => names.includes(c));
  const iDate = col("data");
  const iTime = col("hora");
  const iWhere = col("onde", "conta");
  const iDesc = col("descricao", "nome", "historico");
  const iType = col("tipo");
  const iValue = col("valor");
  const iCat = col("categoria", "de quem e");
  const problems: StatementParse["problems"] = [];
  if (iDate < 0 || iDesc < 0 || iValue < 0) {
    return { rows: [], problems: [{ line: 1, reason: "O arquivo precisa das colunas Data, Descrição e Valor." }] };
  }

  const rows: StatementRow[] = [];
  const seen = new Map<string, number>();
  lines.slice(1).forEach((raw, idx) => {
    const line = idx + 2;
    if (!raw.trim()) return;
    const c = splitLine(raw, sep);
    const date = parseBrDate(c[iDate] ?? "");
    const signed = parseBrMoney(c[iValue] ?? "");
    const name = (c[iDesc] ?? "").trim();
    if (!date) return problems.push({ line, reason: "Data inválida" });
    if (signed === null || signed === 0) return problems.push({ line, reason: "Valor inválido" });
    if (!name) return problems.push({ line, reason: "Sem descrição" });
    const typeText = iType >= 0 ? norm(c[iType] ?? "") : "";
    const outgoing = signed < 0 || typeText.startsWith("saida");
    const time = iTime >= 0 ? (c[iTime] ?? "") : "";
    const where = iWhere >= 0 ? (c[iWhere] ?? "") : "";
    const category = iCat >= 0 ? (c[iCat] ?? "") : "";
    const kind: StatementKind = isInternal(category, name) ? "internal" : outgoing ? "expense" : "income";
    const base = [date, time, norm(where), norm(name), signed].join("|");
    // Duas linhas idênticas (mesma hora, mesmo valor) continuam sendo dois lançamentos.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({ line, key: `ext-${stableHash(`${base}|${n}`)}`, date, time, where, name, kind, amount: Math.abs(signed) });
  });
  return { rows, problems };
}

/** Descrição do lançamento a partir da linha do extrato (3 a 200 caracteres). */
export function entryDescription(row: StatementRow) {
  const text = `${row.kind === "income" ? "Pix recebido" : "Pix enviado"} · ${row.name}`;
  return text.slice(0, 200);
}

/** Observação que diz de onde veio o lançamento. */
export function entryNotes(row: StatementRow, source = "extrato") {
  const [y, m, d] = row.date.split("-");
  const when = `${d}/${m}/${y}${row.time ? ` às ${row.time}` : ""}`;
  return `Importado do ${source}${row.where ? ` (${row.where})` : ""}, ${when}.`.slice(0, 500);
}

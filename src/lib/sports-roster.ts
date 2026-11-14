/**
 * ELENCO EM LOTE
 * ---------------------------------------------------------------------------
 * "Adicionar vários": a pessoa cola a lista do grupo do time (um nome por
 * linha) e a Central separa nome e número da camisa. As mesmas regras valem na
 * tela (prévia), no servidor e no modo demonstração.
 */
import type { Athlete } from "@/types";

/** Quantos atletas podem entrar de uma vez. */
export const MAX_ROSTER_BATCH = 60;

export interface RosterLine {
  name: string;
  number?: string;
}

const clean = (v: string) => v.normalize("NFC").replace(/\s+/g, " ").trim();
const nameKey = (v: string) => clean(v).toLocaleLowerCase("pt-BR");

/**
 * Lê uma linha: "10 Ana Souza", "10 - Ana", "Ana Souza (10)", "Ana - 10".
 * "1. Ana" e "1) Ana" são numeração da lista (não a camisa) e são ignorados,
 * assim como marcadores ("-", "•", "*") e emojis no começo.
 */
export function parseRosterLine(raw: string): RosterLine | null {
  let line = clean(raw.replace(/[‍️]/g, ""));
  line = line.replace(/^[\p{Extended_Pictographic}\s]+/u, "");
  line = line.replace(/^[-–—•*·]+\s*/, "");
  line = line.replace(/^\d{1,3}\s*[.)º°]\s*/, "");
  let number: string | undefined;
  const lead = /^(\d{1,4})\s*[-–—:]?\s+(.+)$/.exec(line);
  const trail = /^(.+?)\s*(?:[-–—:]\s*|\(\s*)(\d{1,4})\s*\)?$/.exec(line);
  if (lead) {
    number = String(Number(lead[1]));
    line = lead[2];
  } else if (trail) {
    number = String(Number(trail[2]));
    line = trail[1];
  }
  const name = clean(line.replace(/[-–—:,;]+$/, ""));
  if (name.length < 2 || !/\p{L}/u.test(name)) return null;
  return { name: name.slice(0, 120), number };
}

export function parseRosterText(text: string): RosterLine[] {
  return text
    .split(/\r?\n/)
    .map(parseRosterLine)
    .filter((l): l is RosterLine => l !== null);
}

export interface RosterPlan {
  /** Entram no elenco (camisa removida se já tinha dono). */
  add: RosterLine[];
  /** Nomes que já estavam no elenco ou repetidos na lista. */
  duplicates: string[];
  /** Nomes que entram sem número porque a camisa já era de alguém. */
  numberTaken: string[];
}

/** O que acontece ao juntar a lista colada com o elenco atual. */
export function planRosterAdd(current: Pick<Athlete, "name" | "number">[], lines: RosterLine[]): RosterPlan {
  const names = new Set(current.map((a) => nameKey(a.name)));
  const numbers = new Set(current.map((a) => a.number).filter((n): n is string => !!n));
  const plan: RosterPlan = { add: [], duplicates: [], numberTaken: [] };
  for (const line of lines) {
    const key = nameKey(line.name);
    if (names.has(key)) {
      plan.duplicates.push(line.name);
      continue;
    }
    names.add(key);
    let number = line.number;
    if (number && numbers.has(number)) {
      plan.numberTaken.push(line.name);
      number = undefined;
    }
    if (number) numbers.add(number);
    plan.add.push(number ? { name: line.name, number } : { name: line.name });
  }
  return plan;
}

/** Ordem do elenco: pela camisa e, sem camisa, pelo nome. */
export function byShirt(a: Pick<Athlete, "name" | "number">, b: Pick<Athlete, "name" | "number">) {
  return Number(a.number ?? 9999) - Number(b.number ?? 9999) || a.name.localeCompare(b.name, "pt-BR");
}

/** Como o atleta aparece na prancheta e nos cartões: o apelido ou o primeiro nome. */
export function shortName(a: Pick<Athlete, "name" | "nickname">) {
  return a.nickname?.trim() || a.name.split(" ")[0];
}

/**
 * Termos de busca normalizados (sem acento, minúsculos, com prefixos), usados
 * pelo índice de busca global mantido no servidor.
 */
const MAX_TERMS = 400;
const MAX_PREFIX = 14;

export function normalizeText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Palavras com pelo menos 2 caracteres, sem acento. */
export function words(text: string) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

/** Cada palavra e seus prefixos (busca "conforme digita"). */
export function termsFor(parts: (string | undefined | null)[]) {
  const set = new Set<string>();
  outer: for (const part of parts) {
    if (!part) continue;
    for (const w of words(part)) {
      for (let i = 2; i <= Math.min(w.length, MAX_PREFIX); i++) set.add(w.slice(0, i));
      set.add(w);
      if (set.size >= MAX_TERMS) break outer;
    }
  }
  return [...set].slice(0, MAX_TERMS);
}

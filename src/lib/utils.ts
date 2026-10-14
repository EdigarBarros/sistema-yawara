import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Gera um identificador curto e único para registros criados na demonstração. */
export function newId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${random}`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Remove acentos e caixa para comparações de busca. */
export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesQuery(query: string, ...fields: (string | undefined | null)[]) {
  const q = normalize(query);
  if (!q) return true;
  const haystack = normalize(fields.filter(Boolean).join(" "));
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function sortBy<T>(items: T[], key: (item: T) => string | number, dir: "asc" | "desc" = "asc") {
  const factor = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1 * factor;
    if (ka > kb) return 1 * factor;
    return 0;
  });
}

export function uniq<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

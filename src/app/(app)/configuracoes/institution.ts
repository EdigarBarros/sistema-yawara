import type { InstitutionSettings } from "@/types";

/** Campos dos dados institucionais, na ordem da tela. */
export const INSTITUTION_FIELDS: { key: keyof InstitutionSettings; label: string; wide?: boolean }[] = [
  { key: "legalName", label: "Razão social / nome completo", wide: true },
  { key: "shortName", label: "Nome curto" },
  { key: "systemName", label: "Nome do sistema" },
  { key: "course", label: "Curso" },
  { key: "institution", label: "Instituição de ensino" },
  { key: "city", label: "Cidade" },
  { key: "email", label: "E-mail de contato" },
  { key: "instagram", label: "Instagram" },
  { key: "motto", label: "Lema / hashtag" },
];

/**
 * Só os campos que de fato mudaram (comparados sem os espaços das pontas, como
 * faz o servidor). São os únicos enviados, para que a auditoria registre
 * exatamente o que foi alterado. Vazio = nada para salvar.
 */
export function changedInstitutionFields(current: Partial<InstitutionSettings>, form: Partial<InstitutionSettings> | null): Partial<InstitutionSettings> {
  const changes: Partial<InstitutionSettings> = {};
  if (!form) return changes;
  for (const { key } of INSTITUTION_FIELDS) {
    const next = form[key];
    if (next !== undefined && next.trim() !== (current[key] ?? "").trim()) changes[key] = next;
  }
  return changes;
}

import type { AuditLogEntry, ModuleKey } from "@/types";
import { MODULE_MAP } from "@/lib/modules";

export function moduleLabel(module: AuditLogEntry["module"]) {
  if (module === "auth") return "Acesso e contas";
  return MODULE_MAP[module as ModuleKey]?.label ?? module;
}

/** Nomes legíveis dos tipos de registro. */
export const RESOURCE_LABELS: Record<string, string> = {
  campaign: "Campanha",
  sale: "Venda",
  event: "Evento",
  document: "Documento",
  meeting: "Reunião",
  financeEntry: "Lançamento",
  financeReport: "Relatório financeiro",
  content: "Conteúdo",
  project: "Projeto",
  member: "Integrante",
  role: "Cargo",
  department: "Departamento",
  invitation: "Convite",
  settings: "Configurações",
  documentCategory: "Categoria de documento",
  financeCategory: "Categoria financeira",
  session: "Sessão",
  // Operação recusada antes de identificar o registro.
  operation: "Operação",
};

/**
 * Rótulo da coluna "Registro". Tipo desconhecido (ex.: recusas antigas, que
 * gravavam o nome interno da API, como "campaigns") mostra o nome do módulo,
 * nunca o identificador técnico.
 */
export function resourceLabel(entry: Pick<AuditLogEntry, "resourceType" | "module">) {
  return RESOURCE_LABELS[entry.resourceType] ?? moduleLabel(entry.module);
}

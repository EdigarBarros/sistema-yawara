import type { ReactNode } from "react";
import type { ModuleKey } from "@/types";
import { NAV } from "@/components/layout/nav";
import { MODULE_MAP } from "@/lib/modules";
import { isDemoMode } from "@/lib/mode";

const ROUTES = NAV.flatMap((g) => g.items).flatMap((item) => (item.module ? [{ href: item.href, module: item.module }] : []));

/** Módulo da rota atual, pelo menu (ex.: "/financeiro/relatorios" → "finance"). */
export function moduleForPath(pathname: string | null | undefined): ModuleKey | null {
  if (!pathname) return null;
  return ROUTES.find((r) => pathname === r.href || pathname.startsWith(`${r.href}/`))?.module ?? null;
}

/** Aviso de módulo desativado nas Configurações (não é falta de permissão). */
export function disabledModuleNotice(module: ModuleKey) {
  return {
    title: "Módulo desativado",
    description: `O módulo ${MODULE_MAP[module].label} foi desativado nas Configurações. Os dados foram mantidos e voltam quando o módulo for reativado.`,
  };
}

/**
 * Texto de "área não disponível". Se o módulo da área estiver desativado nas
 * Configurações, diz isso (e não que falta permissão ao cargo); senão, usa o
 * texto informado pela tela ou o padrão do modo (demonstração ou real).
 */
export function restrictedNotice({
  module,
  moduleEnabled,
  title = "Área não disponível para este perfil",
  description,
}: {
  module: ModuleKey | null;
  moduleEnabled: (m: ModuleKey) => boolean;
  title?: string;
  description?: ReactNode;
}): { title: string; description: ReactNode; disabled: boolean } {
  if (module && !moduleEnabled(module)) return { ...disabledModuleNotice(module), disabled: true };
  return {
    title,
    description:
      description ??
      (isDemoMode
        ? "O perfil de demonstração em uso não tem permissão para esta área. Troque de perfil no topo da tela para experimentar outras visões."
        : "Seu cargo não tem permissão para esta área. Se precisar de acesso, fale com a presidência."),
    disabled: false,
  };
}

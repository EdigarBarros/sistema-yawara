/**
 * SUPORTE DO SISTEMA
 * ---------------------------------------------------------------------------
 * Cargo acima da Presidência, para quem mantém a Central (suporte técnico).
 * Tem todas as permissões e o alcance da Presidência, e é protegido: somente
 * quem está no próprio cargo de suporte pode alterar a conta ou o cargo de
 * suporte, ou atribuí-lo a alguém. A Presidência continua administrando todo
 * o resto normalmente.
 *
 * O cargo não faz parte da estrutura padrão: é criado pelo script
 * scripts/support.ts, que também move a conta escolhida para ele.
 */
import type { ID, Role } from "@/types";
import { allPermissions } from "./modules";

export const SUPPORT_ROLE_ID = "suporte";

export const LOCK_SUPPORT = "O Suporte do sistema só pode ser alterado ou atribuído por quem está no próprio cargo de suporte.";

export function isSupportRole(roleId: ID | null | undefined) {
  return roleId === SUPPORT_ROLE_ID;
}

/** Definição do cargo (sem datas), usada pelo script que o cria. */
export function supportRoleDefinition(): Omit<Role, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "Suporte do sistema",
    description: "Manutenção técnica da Central. Acima da Presidência; só pode ser alterado pelo próprio suporte.",
    departmentId: "presidencia",
    level: "presidency",
    isBoard: true,
    active: true,
    homePreset: "presidency",
    permissions: [...allPermissions()].sort(),
  };
}

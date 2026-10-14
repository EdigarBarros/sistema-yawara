"use client";

import { useMemo } from "react";
import type { Audience, ID, ModuleKey, Permission } from "@/types";
import { canViewModule, hasPermission, matchesAudience, ownershipOf, type AccessContext } from "@/lib/permissions";
import { useSession } from "@/stores/session";
import { useDirectory, useSettings } from "./use-data";

/**
 * Perfil demonstrativo em uso + funções de permissão SIMULADAS para decidir
 * o que mostrar. Não é segurança: ver src/lib/permissions.ts.
 */
export function useAccess() {
  const userId = useSession((s) => s.userId);
  const dir = useDirectory();
  const { data: settings } = useSettings();

  return useMemo(() => {
    const user = dir.member(userId ?? undefined);
    const role = user ? dir.role(user.roleId) : undefined;
    const ctx: AccessContext | null = user && role ? { user, role, department: dir.department(role.departmentId) } : null;
    const moduleEnabled = (m: ModuleKey) => settings?.modules[m] ?? true;
    return {
      ready: !dir.loading && !!settings,
      ctx,
      user,
      role,
      department: ctx?.department,
      can: (p: Permission) => hasPermission(ctx, p),
      canModule: (m: ModuleKey) => moduleEnabled(m) && canViewModule(ctx, m),
      moduleEnabled,
      inAudience: (a: Audience, fallbackDepartmentId?: ID) => (ctx ? matchesAudience(ctx, a, fallbackDepartmentId) : false),
      ownership: (record: { createdBy: ID; departmentId?: ID }) => (ctx ? ownershipOf(ctx, record) : "shared"),
    };
  }, [userId, dir, settings]);
}

export type Access = ReturnType<typeof useAccess>;

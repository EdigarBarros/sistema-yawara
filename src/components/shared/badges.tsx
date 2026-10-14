"use client";

import { Building2, Share2, UserRound } from "lucide-react";
import type { ID } from "@/types";
import { Badge } from "@/components/ui/misc";
import type { StatusMeta } from "@/lib/labels";
import { useAccess } from "@/hooks/use-access";

export function StatusBadge({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

/** Diferencia o que é do usuário/departamento do que foi compartilhado por outros setores. */
export function OwnershipBadge({ record }: { record: { createdBy: ID; departmentId?: ID } }) {
  const access = useAccess();
  const kind = access.ownership(record);
  if (kind === "mine")
    return (
      <Badge tone="gold" icon={<UserRound />}>
        Criado por você
      </Badge>
    );
  if (kind === "department")
    return (
      <Badge tone="neutral" icon={<Building2 />}>
        Seu departamento
      </Badge>
    );
  return (
    <Badge tone="info" icon={<Share2 />}>
      Compartilhado com você
    </Badge>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <Badge tone="neutral" className={className}>
      Exemplo
    </Badge>
  );
}

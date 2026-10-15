"use client";

import { useMemo, useState } from "react";
import { Building2, Globe2, ShieldCheck, UserCheck, Users, UsersRound } from "lucide-react";
import type { Audience, AudienceScope, ID, Member, ModuleKey, Permission } from "@/types";
import { useDirectory } from "@/hooks/use-data";
import { AUDIENCE_SCOPE_HINTS, AUDIENCE_SCOPE_LABELS } from "@/lib/labels";
import { hasPermission, matchesAudience } from "@/lib/permissions";
import { ChoiceCards } from "@/components/ui/form";
import { Avatar } from "@/components/ui/misc";
import { MemberMultiPicker, RoleMultiPicker } from "./pickers";

const ICONS: Record<AudienceScope, React.ReactNode> = {
  department: <Building2 className="size-3.5 text-fg-subtle" />,
  board: <ShieldCheck className="size-3.5 text-fg-subtle" />,
  directors: <ShieldCheck className="size-3.5 text-fg-subtle" />,
  directors_advisors: <UsersRound className="size-3.5 text-fg-subtle" />,
  all: <Globe2 className="size-3.5 text-fg-subtle" />,
  roles: <Users className="size-3.5 text-fg-subtle" />,
  people: <UserCheck className="size-3.5 text-fg-subtle" />,
};

interface AudiencePickerProps {
  name: string;
  value: Audience;
  onChange: (value: Audience) => void;
  scopes: AudienceScope[];
  /** Rótulos específicos do contexto (ex.: "Todos os integrantes autorizados"). */
  labels?: Partial<Record<AudienceScope, string>>;
  /** Descrições específicas do contexto. */
  hints?: Partial<Record<AudienceScope, string>>;
  /** Departamento usado quando o escopo é "Meu departamento". */
  departmentId?: ID;
  error?: string;
}

/**
 * Seletor de público reutilizado em rifas, eventos, documentos e reuniões.
 * Os campos extras aparecem só quando necessários (cargos ou pessoas).
 */
export function AudiencePicker({ name, value, onChange, scopes, labels, hints, departmentId, error }: AudiencePickerProps) {
  const set = (patch: Partial<Audience>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <ChoiceCards
        name={name}
        value={value.scope}
        onChange={(scope) => set({ scope, departmentId: scope === "department" ? departmentId : undefined })}
        options={scopes.map((s) => ({
          value: s,
          label: labels?.[s] ?? AUDIENCE_SCOPE_LABELS[s],
          description: hints?.[s] ?? AUDIENCE_SCOPE_HINTS[s],
          icon: ICONS[s],
        }))}
      />
      {value.scope === "roles" && (
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-fg-muted">Quais cargos?</p>
          <RoleMultiPicker value={value.roleIds} onChange={(roleIds) => set({ roleIds })} invalid={!!error} />
        </div>
      )}
      {value.scope === "people" && (
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-fg-muted">Quais pessoas?</p>
          <MemberMultiPicker value={value.userIds} onChange={(userIds) => set({ userIds })} invalid={!!error} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface AudienceMembersOptions {
  departmentId?: ID;
  alwaysIncluded?: ID[];
  /**
   * Módulo do registro. Quando informado, só conta quem pode abrir o módulo
   * (`<módulo>.view`) — estar no público não basta — e inclui quem administra
   * o módulo (vê todos os registros), como fazem as regras do servidor.
   */
  module?: ModuleKey;
  /** Permissão adicional exigida (ex.: "campaigns.register" para registrar vendas). */
  need?: Permission;
}

/** Lista de integrantes ativos que terão acesso ao registro com o público informado. */
export function useAudienceMembers(audience: Audience, extra: AudienceMembersOptions = {}) {
  const dir = useDirectory();
  const { departmentId, alwaysIncluded, module, need } = extra;
  return useMemo(() => {
    const result: Member[] = [];
    for (const m of dir.activeMembers) {
      const role = dir.role(m.roleId);
      if (!role) continue;
      const ctx = { user: m, role, department: dir.department(role.departmentId) };
      if (module && !hasPermission(ctx, `${module}.view` as Permission)) continue;
      if (need && !hasPermission(ctx, need)) continue;
      const admin = !!module && hasPermission(ctx, `${module}.admin` as Permission);
      if (admin || matchesAudience(ctx, audience, departmentId) || alwaysIncluded?.includes(m.id)) result.push(m);
    }
    return result;
  }, [dir, audience, departmentId, alwaysIncluded, module, need]);
}

export function describeAudience(audience: Audience, dir: ReturnType<typeof useDirectory>, labels?: Partial<Record<AudienceScope, string>>) {
  const base = labels?.[audience.scope] ?? AUDIENCE_SCOPE_LABELS[audience.scope];
  if (audience.scope === "roles") {
    const names = audience.roleIds.map((id) => dir.role(id)?.name).filter(Boolean);
    return names.length ? `${base}: ${names.join(", ")}` : base;
  }
  if (audience.scope === "people") {
    const names = audience.userIds.map((id) => dir.memberName(id));
    return names.length ? `${base}: ${names.join(", ")}` : base;
  }
  if (audience.scope === "department" && audience.departmentId) {
    return `Departamento: ${dir.department(audience.departmentId)?.name ?? "—"}`;
  }
  return base;
}

/** Mostra de forma clara quem terá acesso, com a contagem de pessoas. */
export function AudienceSummary({
  audience,
  departmentId,
  alwaysIncluded,
  labels,
  title,
  module,
  need,
}: {
  audience: Audience;
  departmentId?: ID;
  alwaysIncluded?: ID[];
  labels?: Partial<Record<AudienceScope, string>>;
  title?: string;
  module?: ModuleKey;
  need?: Permission;
}) {
  const dir = useDirectory();
  const members = useAudienceMembers(audience, { departmentId, alwaysIncluded, module, need });
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[13px]">
      {title && <p className="eyebrow mb-1.5">{title}</p>}
      <p className="font-medium text-fg">{describeAudience(audience, dir, labels)}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[12.5px] text-gold-fg hover:underline" aria-expanded={open}>
        {members.length === 1 ? "1 pessoa terá acesso" : `${members.length} pessoas terão acesso`} · {open ? "ocultar" : "ver quem"}
      </button>
      {open && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {members.map((m) => (
            <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pr-2.5 pl-0.5 text-[12px]">
              <Avatar name={m.name} id={m.id} size={18} />
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

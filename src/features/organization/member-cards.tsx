"use client";

import { CalendarDays, Pencil, ShieldCheck } from "lucide-react";
import type { Department, Member, Role } from "@/types";
import { useDirectory } from "@/hooks/use-data";
import { formatDate } from "@/lib/format";
import { isSupportRole } from "@/lib/support";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { MemberAvatar } from "@/components/shared/member-avatar";

/** Cor dos departamentos padrão, pela sigla (igual na demonstração e no ambiente real). */
const DEPARTMENT_COLORS: Record<string, string> = {
  PRE: "#e1af37",
  SEC: "#8fb0ec",
  FIN: "#5b86d9",
  MKT: "#e88ab5",
  EVT: "#f2a93b",
  ENS: "#7fd9b0",
  ESP: "#f07a5a",
};
/** Departamentos criados depois: cor estável escolhida pelo id. */
const EXTRA_COLORS = ["#b6a9ff", "#5fc9d6", "#c7d36b", "#e9b4cf", "#9ad17a"];
const SUPPORT_COLOR = "#6b97ee";

export function memberColor(member: Member, department: Department | undefined) {
  if (isSupportRole(member.roleId)) return SUPPORT_COLOR;
  if (!department) return EXTRA_COLORS[0];
  const known = DEPARTMENT_COLORS[department.shortName.toUpperCase()];
  if (known) return known;
  const key = department.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return EXTRA_COLORS[key % EXTRA_COLORS.length];
}

const LEVEL_ORDER: Record<Role["level"], number> = { presidency: 0, director: 1, advisor: 2, member: 3 };

/** Ordem de exibição: suporte, presidência, diretoria, assessoria, demais; depois por nome. */
export function compareMembers(a: Member, b: Member, roleOf: (id: string) => Role | undefined) {
  const rank = (m: Member) => (isSupportRole(m.roleId) ? -1 : LEVEL_ORDER[roleOf(m.roleId)?.level ?? "member"]);
  return rank(a) - rank(b) || a.name.localeCompare(b.name, "pt-BR");
}

/** Cartão do integrante: foto grande, cargo em destaque na cor do departamento. */
export function MemberCard({
  member,
  isMe,
  index,
  onOpen,
  onEdit,
  editLock,
}: {
  member: Member;
  isMe: boolean;
  index: number;
  onOpen: () => void;
  /** Ausente quando quem vê não pode editar. */
  onEdit?: () => void;
  /** Motivo de a edição estar bloqueada (cargo acima do seu). */
  editLock?: string;
}) {
  const dir = useDirectory();
  const role = dir.role(member.roleId);
  const color = memberColor(member, dir.departmentOf(member.id));
  const active = member.status === "active";
  const support = isSupportRole(member.roleId);

  return (
    <li className="anim-rise" style={{ animationDelay: `${Math.min(index * 45, 450)}ms` }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
        className={cn(
          "group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 text-center transition-[transform,border-color,box-shadow] duration-200",
          "hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50",
          !active && "opacity-60 grayscale",
        )}
        style={{ ["--c" as string]: color }}
      >
        <div aria-hidden className="h-16" style={{ background: `radial-gradient(120% 160% at 50% 0%, ${color}59, transparent 70%), linear-gradient(180deg, ${color}26, transparent)` }} />
        <div className="-mt-11 flex flex-1 flex-col items-center px-4 pb-4">
          <div className="rounded-full p-[3px] transition-transform duration-200 group-hover:scale-[1.03]" style={{ background: `linear-gradient(145deg, ${color}, ${color}55)` }}>
            <MemberAvatar id={member.id} name={member.name} size={88} className="ring-4 ring-surface-2" />
          </div>

          <p className="mt-3 line-clamp-2 font-display text-[18px] leading-tight font-bold">{member.name}</p>
          <div className="mt-1.5 flex min-h-5 flex-wrap justify-center gap-1.5">
            {support && <Badge tone="info">Suporte</Badge>}
            {isMe && <Badge tone="gold">Você</Badge>}
            {!active && <Badge tone="danger">Desativada</Badge>}
          </div>

          <span
            className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold"
            style={{ color, borderColor: `${color}66`, background: `${color}1a` }}
          >
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{role?.name ?? "Sem cargo"}</span>
          </span>
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-fg-muted">
            <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
            {dir.departmentOf(member.id)?.name ?? "—"}
          </p>
          {member.email && <p className="mt-1 max-w-full truncate text-[11.5px] text-fg-subtle">{member.email}</p>}

          <div className="mt-auto flex w-full items-center justify-between gap-2 border-t border-line pt-3 mt-4 text-[11.5px] text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden />
              desde {formatDate(member.joinedAt)}
            </span>
            {onEdit && (
              <span title={editLock} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" disabled={!!editLock} onClick={onEdit}>
                  <Pencil /> Editar
                </Button>
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

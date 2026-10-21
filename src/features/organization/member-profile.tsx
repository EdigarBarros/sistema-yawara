"use client";

import { useRef, useState, type ReactNode } from "react";
import { Building2, CalendarDays, Camera, Layers, Loader2, LifeBuoy, Pencil, ShieldCheck, Trash2, UserCheck, UserX } from "lucide-react";
import type { Member, Permission, PermissionAction, Role } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { MODULES } from "@/lib/modules";
import { ACTION_LABELS, ROLE_LEVEL_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { isFirebaseMode } from "@/lib/mode";
import { imageFileToAvatar } from "@/lib/photo";
import { isSupportRole } from "@/lib/support";
import { notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { AREA_COLORS, NAV } from "@/components/layout/nav";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { confirmAction } from "@/components/shared/confirm";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { memberEditRules } from "./org-rules";
import { SupportAccountDialog } from "./support-account-dialog";

const MODULE_NAV = new Map(NAV.flatMap((g) => g.items).flatMap((i) => (i.module ? [[i.module, i] as const] : [])));

/** Cartão de topo do perfil: foto, nome, cargo, situação e dados principais. */
export function ProfileHero({ member, role, photoSlot, className }: { member: Member; role?: Role; photoSlot?: ReactNode; className?: string }) {
  const dir = useDirectory();
  const support = isSupportRole(member.roleId);
  const department = dir.departmentOf(member.id);
  const extra = (member.departmentIds ?? []).map((d) => dir.department(d)?.name).filter(Boolean);
  const facts = [
    { icon: <Building2 />, label: "Departamento", value: department?.name ?? "—" },
    { icon: <Layers />, label: "Nível", value: role ? ROLE_LEVEL_LABELS[role.level] : "—" },
    { icon: <CalendarDays />, label: "Na Atlética desde", value: formatDate(member.joinedAt) },
  ];
  return (
    <section className={cn("anim-rise overflow-hidden rounded-3xl border border-line bg-surface", className)}>
      <div
        aria-hidden
        className="h-24 sm:h-28"
        style={{
          background: support
            ? "radial-gradient(120% 140% at 0% 0%, rgba(107,151,238,0.55), transparent 60%), linear-gradient(135deg, #132a6e, #0a1236)"
            : "radial-gradient(120% 140% at 0% 0%, rgba(225,175,55,0.45), transparent 60%), linear-gradient(135deg, #1d2d6e, #0a1236)",
        }}
      />
      <div className="-mt-12 px-5 pb-5 sm:px-6">
        <div className="flex items-end justify-between gap-3">
          <div className="relative">
            <MemberAvatar id={member.id} name={member.name} size={96} className="ring-4 ring-surface" />
            {photoSlot}
          </div>
          <Badge tone={member.status === "active" ? "ok" : "danger"} dot>
            {member.status === "active" ? "Ativa" : "Acesso removido"}
          </Badge>
        </div>
        <h2 className="mt-3 font-display text-[26px] leading-tight font-bold">{member.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge tone={support ? "info" : "gold"} icon={<ShieldCheck />}>
            {role?.name ?? "Sem cargo"}
          </Badge>
          {support && <Badge tone="info">Acima da Presidência</Badge>}
        </div>
        {member.email && <p className="mt-2 truncate text-[13px] text-fg-muted">{member.email}</p>}
        <dl className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {facts.map((f, i) => (
            <div key={f.label} className="anim-pop flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3.5 py-3 sm:flex-col sm:items-start sm:gap-1.5" style={{ animationDelay: `${120 + i * 60}ms` }}>
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gold/12 text-gold-fg [&_svg]:size-4">{f.icon}</span>
              <div className="min-w-0">
                <dt className="text-[11.5px] text-fg-subtle">{f.label}</dt>
                <dd className="truncate text-[14px] font-semibold">{f.value}</dd>
              </div>
            </div>
          ))}
        </dl>
        {extra.length > 0 && <p className="mt-3 text-[12.5px] text-fg-muted">Também atua em: {extra.join(", ")}</p>}
      </div>
    </section>
  );
}

/** O que o cargo pode fazer, em blocos por área (ícone e cor da área + ações em etiquetas). */
export function AccessCards({ permissions }: { permissions: Permission[] }) {
  const set = new Set(permissions);
  const modules = MODULES.filter((m) => set.has(`${m.key}.view` as Permission));
  if (modules.length === 0) return <p className="text-[13px] text-fg-subtle">Nenhuma área liberada para este cargo.</p>;
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {modules.map((m, i) => {
        const nav = MODULE_NAV.get(m.key);
        const color = (nav && AREA_COLORS[nav.href]) ?? "#c5cde6";
        const Icon = nav?.icon;
        const actions = (Object.keys(m.actions) as PermissionAction[]).filter((a) => set.has(`${m.key}.${a}` as Permission));
        return (
          <li key={m.key} className="anim-rise rounded-2xl border border-line bg-surface-2 p-3.5" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] text-[#06102e]" style={{ background: `linear-gradient(145deg, ${color}, ${color}b3)` }}>
                {Icon && <Icon className="size-4" strokeWidth={2.2} aria-hidden />}
              </span>
              <span className="text-[14px] font-semibold">{m.label}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {actions.map((a) => (
                <span key={a} className="rounded-full border border-line-strong px-2 py-0.5 text-[11.5px] text-fg-muted">
                  {ACTION_LABELS[a]}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Botão de câmera sobre a foto: escolhe, reduz no aparelho e salva a foto da própria conta. */
export function PhotoButton({ hasPhoto }: { hasPhoto: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const save = useAction((photo: string | null) => services.organization.updateMyPhoto(photo), {
    success: (m) => (m.photo ? "Foto de perfil atualizada" : "Foto de perfil removida"),
  });
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={hasPhoto ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
        className="press absolute -right-1 -bottom-1 grid size-10 place-items-center rounded-full border-4 border-surface bg-gold text-gold-ink shadow-lg"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await save.run(await imageFileToAvatar(file));
          } catch (error) {
            if (error instanceof Error && !("code" in error)) notifyError(error);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/**
 * Ações sobre o perfil de outra pessoa: editar, remover/devolver o acesso e
 * excluir o perfil. Só aparece o que o servidor aceitaria (mesmas regras).
 */
export function MemberActions({ member, onEdit, onDeleted }: { member: Member; onEdit: () => void; onDeleted: () => void }) {
  const access = useAccess();
  const dir = useDirectory();
  const rules = isFirebaseMode ? memberEditRules(access.ctx, member, dir.roles) : null;
  const canEdit = access.can("organization.edit") && (!rules || rules.canEdit);
  const self = member.id === access.user?.id;
  const canDelete = canEdit && !self && access.can("organization.admin");
  const active = member.status === "active";
  const support = isSupportRole(access.role?.id);
  const [supportOpen, setSupportOpen] = useState(false);

  const setStatus = useAction((status: Member["status"]) => services.organization.updateMember(member.id, { status }), {
    success: (m) => (m.status === "active" ? `Acesso de ${m.name} devolvido` : `Acesso de ${m.name} removido`),
  });
  const remove = useAction(() => services.organization.deleteMember(member.id), { success: `Perfil de ${member.name} excluído`, onSuccess: onDeleted });

  if (!canEdit) return rules?.reason ? <p className="text-[12.5px] text-fg-subtle">{rules.reason}</p> : null;
  return (
    <div className="flex w-full flex-wrap gap-2">
      <Button variant="secondary" onClick={onEdit}>
        <Pencil /> Editar
      </Button>
      {support && (
        <>
          <Button variant="secondary" onClick={() => setSupportOpen(true)}>
            <LifeBuoy /> Conta (suporte)
          </Button>
          <SupportAccountDialog member={member} open={supportOpen} onOpenChange={setSupportOpen} />
        </>
      )}
      {!self && (
        <Button
          variant="secondary"
          loading={setStatus.pending}
          onClick={async () => {
            const ok = await confirmAction(
              active
                ? {
                    title: `Remover o acesso de ${member.name}?`,
                    description: "A pessoa sai na hora e não consegue mais entrar. O perfil e o histórico continuam; dá para devolver o acesso depois.",
                    confirmLabel: "Remover acesso",
                    tone: "danger",
                  }
                : { title: `Devolver o acesso de ${member.name}?`, description: "A pessoa volta a entrar com o mesmo cargo.", confirmLabel: "Devolver acesso" },
            );
            if (ok) setStatus.runSafe(active ? "inactive" : "active");
          }}
        >
          {active ? <UserX /> : <UserCheck />} {active ? "Remover acesso" : "Devolver acesso"}
        </Button>
      )}
      {canDelete && (
        <Button
          variant="danger"
          loading={remove.pending}
          className="sm:ml-auto"
          onClick={async () => {
            const ok = await confirmAction({
              title: `Excluir o perfil de ${member.name}?`,
              description: "A conta de acesso e o cadastro são apagados e não dá para desfazer. O que a pessoa registrou continua na Central, com o autor como \"Integrante removido\".",
              confirmLabel: "Excluir perfil",
              tone: "danger",
            });
            if (ok) remove.runSafe();
          }}
        >
          <Trash2 /> Excluir perfil
        </Button>
      )}
    </div>
  );
}

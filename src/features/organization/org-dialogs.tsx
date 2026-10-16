"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import type { Department, HomePreset, ID, Member, Permission, Role, RoleLevel } from "@/types";
import { services, type MemberInput } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { MAX_EXTRA_DEPARTMENTS } from "@/lib/access-tokens";
import { ROLE_LEVEL_LABELS } from "@/lib/labels";
import { isFirebaseMode } from "@/lib/mode";
import { errorMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Segmented, Select, Switch, Textarea } from "@/components/ui/form";
import { DemoNotice } from "@/components/shared/states";
import { confirmAction } from "@/components/shared/confirm";
import { PermissionMatrix } from "./permission-matrix";
import { assignableRoles, canAssignRole, canChangeRoleAccess, memberEditRules, permissionLock, roleAccessLock } from "./org-rules";

const HOME_LABELS: Record<HomePreset, string> = {
  presidency: "Presidência (visão institucional)",
  secretary: "Secretaria (reuniões e documentos)",
  finance: "Financeiro (indicadores e lançamentos)",
  marketing: "Marketing (produção de conteúdo)",
  events: "Eventos (agenda e tarefas)",
  extension: "Ensino e Extensão (atividades)",
  advisor: "Assessoria (tarefas e vendas)",
};

export function ErrorLine({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="mt-4 rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
      {error}
    </p>
  ) : null;
}

/** Aviso do ambiente real (sem o ícone de "demonstração"). */
export function Notice({ children, className, tone = "info" }: { children: ReactNode; className?: string; tone?: "info" | "warn" }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed",
        tone === "info" ? "border-info/25 bg-info/[0.07] text-fg-muted" : "border-warn/30 bg-warn/[0.08] text-fg-muted",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "info" ? "text-info" : "text-warn")} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Aviso que depende do modo: demonstração (ícone de laboratório) ou ambiente real. */
function ModeNotice({ children, className, tone }: { children: ReactNode; className?: string; tone?: "info" | "warn" }) {
  return isFirebaseMode ? (
    <Notice className={className} tone={tone}>
      {children}
    </Notice>
  ) : (
    <DemoNotice className={className} tone={tone}>
      {children}
    </DemoNotice>
  );
}

/** Seleção de departamentos adicionais (além do departamento do cargo). */
export function DepartmentChecklist({
  value,
  onChange,
  excludeId,
  disabled,
}: {
  value: ID[];
  onChange: (ids: ID[]) => void;
  /** Departamento do cargo (já incluído automaticamente). */
  excludeId?: ID;
  disabled?: boolean;
}) {
  const dir = useDirectory();
  // Departamentos desativados só aparecem se já estiverem marcados (para poderem ser retirados).
  const options = dir.departments.filter((d) => d.id !== excludeId && (d.active || value.includes(d.id)));
  const full = value.filter((id) => id !== excludeId).length >= MAX_EXTRA_DEPARTMENTS;
  if (options.length === 0) return <p className="text-[12.5px] text-fg-subtle">Nenhum outro departamento ativo.</p>;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {options.map((d) => {
        const checked = value.includes(d.id);
        return (
          <li key={d.id}>
            <label className={cn("flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[13px]", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-line-strong")}>
              <Checkbox
                checked={checked}
                disabled={disabled || (!checked && full)}
                onChange={(e) => onChange(e.target.checked ? [...value, d.id] : value.filter((x) => x !== d.id))}
              />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              {!d.active && <span className="text-[11.5px] text-danger">desativado</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Cargos agrupados por departamento para um <Select>. */
export function RoleOptions({ roles }: { roles: Role[] }) {
  const dir = useDirectory();
  return (
    <>
      {dir.departments.map((d) => {
        const list = roles.filter((r) => r.departmentId === d.id);
        if (list.length === 0) return null;
        return (
          <optgroup key={d.id} label={d.name}>
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.active ? "" : " (desativado)"}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/* ----------------------------------- Cargo ----------------------------------- */

interface RoleProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role?: Role;
}

export function RoleDialog(props: RoleProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <RoleBody {...props} />}
    </Dialog>
  );
}

function RoleBody({ onOpenChange, role }: RoleProps) {
  const access = useAccess();
  const dir = useDirectory();
  const canAdmin = access.can("organization.admin");
  // Ambiente real: espelha as regras do servidor (nível, diretoria, departamento,
  // situação e permissões exigem organization.admin e as permissões do cargo).
  const accessLock = isFirebaseMode ? roleAccessLock(access.ctx, role) : canAdmin ? undefined : "Seu perfil pode ver, mas não alterar permissões.";
  const canAccess = isFirebaseMode ? canChangeRoleAccess(access.ctx, role) : canAdmin;
  const strictFields = isFirebaseMode && !canAccess;
  const ownRole = !!role && role.id === access.role?.id;
  const [tab, setTab] = useState<"dados" | "permissoes">("dados");
  const [form, setForm] = useState({
    name: role?.name ?? "",
    description: role?.description ?? "",
    departmentId: role?.departmentId ?? (isFirebaseMode ? (dir.departments.find((d) => d.active) ?? dir.departments[0]) : dir.departments[0])?.id ?? "",
    level: role?.level ?? ("advisor" as RoleLevel),
    isBoard: role?.isBoard ?? false,
    active: role?.active ?? true,
    homePreset: role?.homePreset ?? ("advisor" as HomePreset),
  });
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const [error, setError] = useState<string>();
  // Os dados vão como argumento: um reenvio só reaproveita o identificador da requisição se forem os mesmos.
  const save = useAction(
    (data: typeof form, perms: Permission[]) =>
      role
        ? services.organization.updateRole(role.id, { ...data, ...(canAccess ? { permissions: perms } : {}) })
        : services.organization.createRole({ ...data, permissions: canAccess ? perms : [] }),
    { success: role ? "Cargo atualizado" : "Cargo criado", silentError: true },
  );
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <DialogContent
      size="xl"
      modal
      title={role ? `Editar cargo: ${role.name}` : "Novo cargo"}
      description="Cargos são lidos dos dados; nenhuma tela tem cargos fixos no código."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={async () => {
              if (form.name.trim().length < 2) {
                setTab("dados");
                return setError("Informe o nome do cargo.");
              }
              setError(undefined);
              try {
                await save.run(form, permissions);
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {role ? "Salvar cargo" : "Criar cargo"}
          </Button>
        </>
      }
    >
      <Segmented
        ariaLabel="Seção"
        value={tab}
        onChange={setTab}
        className="mb-5"
        options={[
          { value: "dados", label: "Dados do cargo" },
          { value: "permissoes", label: `Permissões (${permissions.length})` },
        ]}
      />
      {tab === "dados" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Assessor(a) de Esportes" />
          </Field>
          <Field label="Departamento" required hint={strictFields && role ? "Somente quem administra permissões pode mudar o departamento de um cargo." : undefined}>
            <Select value={form.departmentId} disabled={strictFields && !!role} onChange={(e) => set("departmentId", e.target.value)}>
              {dir.departments
                .filter((d) => !isFirebaseMode || d.active || d.id === form.departmentId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Descrição" optional className="sm:col-span-2">
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field
            label="Nível"
            required
            hint={
              strictFields
                ? role
                  ? "Somente quem administra permissões pode mudar o nível de um cargo."
                  : "Cargos de diretoria ou presidência só podem ser criados por quem administra permissões."
                : "Usado nos públicos “diretores” e “diretores e assessores”."
            }
          >
            <Select value={form.level} disabled={strictFields && !!role} onChange={(e) => set("level", e.target.value as RoleLevel)}>
              {Object.entries(ROLE_LEVEL_LABELS)
                .filter(([v]) => !strictFields || !!role || v === "advisor" || v === "member")
                .map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Página inicial" required>
            <Select value={form.homePreset} onChange={(e) => set("homePreset", e.target.value as HomePreset)}>
              {Object.entries(HOME_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
            <div>
              <p className="text-[13.5px] font-medium">Faz parte da diretoria</p>
              <p className="text-[12px] text-fg-muted">Incluído no público “Somente diretoria”.</p>
            </div>
            <Switch checked={form.isBoard} disabled={strictFields} onCheckedChange={(v) => set("isBoard", v)} label="Faz parte da diretoria" />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
            <div>
              <p className="text-[13.5px] font-medium">Cargo ativo</p>
              <p className="text-[12px] text-fg-muted">
                {isFirebaseMode && ownRole ? "Você não pode desativar o seu próprio cargo." : "Cargos inativos perdem o acesso."}
              </p>
            </div>
            <Switch
              checked={form.active}
              disabled={(strictFields && !!role) || (isFirebaseMode && ownRole && form.active)}
              onCheckedChange={(v) => set("active", v)}
              label="Cargo ativo"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {accessLock && <ModeNotice tone="warn">{accessLock}</ModeNotice>}
          <PermissionMatrix
            value={permissions}
            onChange={canAccess ? setPermissions : undefined}
            readOnly={!canAccess}
            lockReason={isFirebaseMode ? (p, checked) => permissionLock(access.ctx, role, p, checked) : undefined}
          />
          {isFirebaseMode ? (
            <Notice>Você só pode conceder ou retirar permissões que o seu cargo tem. As permissões são conferidas pelo servidor em cada operação e pelas regras de acesso aos dados.</Notice>
          ) : (
            <DemoNotice>Permissões simuladas: definem o que a interface mostra nesta demonstração. A segurança real será aplicada pelo backend.</DemoNotice>
          )}
        </div>
      )}
      <ErrorLine error={error} />
    </DialogContent>
  );
}

/* -------------------------------- Departamento -------------------------------- */

interface DepProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  department?: Department;
}

export function DepartmentDialog(props: DepProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <DepartmentBody {...props} />}
    </Dialog>
  );
}

function DepartmentBody({ onOpenChange, department }: DepProps) {
  const access = useAccess();
  // Ambiente real: desativar um departamento muda o acesso de quem pertence a ele (exige organization.admin).
  const lockDeactivate = isFirebaseMode && !!department?.active && !access.can("organization.admin");
  const [form, setForm] = useState({ name: department?.name ?? "", shortName: department?.shortName ?? "", description: department?.description ?? "", active: department?.active ?? true });
  const [error, setError] = useState<string>();
  const save = useAction((data: typeof form) => (department ? services.organization.updateDepartment(department.id, data) : services.organization.createDepartment(data)), {
    success: department ? "Departamento atualizado" : "Departamento criado",
    silentError: true,
  });
  return (
    <DialogContent
      title={department ? "Editar departamento" : "Novo departamento"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={async () => {
              if (form.name.trim().length < 2) return setError("Informe o nome.");
              if (form.shortName.trim().length < 2) return setError("Informe uma sigla com 2 a 4 letras.");
              setError(undefined);
              try {
                await save.run(form);
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Nome" required>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Sigla" required>
          <Input value={form.shortName} maxLength={4} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Descrição" optional className="sm:col-span-2">
          <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3 sm:col-span-2">
          <div>
            <p className="text-[13.5px] font-medium">Departamento ativo</p>
            {lockDeactivate && <p className="text-[12px] text-fg-muted">Somente quem administra permissões pode desativar departamentos.</p>}
          </div>
          <Switch checked={form.active} disabled={lockDeactivate} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} label="Departamento ativo" />
        </div>
      </div>
      <ErrorLine error={error} />
    </DialogContent>
  );
}

/* --------------------------------- Integrante --------------------------------- */

interface MemberProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  member?: Member;
}

export function MemberDialog(props: MemberProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && (isFirebaseMode && props.member ? <MemberEditBody onOpenChange={props.onOpenChange} member={props.member} /> : <MemberBody {...props} />)}
    </Dialog>
  );
}

function MemberBody({ onOpenChange, member }: MemberProps) {
  const dir = useDirectory();
  const [form, setForm] = useState({ name: member?.name ?? "", email: member?.email ?? "", roleId: member?.roleId ?? "", status: member?.status ?? ("active" as Member["status"]) });
  const [error, setError] = useState<string>();
  const save = useAction(() => (member ? services.organization.updateMember(member.id, form) : services.organization.createMember(form)), {
    success: member ? "Integrante atualizado" : "Integrante adicionado",
    silentError: true,
  });
  return (
    <DialogContent
      title={member ? `Editar ${member.name}` : "Adicionar integrante"}
      description={isFirebaseMode ? "Integrantes entram na Central por convite." : "Dados fictícios de demonstração. Nenhum convite ou e-mail é enviado."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={async () => {
              if (form.name.trim().length < 2) return setError("Informe o nome.");
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return setError("Informe um e-mail válido.");
              if (!form.roleId) return setError("Escolha o cargo.");
              setError(undefined);
              try {
                await save.run();
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="E-mail" required className="sm:col-span-2">
          <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="nome@example.org" />
        </Field>
        <Field label="Cargo" required hint="O departamento vem do cargo.">
          <Select value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
            <option value="">Selecione…</option>
            {dir.departments.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {dir.roles
                  .filter((r) => r.departmentId === d.id && r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Situação" required>
          <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Member["status"] }))}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </Select>
        </Field>
      </div>
      <ErrorLine error={error} />
    </DialogContent>
  );
}

/* ------------------------- Integrante (ambiente real) ------------------------- */

const sameIds = (a: ID[], b: ID[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * Edição de integrante com o Firebase. Espelha as regras do servidor
 * (functions/src/modules/organization.ts → updateMember): ninguém altera o
 * próprio cargo, a própria situação ou os próprios departamentos; o cargo de
 * destino precisa estar contido nas permissões de quem altera, e cargos de
 * alcance maior (diretoria, nível, outro departamento) exigem
 * organization.admin; departamentos adicionais exigem organization.admin; o
 * e-mail de acesso não muda por aqui.
 * Só os campos alterados são enviados.
 */
function MemberEditBody({ onOpenChange, member }: { onOpenChange: (o: boolean) => void; member: Member }) {
  const access = useAccess();
  const dir = useDirectory();
  const rules = memberEditRules(access.ctx, member, dir.roles);
  const [form, setForm] = useState({ name: member.name, roleId: member.roleId, status: member.status, departmentIds: member.departmentIds ?? [] });
  const [error, setError] = useState<string>();
  const roleOptions = useMemo(() => {
    const list = assignableRoles(access.ctx, dir.roles);
    const current = dir.role(member.roleId);
    return current && !list.some((r) => r.id === current.id) ? [...list, current] : list;
  }, [access.ctx, dir, member.roleId]);
  const nextRole = dir.role(form.roleId);
  const save = useAction((input: Partial<MemberInput> & { departmentIds?: ID[] }) => services.organization.updateMember(member.id, input), {
    success: "Integrante atualizado",
    silentError: true,
  });

  const submit = async () => {
    const name = form.name.trim();
    if (name.length < 2) return setError("Informe o nome com pelo menos 2 caracteres.");
    const input: Partial<MemberInput> & { departmentIds?: ID[] } = {};
    if (name !== member.name) input.name = name;
    if (rules.canChangeRole && form.roleId !== member.roleId) {
      if (!nextRole || !nextRole.active || !canAssignRole(access.ctx, nextRole)) return setError("Escolha um cargo ativo que você possa atribuir.");
      input.roleId = form.roleId;
    }
    if (rules.canChangeStatus && form.status !== member.status) {
      // Reativar devolve também os departamentos adicionais (quem pode mudá-los administra permissões).
      if (form.status === "active" && nextRole && !canAssignRole(access.ctx, nextRole, member.departmentIds ?? [])) {
        return setError("Você não pode reativar esta conta: o cargo ou os departamentos dela dão permissões ou acesso que o seu cargo não tem.");
      }
      input.status = form.status;
    }
    if (rules.canChangeDepartments) {
      const extra = form.departmentIds.filter((d) => d !== nextRole?.departmentId);
      if (!sameIds(extra, (member.departmentIds ?? []).filter((d) => d !== nextRole?.departmentId))) {
        if (extra.some((d) => !dir.department(d)?.active)) return setError("Desmarque os departamentos desativados antes de salvar.");
        input.departmentIds = extra;
      }
    }
    if (Object.keys(input).length === 0) return onOpenChange(false);
    if (input.status === "inactive") {
      const ok = await confirmAction({
        title: `Desativar a conta de ${member.name}?`,
        description:
          "A pessoa perde o acesso imediatamente: o login fica bloqueado e as sessões abertas são encerradas. Os registros dela são mantidos e a conta pode ser reativada depois.",
        confirmLabel: "Desativar conta",
        tone: "danger",
      });
      if (!ok) return;
    }
    setError(undefined);
    try {
      await save.run(input);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <DialogContent
      title={`Editar ${member.name}`}
      description={rules.self ? "Você está editando o seu próprio cadastro." : "As alterações de cargo e situação valem imediatamente."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.pending} disabled={!rules.canEdit} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      {!rules.canEdit ? (
        <Notice tone="warn">{rules.reason}</Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={form.name} maxLength={100} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          {member.email && (
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-[13px] font-medium">E-mail de acesso</p>
              <p className="rounded-lg border border-line bg-sunken px-3 py-2.5 text-[13.5px] text-fg-muted">{member.email}</p>
              <p className="mt-1.5 text-xs text-fg-subtle">O e-mail de acesso não é alterado por aqui. Para trocar o e-mail, desative esta conta e convide a pessoa de novo com o novo endereço.</p>
            </div>
          )}
          <Field
            label="Cargo"
            required
            hint={
              rules.self
                ? "Você não pode alterar o seu próprio cargo. Peça a outra pessoa que administre a organização."
                : "Só aparecem os cargos que você pode atribuir. O departamento vem do cargo."
            }
          >
            <Select value={form.roleId} disabled={!rules.canChangeRole} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
              <RoleOptions roles={roleOptions} />
            </Select>
          </Field>
          <Field label="Situação da conta" required hint={rules.self ? "Você não pode desativar a sua própria conta." : "Desativar bloqueia o login imediatamente."}>
            <Select value={form.status} disabled={!rules.canChangeStatus} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Member["status"] }))}>
              <option value="active">Ativa</option>
              <option value="inactive">Desativada</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[13px] font-medium">
              Departamentos adicionais <span className="ml-1 text-xs font-normal text-fg-subtle">(opcional)</span>
            </p>
            {rules.canChangeDepartments ? (
              <>
                <DepartmentChecklist value={form.departmentIds} excludeId={nextRole?.departmentId} onChange={(ids) => setForm((f) => ({ ...f, departmentIds: ids }))} />
                <p className="mt-1.5 text-xs text-fg-subtle">A pessoa passa a fazer parte do público “departamento” dos registros desses departamentos, além do departamento do cargo.</p>
              </>
            ) : (
              <p className="text-[12.5px] text-fg-muted">
                {(member.departmentIds ?? []).map((d) => dir.department(d)?.name).filter(Boolean).join(", ") || "Nenhum."}{" "}
                <span className="text-fg-subtle">
                  {rules.self ? "Você não pode alterar os seus próprios departamentos." : "Somente quem administra permissões pode alterar departamentos adicionais."}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </DialogContent>
  );
}

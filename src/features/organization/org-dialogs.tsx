"use client";

import { useState } from "react";
import type { Department, HomePreset, Member, Permission, Role, RoleLevel } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { ROLE_LEVEL_LABELS } from "@/lib/labels";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Segmented, Select, Switch, Textarea } from "@/components/ui/form";
import { DemoNotice } from "@/components/shared/states";
import { PermissionMatrix } from "./permission-matrix";

const HOME_LABELS: Record<HomePreset, string> = {
  presidency: "Presidência (visão institucional)",
  secretary: "Secretaria (reuniões e documentos)",
  finance: "Financeiro (indicadores e lançamentos)",
  marketing: "Marketing (produção de conteúdo)",
  events: "Eventos (agenda e tarefas)",
  extension: "Ensino e Extensão (atividades)",
  advisor: "Assessoria (tarefas e vendas)",
};

function ErrorLine({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="mt-4 rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
      {error}
    </p>
  ) : null;
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
  const [tab, setTab] = useState<"dados" | "permissoes">("dados");
  const [form, setForm] = useState({
    name: role?.name ?? "",
    description: role?.description ?? "",
    departmentId: role?.departmentId ?? dir.departments[0]?.id ?? "",
    level: role?.level ?? ("advisor" as RoleLevel),
    isBoard: role?.isBoard ?? false,
    active: role?.active ?? true,
    homePreset: role?.homePreset ?? ("advisor" as HomePreset),
  });
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const [error, setError] = useState<string>();
  const save = useAction(
    () =>
      role
        ? services.organization.updateRole(role.id, { ...form, ...(canAdmin ? { permissions } : {}) })
        : services.organization.createRole({ ...form, permissions: canAdmin ? permissions : [] }),
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
                await save.run();
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
          <Field label="Departamento" required>
            <Select value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
              {dir.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Descrição" optional className="sm:col-span-2">
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Nível" required hint="Usado nos públicos “diretores” e “diretores e assessores”.">
            <Select value={form.level} onChange={(e) => set("level", e.target.value as RoleLevel)}>
              {Object.entries(ROLE_LEVEL_LABELS).map(([v, l]) => (
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
            <Switch checked={form.isBoard} onCheckedChange={(v) => set("isBoard", v)} label="Faz parte da diretoria" />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
            <div>
              <p className="text-[13.5px] font-medium">Cargo ativo</p>
              <p className="text-[12px] text-fg-muted">Cargos inativos perdem o acesso.</p>
            </div>
            <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} label="Cargo ativo" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!canAdmin && <DemoNotice tone="warn">Seu perfil pode ver, mas não alterar permissões.</DemoNotice>}
          <PermissionMatrix value={permissions} onChange={canAdmin ? setPermissions : undefined} readOnly={!canAdmin} />
          <DemoNotice>Permissões simuladas: definem o que a interface mostra nesta demonstração. A segurança real será aplicada pelo backend.</DemoNotice>
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
  const [form, setForm] = useState({ name: department?.name ?? "", shortName: department?.shortName ?? "", description: department?.description ?? "", active: department?.active ?? true });
  const [error, setError] = useState<string>();
  const save = useAction(() => (department ? services.organization.updateDepartment(department.id, form) : services.organization.createDepartment(form)), {
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
          <p className="text-[13.5px] font-medium">Departamento ativo</p>
          <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} label="Departamento ativo" />
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
      {props.open && <MemberBody {...props} />}
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
      description="Dados fictícios de demonstração. Nenhum convite ou e-mail é enviado."
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

"use client";

import { MemberAvatar } from "@/components/shared/member-avatar";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, KeyRound, LayoutGrid, List, MailPlus, Pencil, Plus, ShieldCheck, Undo2, UserPlus, Users } from "lucide-react";
import type { Department, Member, Permission, Role } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useOrganization } from "@/hooks/use-data";
import { ROLE_LEVEL_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { allPermissions } from "@/lib/modules";
import { isDemoMode, isFirebaseMode } from "@/lib/mode";
import { errorMessage } from "@/lib/notify";
import { cn, matchesQuery } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { PageHeader, Panel, SectionTitle } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { DemoNotice, EmptyState, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { confirmAction } from "@/components/shared/confirm";
import { DepartmentDialog, MemberDialog, Notice, RoleDialog } from "@/features/organization/org-dialogs";
import { InvitationsTab, InviteDialog, useInvitations } from "@/features/organization/invitations";
import { memberEditRules, missingPermissions, permissionLock, roleAccessLock } from "@/features/organization/org-rules";
import { isSupportRole } from "@/lib/support";
import { compareMembers, MemberCard, memberColor } from "@/features/organization/member-cards";
import { AccessCards, MemberActions, ProfileHero } from "@/features/organization/member-profile";
import { PermissionMatrix } from "@/features/organization/permission-matrix";

const TABS = ["integrantes", "convites", "cargos", "departamentos", "permissoes"] as const;
type Tab = (typeof TABS)[number];

function StatusPill({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? "ok" : "neutral"} dot>
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}

/** Situação da conta do integrante: no ambiente real, "Ativa" ou "Desativada" (login bloqueado). */
function MemberStatusPill({ active }: { active: boolean }) {
  if (isDemoMode) return <StatusPill active={active} />;
  return (
    <Badge tone={active ? "ok" : "danger"} dot>
      {active ? "Ativa" : "Desativada"}
    </Badge>
  );
}

/** Aviso que depende do modo: demonstração (ícone de laboratório) ou ambiente real. */
function ModeNotice({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "info" | "warn" }) {
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

/* ------------------------------------ Integrantes ------------------------------------ */

function MembersTab({ onOpenMember }: { onOpenMember: (id: string) => void }) {
  const access = useAccess();
  const dir = useDirectory();
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [dep, setDep] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{ member?: Member } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [view, setView] = useState<"cards" | "list">("cards");

  /** Ambiente real: não oferece a edição de quem tem um cargo acima do seu (o servidor recusaria). */
  const editLock = (m: Member) => {
    const rules = isFirebaseMode ? memberEditRules(access.ctx, m, dir.roles) : null;
    return rules && !rules.canEdit ? (rules.reason ?? "Você não pode editar este integrante.") : undefined;
  };

  const rows = dir.members
    .filter((m) => status === "all" || m.status === status)
    .filter((m) => !dep || dir.role(m.roleId)?.departmentId === dep)
    .filter((m) => matchesQuery(query, m.name, m.email, dir.role(m.roleId)?.name))
    .sort((a, b) => compareMembers(a, b, dir.role));

  const columns: Column<Member>[] = [
    {
      key: "name",
      header: "Integrante",
      cell: (m) => (
        <div className="flex items-center gap-3">
          <MemberAvatar name={m.name} id={m.id} size={44} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-semibold">
              {m.name}
              {isSupportRole(m.roleId) && <Badge tone="info">Suporte</Badge>}
              {m.id === access.user?.id && <Badge tone="gold">Você</Badge>}
            </p>
            {m.email && <p className="truncate text-[12px] text-fg-subtle">{m.email}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Cargo",
      cell: (m) => {
        const color = memberColor(m, dir.departmentOf(m.id));
        return (
          <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold" style={{ color, borderColor: `${color}66`, background: `${color}1a` }}>
            {dir.role(m.roleId)?.name}
          </span>
        );
      },
    },
    { key: "dep", header: "Departamento", hideBelow: "lg", cell: (m) => <span className="text-fg-muted">{dir.departmentOf(m.id)?.name}</span> },
    { key: "since", header: "Desde", hideBelow: "xl", cell: (m) => <span className="tnum font-mono text-[12.5px] text-fg-muted">{formatDate(m.joinedAt)}</span> },
    { key: "status", header: "Situação", cell: (m) => <MemberStatusPill active={m.status === "active"} /> },
    {
      key: "actions",
      header: <span className="sr-only">Ações</span>,
      align: "right",
      cell: (m) => {
        if (!access.can("organization.edit")) return null;
        const lock = editLock(m);
        return (
          <span title={lock}>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!lock}
              onClick={(e) => {
                e.stopPropagation();
                setDialog({ member: m });
              }}
            >
              <Pencil /> Editar
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <section className="rounded-xl border border-line bg-surface">
      <Toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            ariaLabel="Situação"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Ativos", count: dir.members.filter((m) => m.status === "active").length },
              { value: "inactive", label: isFirebaseMode ? "Desativados" : "Inativos", count: dir.members.filter((m) => m.status === "inactive").length },
              { value: "all", label: "Todos", count: dir.members.length },
            ]}
          />
          <Segmented
            ariaLabel="Visualização"
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: "Cartões", icon: <LayoutGrid /> },
              { value: "list", label: "Lista", icon: <List /> },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterSelect label="Departamento" value={dep} onChange={setDep} options={[{ value: "", label: "Todos os departamentos" }, ...dir.departments.map((d) => ({ value: d.id, label: d.name }))]} />
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar nome ou cargo" className="w-full sm:w-56" />
          {access.can("organization.create") &&
            (isFirebaseMode ? (
              <Button variant="primary" onClick={() => setInviting(true)}>
                <MailPlus /> Convidar integrante
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setDialog({})}>
                <UserPlus /> Adicionar
              </Button>
            ))}
        </div>
      </Toolbar>
      {view === "cards" ? (
        dir.loading ? (
          <InlineLoader />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<Users />} title="Ninguém encontrado" />
        ) : (
          <ul className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {rows.map((m, i) => (
              <MemberCard
                key={m.id}
                member={m}
                index={i}
                isMe={m.id === access.user?.id}
                onOpen={() => onOpenMember(m.id)}
                onEdit={access.can("organization.edit") ? () => setDialog({ member: m }) : undefined}
                editLock={editLock(m)}
              />
            ))}
          </ul>
        )
      ) : (
        <DataTable
          caption="Integrantes"
          rows={rows}
          columns={columns}
          loading={dir.loading}
          getRowId={(m) => m.id}
          onRowClick={(m) => onOpenMember(m.id)}
          mobileCard={(m) => (
            <div className="flex items-center gap-3">
              <MemberAvatar name={m.name} id={m.id} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.name}</p>
                <p className="truncate text-[12px] text-fg-subtle">{dir.role(m.roleId)?.name}</p>
              </div>
              <MemberStatusPill active={m.status === "active"} />
            </div>
          )}
          empty={<EmptyState compact icon={<Users />} title="Ninguém encontrado" />}
        />
      )}
      {dialog && <MemberDialog open onOpenChange={(o) => !o && setDialog(null)} member={dialog.member} />}
      {isFirebaseMode && <InviteDialog open={inviting} onOpenChange={setInviting} />}
    </section>
  );
}

/* -------------------------------------- Cargos -------------------------------------- */

function RolesTab() {
  const access = useAccess();
  const dir = useDirectory();
  const [dialog, setDialog] = useState<{ role?: Role } | null>(null);
  const columns: Column<Role>[] = [
    {
      key: "name",
      header: "Cargo",
      cell: (r) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate font-semibold">
            {r.name}
            {isSupportRole(r.id) && <Badge tone="info">Acima da Presidência</Badge>}
          </p>
          <p className="line-clamp-1 text-[12px] text-fg-subtle">{r.description}</p>
        </div>
      ),
    },
    { key: "dep", header: "Departamento", cell: (r) => <span className="text-fg-muted">{dir.department(r.departmentId)?.name}</span> },
    {
      key: "level",
      header: "Nível",
      hideBelow: "lg",
      cell: (r) => (
        <span className="flex items-center gap-2 text-fg-muted">
          {ROLE_LEVEL_LABELS[r.level]}
          {r.isBoard && <Badge tone="gold">Diretoria</Badge>}
        </span>
      ),
    },
    { key: "people", header: "Integrantes", hideBelow: "lg", align: "right", cell: (r) => <span className="tnum font-mono">{dir.members.filter((m) => m.roleId === r.id && m.status === "active").length}</span> },
    { key: "perm", header: "Permissões", hideBelow: "xl", align: "right", cell: (r) => <span className="tnum font-mono text-fg-muted">{r.permissions.length}</span> },
    { key: "status", header: "Situação", cell: (r) => <StatusPill active={r.active} /> },
  ];
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <p className="text-[13px] text-fg-muted">Cargos cadastrados. Clique para editar dados e permissões.</p>
        {access.can("organization.create") && (
          <Button variant="primary" onClick={() => setDialog({})}>
            <Plus /> Novo cargo
          </Button>
        )}
      </div>
      <DataTable
        caption="Cargos"
        rows={[...dir.roles].sort((a, b) => Number(isSupportRole(b.id)) - Number(isSupportRole(a.id)) || (dir.department(a.departmentId)?.name ?? "").localeCompare(dir.department(b.departmentId)?.name ?? "") || a.name.localeCompare(b.name))}
        columns={columns}
        getRowId={(r) => r.id}
        // O cargo de suporte só abre para quem está nele (o servidor recusaria qualquer alteração).
        onRowClick={access.can("organization.edit") ? (r) => (isSupportRole(r.id) && !isSupportRole(access.role?.id) ? undefined : setDialog({ role: r })) : undefined}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{r.name}</p>
              <p className="text-[12px] text-fg-subtle">
                {dir.department(r.departmentId)?.name} · {ROLE_LEVEL_LABELS[r.level]}
              </p>
            </div>
            <StatusPill active={r.active} />
          </div>
        )}
        pageSize={30}
      />
      {dialog && <RoleDialog open onOpenChange={(o) => !o && setDialog(null)} role={dialog.role} />}
    </section>
  );
}

/* ----------------------------------- Departamentos ----------------------------------- */

function DepartmentsTab() {
  const access = useAccess();
  const dir = useDirectory();
  const [dialog, setDialog] = useState<{ department?: Department } | null>(null);
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <p className="text-[13px] text-fg-muted">Departamentos da Atlética.</p>
        {access.can("organization.create") && (
          <Button variant="primary" onClick={() => setDialog({})}>
            <Plus /> Novo departamento
          </Button>
        )}
      </div>
      <ul className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
        {dir.departments.map((d) => {
          const roles = dir.roles.filter((r) => r.departmentId === d.id);
          const people = dir.members.filter((m) => roles.some((r) => r.id === m.roleId) && m.status === "active");
          return (
            <li key={d.id} className="rounded-xl border border-line bg-sunken p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-lg border border-gold/30 bg-gold/10 font-mono text-[12px] font-semibold text-gold-fg">{d.shortName}</span>
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-[12px] text-fg-subtle">
                      {roles.length} cargo(s) · {people.length} pessoa(s)
                    </p>
                  </div>
                </div>
                <StatusPill active={d.active} />
              </div>
              <p className="mt-3 line-clamp-2 text-[12.5px] text-fg-muted">{d.description}</p>
              {access.can("organization.edit") && (
                <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => setDialog({ department: d })}>
                  <Pencil /> Editar
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {dialog && <DepartmentDialog open onOpenChange={(o) => !o && setDialog(null)} department={dialog.department} />}
    </section>
  );
}

/* ------------------------------------ Permissões ------------------------------------ */

function PermissionsTab() {
  const access = useAccess();
  const dir = useDirectory();
  const [roleId, setRoleId] = useState(dir.roles[0]?.id ?? "");
  const [draft, setDraft] = useState<Record<string, Permission[]>>({});
  const role = dir.role(roleId);
  // Ambiente real: espelha o servidor (exige organization.admin e que o cargo não tenha permissões que você não tem).
  const lock = isFirebaseMode ? roleAccessLock(access.ctx, role) : access.can("organization.admin") ? undefined : "Seu perfil pode consultar, mas não alterar permissões.";
  const canAdmin = !lock;
  const current = draft[roleId] ?? role?.permissions ?? [];
  const dirty = !!draft[roleId] && JSON.stringify([...draft[roleId]].sort()) !== JSON.stringify([...(role?.permissions ?? [])].sort());
  // Cargo e permissões vão como argumento: um reenvio só reaproveita o identificador da requisição se forem os mesmos.
  const save = useAction((id: string, permissions: Permission[]) => services.organization.updateRole(id, { permissions }), {
    success: "Permissões salvas",
    successDescription: isDemoMode ? "Troque para um perfil com este cargo para ver o efeito." : "Os integrantes com este cargo já recebem o novo acesso.",
    onSuccess: (saved) => setDraft((d) => ({ ...d, [saved.id]: undefined as never })),
  });
  const ownMissing = isFirebaseMode && canAdmin ? missingPermissions(access.ctx, allPermissions()).length : 0;

  if (!role) return <InlineLoader />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Cargos" className="rounded-xl border border-line bg-surface p-2 lg:self-start">
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Cargo" className="h-10 w-full rounded-lg border border-line-strong bg-sunken px-3 text-[14px] lg:hidden">
          {dir.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <ul className="hidden space-y-0.5 lg:block">
          {dir.departments.map((d) => (
            <li key={d.id}>
              <p className="eyebrow px-2.5 pt-3 pb-1.5">{d.name}</p>
              {dir.roles
                .filter((r) => r.departmentId === d.id)
                .map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRoleId(r.id)}
                    aria-pressed={r.id === roleId}
                    className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px]", r.id === roleId ? "bg-gold/10 font-medium text-fg" : "text-fg-muted hover:bg-surface-2")}
                  >
                    <span className="truncate">{r.name}</span>
                    {draft[r.id] && <span className="size-1.5 rounded-full bg-gold" aria-label="Alterações não salvas" />}
                  </button>
                ))}
            </li>
          ))}
        </ul>
      </nav>
      <Panel
        title={`Permissões: ${role.name}`}
        description={`${dir.department(role.departmentId)?.name} · ${ROLE_LEVEL_LABELS[role.level]}${role.isBoard ? " · diretoria" : ""}`}
        actions={
          canAdmin && (
            <>
              {dirty && (
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, [roleId]: undefined as never }))}>
                  <Undo2 /> Desfazer
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={!dirty}
                loading={save.pending}
                onClick={async () => {
                  if (
                    await confirmAction({
                      title: `Salvar permissões de ${role.name}?`,
                      description: `${dir.members.filter((m) => m.roleId === roleId).length} integrante(s) com este cargo serão afetados.${isFirebaseMode ? " O acesso deles muda imediatamente." : ""}`,
                      confirmLabel: "Salvar",
                    })
                  )
                    save.runSafe(roleId, current);
                }}
              >
                <ShieldCheck /> Salvar permissões
              </Button>
            </>
          )
        }
      >
        {lock && (
          <ModeNotice tone="warn" className="mb-4">
            {lock}
          </ModeNotice>
        )}
        {ownMissing > 0 && <Notice className="mb-4">Permissões que o seu cargo não tem aparecem bloqueadas: você só pode conceder ou retirar permissões que o seu cargo tem.</Notice>}
        <PermissionMatrix
          value={current}
          onChange={canAdmin ? (v) => setDraft((d) => ({ ...d, [roleId]: v })) : undefined}
          readOnly={!canAdmin}
          lockReason={isFirebaseMode ? (p, checked) => permissionLock(access.ctx, role, p, checked) : undefined}
        />
        {isDemoMode ? (
          <DemoNotice className="mt-4">
            Permissões simuladas para a demonstração. Elas mudam menus e botões nesta interface, mas não são segurança real — a autorização efetiva será implementada no backend.
          </DemoNotice>
        ) : (
          <Notice className="mt-4">
            As permissões são aplicadas pelo servidor em cada operação e pelas regras de acesso aos dados. Esconder um botão não basta: o que o cargo não tem é recusado no servidor.
          </Notice>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------------- Página --------------------------------------- */

export default function OrganizationPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const org = useOrganization();
  const dir = useDirectory();
  const showInvites = isFirebaseMode && (access.can("organization.create") || access.can("organization.edit"));
  const invitations = useInvitations(showInvites);
  const [inviting, setInviting] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const requested = params.get("aba") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && (requested !== "convites" || showInvites) ? requested : "integrantes";
  const memberId = params.get("integrante");
  const member = dir.member(memberId ?? undefined);
  const memberRole = dir.role(member?.roleId);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const header = (
    <PageHeader
      eyebrow="Administração"
      title="Diretoria e organização"
      description={isDemoMode ? "Integrantes, cargos, departamentos e permissões da Atlética. Todos os nomes são fictícios." : "Integrantes, convites, cargos, departamentos e permissões da Atlética."}
    />
  );
  // Falha ao carregar a estrutura: mostra o erro (e não "sem acesso" ou listas vazias).
  if (org.isError && !org.data)
    return (
      <>
        {header}
        <ErrorState message={errorMessage(org.error, "Não foi possível carregar a estrutura da Atlética.")} onRetry={() => void org.refetch()} />
      </>
    );
  if (!access.canModule("organization")) return <RestrictedState />;

  return (
    <>
      {header}
      <Tabs value={tab} onValueChange={(v) => setParams({ aba: v })}>
        <TabsList>
          <TabsTrigger value="integrantes" count={dir.members.length}>
            <Users /> Integrantes
          </TabsTrigger>
          {showInvites && (
            <TabsTrigger value="convites" count={invitations.data?.filter((i) => i.status === "pending").length}>
              <MailPlus /> Convites
            </TabsTrigger>
          )}
          <TabsTrigger value="cargos" count={dir.roles.length}>
            <ShieldCheck /> Cargos
          </TabsTrigger>
          <TabsTrigger value="departamentos" count={dir.departments.length}>
            <Building2 /> Departamentos
          </TabsTrigger>
          <TabsTrigger value="permissoes">
            <KeyRound /> Permissões
          </TabsTrigger>
        </TabsList>
        <TabsContent value="integrantes" className="mt-5">
          <MembersTab onOpenMember={(id) => setParams({ integrante: id })} />
        </TabsContent>
        {showInvites && (
          <TabsContent value="convites" className="mt-5">
            <InvitationsTab onInvite={() => setInviting(true)} />
            <InviteDialog open={inviting} onOpenChange={setInviting} />
          </TabsContent>
        )}
        <TabsContent value="cargos" className="mt-5">
          <RolesTab />
        </TabsContent>
        <TabsContent value="departamentos" className="mt-5">
          <DepartmentsTab />
        </TabsContent>
        <TabsContent value="permissoes" className="mt-5">
          <PermissionsTab />
        </TabsContent>
      </Tabs>

      <Sheet open={!!member} onOpenChange={(o) => !o && setParams({ integrante: null })}>
        {member && (
          <SheetContent
            eyebrow={isDemoMode ? "Dados fictícios" : undefined}
            title="Perfil do integrante"
            footer={<MemberActions member={member} onEdit={() => setEditingMember(member)} onDeleted={() => setParams({ integrante: null })} />}
          >
            <div className="space-y-6">
              <ProfileHero member={member} role={memberRole} />
              <div>
                <SectionTitle>O que este cargo pode fazer</SectionTitle>
                <AccessCards permissions={memberRole?.permissions ?? []} />
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>
      {editingMember && <MemberDialog open onOpenChange={(o) => !o && setEditingMember(null)} member={editingMember} />}
    </>
  );
}

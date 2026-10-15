"use client";

/**
 * Convites (somente com o Firebase). Integrantes entram na Central por um
 * link de uso único, criado aqui e entregue pela própria pessoa que convidou:
 * o sistema não envia e-mails. O link só é exibido uma vez, logo depois de
 * criado ou renovado (o servidor guarda apenas o hash do token).
 */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, MailPlus, RefreshCw, Send, Undo2 } from "lucide-react";
import type { ID, Invitation, InvitationStatus } from "@/types";
import { services, type InvitationResult, type InviteInput } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { useSession } from "@/stores/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { errorMessage, notifyError } from "@/lib/notify";
import { matchesQuery } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Label, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { confirmAction } from "@/components/shared/confirm";
import { DepartmentChecklist, ErrorLine, Notice, RoleOptions } from "./org-dialogs";
import { assignableRoles, INVITATION_STATUS, renewLock, revokeLock } from "./org-rules";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Lista de convites (exige organization.create ou organization.edit; sem elas, o serviço devolve vazio). */
export function useInvitations(enabled: boolean) {
  const uid = useSession((s) => s.userId) ?? "anon";
  return useQuery({ queryKey: [uid, "invitations"], queryFn: () => services.organization.listInvitations(), enabled: enabled && uid !== "anon", retry: false });
}

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const meta = INVITATION_STATUS[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

/* ------------------------------ Link de uso único ------------------------------ */

/** Exibe o link do convite (uma única vez) com botão de copiar e os cuidados de envio. */
function InvitationLink({ result, onCopied }: { result: InvitationResult; onCopied: () => void }) {
  const dir = useDirectory();
  const linkId = useId();
  const [copied, setCopied] = useState(false);
  const inv = result.invitation;
  const copy = async () => {
    if (!result.link) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      onCopied();
    } catch {
      notifyError(null, "Não foi possível copiar automaticamente. Selecione o link e copie manualmente (Ctrl+C).");
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-sunken px-4 py-3 text-[13px]">
        <p className="font-semibold">{inv.name}</p>
        <p className="text-fg-muted">
          {inv.email} · {dir.role(inv.roleId)?.name ?? "Cargo"}
        </p>
      </div>
      {result.link ? (
        <>
          <div>
            <Label htmlFor={linkId}>Link do convite (uso único)</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id={linkId} readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[12.5px]" />
              <Button variant={copied ? "secondary" : "primary"} onClick={copy} className="shrink-0">
                {copied ? <Check /> : <Copy />} {copied ? "Link copiado" : "Copiar link"}
              </Button>
            </div>
          </div>
          <Notice tone="warn">
            <ul className="space-y-1.5">
              <li>
                <b className="font-semibold text-fg">Este link aparece somente agora.</b> Depois de fechar esta janela não é possível vê-lo de novo. Se ele se perder, use
                “Renovar” na aba Convites (o link anterior deixa de funcionar).
              </li>
              <li>
                Válido até <b className="font-semibold text-fg">{formatDateTime(inv.expiresAt)}</b> e só pode ser usado uma vez.
              </li>
              <li>
                Envie por um canal de confiança, diretamente para a pessoa (por exemplo, mensagem privada). Quem tiver o link pode criar a conta com este cargo.
              </li>
              <li>A Central não envia e-mails: a entrega do link é feita por você.</li>
            </ul>
          </Notice>
        </>
      ) : (
        <Notice tone="warn">
          O convite foi registrado, mas o link não pode ser exibido novamente (a mesma operação foi reenviada). Use “Renovar” na aba Convites para gerar um novo
          link.
        </Notice>
      )}
    </div>
  );
}

/** Pergunta antes de fechar uma janela cujo link ainda não foi copiado. */
async function confirmCloseWithoutCopy() {
  return confirmAction({
    title: "Fechar sem copiar o link?",
    description: "O link não poderá ser exibido de novo. Para enviar o convite depois, será preciso renová-lo.",
    confirmLabel: "Fechar mesmo assim",
    tone: "danger",
  });
}

/** Janela com o link gerado por uma renovação. */
export function InvitationLinkDialog({ result, onClose }: { result: InvitationResult | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const close = async () => {
    if (result?.link && !copied && !(await confirmCloseWithoutCopy())) return;
    setCopied(false);
    onClose();
  };
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && void close()}>
      {result && (
        <DialogContent
          modal
          title="Novo link do convite"
          description="O link anterior deixou de funcionar."
          footer={
            <Button variant="primary" onClick={() => void close()}>
              Concluir
            </Button>
          }
        >
          <InvitationLink result={result} onCopied={() => setCopied(true)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

/* --------------------------------- Convidar --------------------------------- */

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  // Verdadeiro enquanto o link está na tela e ainda não foi copiado.
  const [unsaved, setUnsaved] = useState(false);
  const close = async () => {
    if (unsaved && !(await confirmCloseWithoutCopy())) return;
    setUnsaved(false);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void close())}>
      {open && <InviteBody onClose={() => void close()} onUnsavedChange={setUnsaved} />}
    </Dialog>
  );
}

function InviteBody({ onClose, onUnsavedChange }: { onClose: () => void; onUnsavedChange: (v: boolean) => void }) {
  const access = useAccess();
  const dir = useDirectory();
  const roles = assignableRoles(access.ctx, dir.roles);
  const canDepartments = access.can("organization.admin");
  const [form, setForm] = useState({ name: "", email: "", roleId: "", departmentIds: [] as ID[] });
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<InvitationResult | null>(null);
  const role = dir.role(form.roleId);
  // Os dados vão como argumento: um reenvio só reaproveita o identificador da requisição se forem os mesmos.
  const invite = useAction((input: InviteInput) => services.organization.inviteMember(input), {
      success: "Convite criado",
      silentError: true,
      onSuccess: (res) => {
        setResult(res);
        onUnsavedChange(!!res.link);
      },
  });

  if (result) {
    return (
      <DialogContent
        modal
        title="Convite criado"
        description="Copie o link e envie para a pessoa."
        footer={
          <Button variant="primary" onClick={onClose}>
            Concluir
          </Button>
        }
      >
        <InvitationLink result={result} onCopied={() => onUnsavedChange(false)} />
      </DialogContent>
    );
  }

  const submit = async () => {
    if (form.name.trim().length < 2) return setError("Informe o nome com pelo menos 2 caracteres.");
    if (!EMAIL_RE.test(form.email.trim())) return setError("Informe um e-mail válido.");
    if (!role) return setError("Escolha o cargo.");
    setError(undefined);
    try {
      await invite.run({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        roleId: form.roleId,
        departmentIds: canDepartments ? form.departmentIds.filter((d) => d !== role.departmentId) : [],
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <DialogContent
      modal
      title="Convidar integrante"
      description="A pessoa recebe um link de uso único para criar a própria senha. Nenhum e-mail é enviado pelo sistema."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={invite.pending} disabled={roles.length === 0} onClick={submit}>
            <Send /> Gerar convite
          </Button>
        </>
      }
    >
      {roles.length === 0 ? (
        <Notice tone="warn">Não há cargos ativos que você possa atribuir. Você só pode convidar para cargos cujas permissões o seu cargo também tem.</Notice>
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={form.name} maxLength={100} autoComplete="off" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="E-mail de acesso" required className="sm:col-span-2" hint="A conta será criada com este e-mail. Ele não poderá ser trocado depois pela Central.">
            <Input type="email" value={form.email} maxLength={200} autoComplete="off" onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Cargo" required className="sm:col-span-2" hint="Só aparecem os cargos que você pode atribuir. O departamento vem do cargo.">
            <Select value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
              <option value="">Selecione…</option>
              <RoleOptions roles={roles} />
            </Select>
          </Field>
          {canDepartments && (
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-[13px] font-medium">
                Departamentos adicionais <span className="ml-1 text-xs font-normal text-fg-subtle">(opcional)</span>
              </p>
              <DepartmentChecklist value={form.departmentIds} excludeId={role?.departmentId} onChange={(ids) => setForm((f) => ({ ...f, departmentIds: ids }))} />
            </div>
          )}
          <button type="submit" className="sr-only" tabIndex={-1}>
            Gerar convite
          </button>
        </form>
      )}
      <ErrorLine error={error} />
    </DialogContent>
  );
}

/* ---------------------------------- Lista ---------------------------------- */

type StatusFilter = "all" | InvitationStatus;

export function InvitationsTab({ onInvite }: { onInvite?: () => void }) {
  const access = useAccess();
  const dir = useDirectory();
  const canCreate = access.can("organization.create");
  const { data, isLoading, isError, error, refetch } = useInvitations(canCreate || access.can("organization.edit"));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [renewed, setRenewed] = useState<InvitationResult | null>(null);
  const renew = useAction((id: ID) => services.organization.renewInvitation(id), { success: "Convite renovado", successDescription: "O link anterior deixou de funcionar." });
  const revoke = useAction((id: ID) => services.organization.revokeInvitation(id), { success: "Convite revogado" });
  const [busy, setBusy] = useState<string | null>(null);

  const all = data ?? [];
  const count = (s: InvitationStatus) => all.filter((i) => i.status === s).length;
  const rows = all
    .filter((i) => status === "all" || i.status === status)
    .filter((i) => matchesQuery(query, i.name, i.email, dir.role(i.roleId)?.name))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const onRenew = async (inv: Invitation) => {
    const ok = await confirmAction({
      title: `Renovar o convite de ${inv.name}?`,
      description: "Um novo link será gerado e a validade recomeça a contar. O link anterior deixa de funcionar imediatamente.",
      confirmLabel: "Renovar",
    });
    if (!ok) return;
    setBusy(inv.id);
    const res = await renew.runSafe(inv.id);
    setBusy(null);
    if (res) setRenewed(res);
  };

  const onRevoke = async (inv: Invitation) => {
    const ok = await confirmAction({
      title: `Revogar o convite de ${inv.name}?`,
      description: "O link deixa de funcionar imediatamente. Para convidar a pessoa de novo, crie outro convite.",
      confirmLabel: "Revogar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(inv.id);
    await revoke.runSafe(inv.id);
    setBusy(null);
  };

  const validity = (i: Invitation) => {
    if (i.status === "accepted") return i.acceptedAt ? `Aceito em ${formatDate(i.acceptedAt)}` : "Aceito";
    if (i.status === "revoked") return i.revokedAt ? `Revogado em ${formatDate(i.revokedAt)}` : "Revogado";
    return `${i.status === "expired" ? "Expirou em" : "Até"} ${formatDateTime(i.expiresAt)}`;
  };

  const actions = (i: Invitation) => {
    if (!canCreate) return null;
    const rl = renewLock(access.ctx, i, dir.roles);
    const vl = revokeLock(access.ctx, i);
    if (rl && vl) return null;
    return (
      <div className="flex justify-end gap-1.5">
        <span title={rl}>
          <Button size="sm" variant="ghost" disabled={!!rl || busy === i.id} onClick={() => onRenew(i)}>
            <RefreshCw /> Renovar
          </Button>
        </span>
        <span title={vl}>
          <Button size="sm" variant="ghost" disabled={!!vl || busy === i.id} onClick={() => onRevoke(i)}>
            <Undo2 /> Revogar
          </Button>
        </span>
      </div>
    );
  };

  const columns: Column<Invitation>[] = [
    {
      key: "name",
      header: "Pessoa",
      cell: (i) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{i.name}</p>
          <p className="truncate text-[12px] text-fg-subtle">{i.email}</p>
        </div>
      ),
    },
    { key: "role", header: "Cargo", cell: (i) => <span>{dir.role(i.roleId)?.name ?? "Cargo removido"}</span> },
    { key: "status", header: "Situação", cell: (i) => <InvitationStatusBadge status={i.status} /> },
    { key: "validity", header: "Validade", hideBelow: "lg", cell: (i) => <span className="tnum text-[12.5px] text-fg-muted">{validity(i)}</span> },
    { key: "by", header: "Convidado por", hideBelow: "xl", cell: (i) => <span className="text-fg-muted">{dir.memberName(i.createdBy)}</span> },
    { key: "actions", header: <span className="sr-only">Ações</span>, align: "right", cell: actions },
  ];

  return (
    <section className="rounded-xl border border-line bg-surface">
      <Toolbar>
        <FilterChips
          ariaLabel="Situação do convite"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Todos", count: all.length },
            { value: "pending", label: "Pendentes", count: count("pending") },
            { value: "expired", label: "Expirados", count: count("expired") },
            { value: "accepted", label: "Aceitos", count: count("accepted") },
            { value: "revoked", label: "Revogados", count: count("revoked") },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar nome, e-mail ou cargo" className="w-full sm:w-64" />
          {canCreate && onInvite && (
            <Button variant="primary" onClick={onInvite}>
              <MailPlus /> Convidar
            </Button>
          )}
        </div>
      </Toolbar>
      <p className="border-b border-line px-4 py-2.5 text-[12.5px] text-fg-muted sm:px-5">
        Convites são de uso único e expiram. A Central não envia e-mails: o link é entregue por quem convidou, por um canal de confiança.
      </p>
      {isError && data && (
        <Notice tone="warn" className="mx-4 mt-3 sm:mx-5">
          Não foi possível atualizar a lista ({errorMessage(error)}). Exibindo os convites carregados anteriormente.
        </Notice>
      )}
      {isError && !data ? (
        <ErrorState message={errorMessage(error, "Não foi possível carregar os convites.")} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          caption="Convites"
          rows={rows}
          columns={columns}
          loading={isLoading}
          getRowId={(i) => i.id}
          mobileCard={(i) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{i.name}</p>
                  <p className="truncate text-[12px] text-fg-subtle">
                    {i.email} · {dir.role(i.roleId)?.name ?? "Cargo removido"}
                  </p>
                  <p className="text-[12px] text-fg-muted">{validity(i)}</p>
                </div>
                <InvitationStatusBadge status={i.status} />
              </div>
              {actions(i)}
            </div>
          )}
          empty={
            all.length === 0 ? (
              <EmptyState
                compact
                icon={<MailPlus />}
                title="Nenhum convite"
                description="Os convites criados aparecem aqui, com a situação e a validade de cada um."
                action={
                  canCreate && onInvite ? (
                    <Button variant="primary" onClick={onInvite}>
                      <MailPlus /> Convidar integrante
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState compact icon={<MailPlus />} title="Nenhum convite encontrado" description="Ajuste o filtro ou a busca." />
            )
          }
        />
      )}
      <InvitationLinkDialog result={renewed} onClose={() => setRenewed(null)} />
    </section>
  );
}

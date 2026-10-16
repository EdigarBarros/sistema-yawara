"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw, ScrollText, X } from "lucide-react";
import type { AuditLogEntry, AuditOutcome, AuditQuery } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useDirectory } from "@/hooks/use-data";
import { useSession } from "@/stores/session";
import { MODULES } from "@/lib/modules";
import { formatDateTime } from "@/lib/format";
import { errorMessage } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import type { Tone } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { PageHeader } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterSelect, Toolbar } from "@/components/shared/filters";
import { DemoNotice, EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { moduleLabel, resourceLabel } from "./audit-labels";

/** Registros por página (cursor). */
const PAGE_SIZE = 50;

type FilterField = "module" | "actorId" | "outcome" | "resourceId";
type ActiveFilter = { field: FilterField; value: string } | null;

const OUTCOMES: Record<AuditOutcome, { label: string; tone: Tone }> = {
  success: { label: "Sucesso", tone: "ok" },
  denied: { label: "Recusada", tone: "danger" },
  failed: { label: "Falhou", tone: "warn" },
};

/** Nomes legíveis das operações (a parte depois do ponto em "modulo.acao"). */
const ACTION_LABELS: Record<string, string> = {
  // Servidor (Cloud Functions)
  create: "Criação",
  update: "Edição",
  export: "Exportação",
  archive: "Arquivamento",
  restore: "Restauração",
  approve: "Aprovação",
  setStatus: "Mudança de situação",
  setAccess: "Mudança de acesso",
  addVersion: "Nova versão",
  duplicate: "Duplicação",
  close: "Encerramento",
  reopen: "Reabertura",
  recount: "Conferência de totais",
  registerSale: "Registro de venda",
  updateSale: "Edição de venda",
  setSaleStatus: "Mudança de situação da venda",
  confirmPayment: "Confirmação de pagamento",
  revertPayment: "Confirmação de pagamento desfeita",
  cancelSale: "Cancelamento de venda",
  releaseSale: "Liberação de números",
  addTask: "Tarefa adicionada",
  updateTask: "Tarefa alterada",
  addScheduleItem: "Programação: item adicionado",
  removeScheduleItem: "Programação: item removido",
  addSupplier: "Fornecedor adicionado",
  updateSupplier: "Fornecedor alterado",
  addAttendee: "Participante adicionado",
  setAttendance: "Presença registrada",
  addSpeaker: "Palestrante adicionado",
  removeSpeaker: "Palestrante removido",
  setCertificateStatus: "Situação dos certificados",
  linkDocument: "Documento vinculado",
  addFiles: "Arquivos adicionados",
  attachReceipt: "Comprovante anexado",
  createRole: "Cargo criado",
  updateRole: "Cargo alterado",
  createDepartment: "Departamento criado",
  updateDepartment: "Departamento alterado",
  updateMember: "Integrante alterado",
  inviteMember: "Convite enviado",
  renewInvitation: "Convite renovado",
  revokeInvitation: "Convite revogado",
  acceptInvitation: "Convite aceito",
  signIn: "Início de sessão",
  updateInstitution: "Dados institucionais alterados",
  setModuleEnabled: "Módulo ativado ou desativado",
  createDocumentCategory: "Categoria de documento criada",
  renameDocumentCategory: "Categoria de documento renomeada",
  createFinanceCategory: "Categoria financeira criada",
  renameFinanceCategory: "Categoria financeira renomeada",
  // Demonstração (históricos dos registros)
  created: "Criação",
  updated: "Edição",
  status: "Mudança de situação",
  shared: "Compartilhamento",
  archived: "Arquivamento",
  restored: "Restauração",
  sale: "Venda",
  payment: "Pagamento",
  cancelled: "Cancelamento",
  released: "Liberação",
  closed: "Encerramento",
  reopened: "Reabertura",
  version: "Nova versão",
  duplicated: "Duplicação",
  attachment: "Anexo",
};

function actionLabel(action: string) {
  const verb = action.includes(".") ? action.slice(action.indexOf(".") + 1) : action;
  return ACTION_LABELS[verb] ?? action;
}

/** Link para o registro, quando ele tem página própria (o acesso é conferido na própria página). */
function resourceHref(e: AuditLogEntry): string | null {
  if (!e.resourceId) return null;
  const id = encodeURIComponent(e.resourceId);
  switch (e.resourceType) {
    case "campaign":
      return `/campanhas/${id}`;
    case "event":
      return `/eventos/${id}`;
    case "document":
      return `/documentos/${id}`;
    case "meeting":
      return `/secretaria/${id}`;
    case "project":
      return `/extensao/${id}`;
    case "content":
      return `/marketing?item=${id}`;
    case "financeEntry":
      return `/financeiro/lancamentos?id=${id}`;
    default:
      return null;
  }
}

function toQuery(filter: ActiveFilter): AuditQuery {
  if (!filter) return {};
  switch (filter.field) {
    case "module":
      return { module: filter.value as AuditQuery["module"] };
    case "actorId":
      return { actorId: filter.value };
    case "outcome":
      return { outcome: filter.value as AuditOutcome };
    case "resourceId":
      return { resourceId: filter.value };
  }
}

export default function AuditPage() {
  const access = useAccess();
  const dir = useDirectory();
  const uid = useSession((s) => s.userId) ?? "anon";
  const allowed = access.can("audit.view");
  const [filter, setFilter] = useState<ActiveFilter>(null);

  const audit = useInfiniteQuery({
    queryKey: [uid, "audit", filter?.field ?? "", filter?.value ?? ""],
    queryFn: ({ pageParam }) => services.audit.list({ ...toQuery(filter), after: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
    retry: false,
  });

  if (!allowed) {
    return (
      <RestrictedState
        title="Auditoria disponível só para quem tem a permissão"
        description={
          isDemoMode
            ? undefined
            : "A auditoria exige a permissão “Consultar a auditoria”. Se precisar de acesso, fale com a presidência."
        }
      />
    );
  }

  const rows = audit.data?.pages.flatMap((p) => p.entries) ?? [];
  const valueOf = (field: FilterField) => (filter?.field === field ? filter.value : "");
  const choose = (field: FilterField) => (value: string) => setFilter(value ? { field, value } : null);

  const authorName = (e: AuditLogEntry) => {
    if (!e.actorId) return e.actorName || "Sistema";
    return dir.member(e.actorId)?.name ?? (e.actorName || "Integrante removido");
  };

  const resourceCell = (e: AuditLogEntry) => {
    const label = resourceLabel(e);
    if (!e.resourceId) return <span className="text-fg-muted">{label}</span>;
    const href = resourceHref(e);
    return (
      <span className="flex min-w-0 flex-col">
        {href ? (
          <Link href={href} onClick={(ev) => ev.stopPropagation()} className="truncate text-fg hover:text-gold-fg hover:underline">
            {label}
          </Link>
        ) : (
          <span className="truncate">{label}</span>
        )}
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            setFilter({ field: "resourceId", value: e.resourceId! });
          }}
          title="Ver só os registros deste item"
          className="max-w-[180px] truncate text-left font-mono text-[11px] text-fg-subtle hover:text-fg"
        >
          {e.resourceId}
        </button>
      </span>
    );
  };

  const outcomeBadge = (e: AuditLogEntry) => {
    const meta = OUTCOMES[e.outcome] ?? { label: e.outcome, tone: "neutral" as Tone };
    return (
      <Badge tone={meta.tone} dot>
        {meta.label}
      </Badge>
    );
  };

  const columns: Column<AuditLogEntry>[] = [
    { key: "at", header: "Data e hora", className: "whitespace-nowrap tnum text-fg-muted", cell: (e) => formatDateTime(e.at) },
    { key: "actor", header: "Autor", cell: (e) => <span className="font-medium">{authorName(e)}</span> },
    { key: "module", header: "Módulo", hideBelow: "lg", cell: (e) => <span className="text-fg-muted">{moduleLabel(e.module)}</span> },
    { key: "action", header: "Ação", cell: (e) => <span title={e.action}>{actionLabel(e.action)}</span> },
    { key: "resource", header: "Registro", hideBelow: "xl", cell: resourceCell },
    { key: "summary", header: "Resumo", cell: (e) => <span className="line-clamp-2 max-w-[420px] text-[13px] text-fg-muted">{e.summary}</span> },
    { key: "outcome", header: "Resultado", cell: outcomeBadge },
  ];

  const memberOptions = [...dir.members].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((m) => ({ value: m.id, label: m.name }));

  return (
    <>
      <PageHeader
        eyebrow="Administração"
        title="Auditoria"
        description={
          isDemoMode
            ? "Histórico das operações importantes: quem fez, quando, em qual módulo e com qual resultado."
            : "Registro oficial das operações importantes, gravado pelo servidor com autor verificado e horário do servidor. Não pode ser alterado nem apagado pela Central."
        }
        actions={
          <Button variant="secondary" loading={audit.isRefetching && !audit.isFetchingNextPage} onClick={() => void audit.refetch()}>
            <RotateCcw /> Atualizar
          </Button>
        }
      />

      {isDemoMode && (
        <DemoNotice className="mb-5">
          Demonstração: esta lista é montada a partir dos históricos dos registros fictícios deste navegador. No ambiente real, a auditoria oficial vem do
          servidor (Cloud Functions), inclui tentativas recusadas, inícios de sessão e exportações, e não pode ser alterada.
        </DemoNotice>
      )}

      <section className="rounded-xl border border-line bg-surface">
        <Toolbar>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <FilterSelect
              label="Módulo"
              value={valueOf("module")}
              onChange={choose("module")}
              options={[{ value: "", label: "Todos os módulos" }, ...MODULES.map((m) => ({ value: m.key, label: m.label })), { value: "auth", label: "Acesso e contas" }]}
            />
            <FilterSelect label="Autor" value={valueOf("actorId")} onChange={choose("actorId")} options={[{ value: "", label: "Todos os autores" }, ...memberOptions]} />
            <FilterSelect
              label="Resultado"
              value={valueOf("outcome")}
              onChange={choose("outcome")}
              options={[{ value: "", label: "Todos os resultados" }, ...Object.entries(OUTCOMES).map(([value, o]) => ({ value, label: o.label }))]}
            />
            {filter?.field === "resourceId" && (
              <Badge tone="gold" className="h-8 gap-2 pr-1">
                Registro {filter.value}
                <button type="button" onClick={() => setFilter(null)} aria-label="Remover filtro de registro" className="grid size-5 place-items-center rounded-full hover:bg-gold/20">
                  <X className="size-3" />
                </button>
              </Badge>
            )}
          </div>
          <p className="text-[12px] text-fg-subtle lg:max-w-[260px] lg:text-right">Um filtro por vez: ao escolher outro, o anterior é substituído.</p>
        </Toolbar>

        {audit.isError && !audit.data ? (
          <ErrorState message={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Registros de auditoria"
              rows={rows}
              columns={columns}
              loading={audit.isPending}
              pageSize={10_000}
              getRowId={(e) => e.id}
              rowClassName={(e) => (e.outcome !== "success" ? "bg-danger/[0.03]" : undefined)}
              mobileCard={(e) => (
                <div className="min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold">{actionLabel(e.action)}</p>
                    {outcomeBadge(e)}
                  </div>
                  <p className="text-[12px] text-fg-subtle">
                    {formatDateTime(e.at)} · {authorName(e)} · {moduleLabel(e.module)}
                  </p>
                  <p className="line-clamp-2 text-[12.5px] text-fg-muted">{e.summary}</p>
                </div>
              )}
              empty={
                <EmptyState
                  icon={<ScrollText />}
                  title="Nenhum registro encontrado"
                  description={filter ? "Nenhuma operação corresponde ao filtro escolhido." : "As operações importantes aparecem aqui assim que forem realizadas."}
                  action={
                    filter && (
                      <Button variant="secondary" size="sm" onClick={() => setFilter(null)}>
                        Limpar filtro
                      </Button>
                    )
                  }
                />
              }
            />
            {audit.isFetchNextPageError && (
              <p role="alert" className="flex items-center justify-center gap-2 border-t border-line px-4 py-3 text-[12.5px] text-danger">
                <AlertTriangle className="size-4" aria-hidden /> {errorMessage(audit.error)}
              </p>
            )}
            {audit.hasNextPage && (
              <div className="flex justify-center border-t border-line px-4 py-3">
                <Button variant="secondary" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
                  Carregar mais
                </Button>
              </div>
            )}
            {rows.length > 0 && !audit.hasNextPage && !audit.isPending && (
              <p className="border-t border-line px-4 py-3 text-center text-[12px] text-fg-subtle">
                {rows.length === 1 ? "1 registro" : `${rows.length} registros`} · fim da lista
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

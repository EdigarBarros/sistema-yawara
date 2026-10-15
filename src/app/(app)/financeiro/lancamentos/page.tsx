"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MinusCircle, Paperclip, PlusCircle, Receipt } from "lucide-react";
import type { EntryStatus, EntryType, FinanceEntry } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useFinanceCategories, useFinanceEntries } from "@/hooks/use-data";
import { ENTRY_TYPE_LABELS, entryStatusMeta } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { cn, matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { FinanceNav } from "@/features/finance/finance-nav";
import { EntryFormDialog } from "@/features/finance/entry-form-dialog";
import { EntrySheet } from "@/features/finance/entry-sheet";
import { summarizeFinance } from "@/features/finance/utils";

export default function EntriesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("finance");
  const { data, isLoading, isError, error, refetch } = useFinanceEntries(enabled);
  const { data: categories } = useFinanceCategories();
  const [type, setType] = useState<"all" | EntryType>("all");
  const [status, setStatus] = useState<"" | EntryStatus>("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  const selectedId = params.get("id");
  const newType = params.get("novo") as EntryType | null;
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete("id");
    next.delete("novo");
    if (value) next.set(key, value);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  if (!enabled) return <RestrictedState />;

  const rows = (data ?? [])
    .filter((e) => type === "all" || e.type === type)
    .filter((e) => !status || e.status === status)
    .filter((e) => !category || e.categoryId === category)
    .filter((e) => matchesQuery(query, e.description, e.code, e.notes))
    .sort((a, b) => b.date.localeCompare(a.date));
  const totals = summarizeFinance(rows);
  const selected = (data ?? []).find((e) => e.id === selectedId) ?? null;
  const catName = (id: string) => categories?.find((c) => c.id === id)?.name ?? "—";

  const columns: Column<FinanceEntry>[] = [
    { key: "date", header: "Data", cell: (e) => <span className="tnum font-mono text-[12.5px] text-fg-muted">{formatDate(e.date)}</span> },
    {
      key: "desc",
      header: "Descrição",
      cell: (e) => (
        <div className="min-w-0">
          <p className={cn("truncate font-medium", e.status === "cancelled" && "text-fg-subtle line-through")}>{e.description}</p>
          <p className="truncate text-[12px] text-fg-subtle">
            {e.code} · {catName(e.categoryId)}
          </p>
        </div>
      ),
    },
    { key: "dep", header: "Departamento", hideBelow: "xl", cell: (e) => <span className="text-fg-muted">{dir.department(e.departmentId)?.name}</span> },
    { key: "resp", header: "Responsável", hideBelow: "lg", cell: (e) => <span className="text-fg-muted">{dir.memberName(e.responsibleId)}</span> },
    {
      key: "receipt",
      header: <span className="sr-only">Comprovante</span>,
      hideBelow: "lg",
      cell: (e) => (e.receipt ? <Paperclip className="size-4 text-fg-subtle" aria-label="Com comprovante" /> : null),
    },
    { key: "status", header: "Situação", cell: (e) => <StatusBadge meta={entryStatusMeta(e.type, e.status)} /> },
    {
      key: "amount",
      header: "Valor",
      align: "right",
      cell: (e) => (
        <span className={cn("tnum font-mono text-[13px] font-semibold whitespace-nowrap", e.type === "income" ? "text-ok" : "text-fg", e.status === "cancelled" && "line-through opacity-50")}>
          {e.type === "income" ? "+" : "−"} {formatMoney(e.amount)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Lançamentos"
        description={
          isDemoMode
            ? "Receitas e despesas de demonstração. Clique em um lançamento para consultar, editar ou confirmar."
            : "Receitas e despesas registradas pelo Financeiro. Clique em um lançamento para consultar, editar ou confirmar."
        }
        actions={
          access.can("finance.register") && (
            <>
              <Button onClick={() => setParam("novo", "expense")}>
                <MinusCircle /> Nova despesa
              </Button>
              <Button variant="primary" onClick={() => setParam("novo", "income")}>
                <PlusCircle /> Nova receita
              </Button>
            </>
          )
        }
      />
      <FinanceNav />
      <section className="rounded-xl border border-line bg-surface">
        <Toolbar>
          <FilterChips
            ariaLabel="Tipo"
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "Todos", count: data?.length },
              { value: "income", label: "Receitas", count: data?.filter((e) => e.type === "income").length },
              { value: "expense", label: "Despesas", count: data?.filter((e) => e.type === "expense").length },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              label="Situação"
              value={status}
              onChange={(v) => setStatus(v as EntryStatus | "")}
              options={[
                { value: "", label: "Todas as situações" },
                { value: "pending", label: "Pendentes" },
                { value: "settled", label: "Realizados" },
                { value: "cancelled", label: "Cancelados" },
              ]}
            />
            <FilterSelect
              label="Categoria"
              value={category}
              onChange={setCategory}
              options={[{ value: "", label: "Todas as categorias" }, ...(categories ?? []).filter((c) => type === "all" || c.type === type).map((c) => ({ value: c.id, label: `${c.name} (${ENTRY_TYPE_LABELS[c.type]})` }))]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar descrição ou código" className="w-full sm:w-60" />
          </div>
        </Toolbar>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-5 py-2.5 text-[12.5px] text-fg-muted">
          <span>
            {rows.length} lançamento(s) · Recebido <b className="tnum font-mono text-ok">{formatMoney(totals.income)}</b>
          </span>
          <span>
            Pago <b className="tnum font-mono text-fg">{formatMoney(totals.expense)}</b>
          </span>
          <span>
            Pendente <b className="tnum font-mono text-warn">{formatMoney(totals.receivable + totals.payable)}</b>
          </span>
        </div>
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : (
          <DataTable
            caption="Lançamentos financeiros"
            rows={rows}
            columns={columns}
            loading={isLoading}
            getRowId={(e) => e.id}
            onRowClick={(e) => setParam("id", e.id)}
            mobileCard={(e) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.description}</p>
                  <p className="text-[12px] text-fg-subtle">
                    {formatDate(e.date)} · {catName(e.categoryId)}
                  </p>
                  <div className="mt-1.5">
                    <StatusBadge meta={entryStatusMeta(e.type, e.status)} />
                  </div>
                </div>
                <span className={cn("tnum font-mono text-[13px] font-semibold whitespace-nowrap", e.type === "income" ? "text-ok" : "text-fg")}>
                  {e.type === "income" ? "+" : "−"} {formatMoney(e.amount)}
                </span>
              </div>
            )}
            empty={<EmptyState icon={<Receipt />} title="Nenhum lançamento encontrado" description="Ajuste os filtros ou registre uma movimentação." />}
          />
        )}
      </section>
      <EntrySheet entry={selected} onOpenChange={(o) => !o && setParam("id", null)} />
      <EntryFormDialog
        open={!!newType && access.can("finance.register")}
        onOpenChange={(o) => !o && setParam("novo", null)}
        type={newType === "expense" ? "expense" : "income"}
        onSaved={(e) => setTimeout(() => setParam("id", e.id), 50)}
      />
    </>
  );
}

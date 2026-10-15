"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilePlus2, FileText, FolderOpen, LayoutGrid, List } from "lucide-react";
import type { InstitutionalDocument } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useDocumentCategories, useDocuments } from "@/hooks/use-data";
import { DOCUMENT_STATUS } from "@/lib/labels";
import { fileExtension, formatDate, formatRelative } from "@/lib/format";
import { cn, matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/form";
import { PageHeader } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, FilterSelect, SearchInput } from "@/components/shared/filters";
import { EmptyState, ErrorState, RestrictedState, TableSkeleton } from "@/components/shared/states";
import { DemoTag, OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { describeAudience } from "@/components/shared/audience";
import { AddDocumentDialog } from "@/features/documents/document-form-dialog";

type StatusFilter = "active" | "archived" | "all";

function DocIcon({ doc }: { doc: InstitutionalDocument }) {
  const file = doc.versions.at(-1)?.file;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 font-mono text-[10px] font-semibold text-gold-fg">
      {file ? fileExtension(file.name).slice(0, 4) : <FileText className="size-4 text-fg-subtle" />}
    </span>
  );
}

export default function DocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("documents");
  const { data, isLoading, isError, error, refetch } = useDocuments(enabled);
  const { data: categories, isError: categoriesFailed, refetch: refetchCategories } = useDocumentCategories();
  const [category, setCategory] = useState("");
  const [dep, setDep] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [sort, setSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "cards">("list");
  const createOpen = params.get("novo") === "1" && access.can("documents.create");
  const setCreateOpen = (o: boolean) => router.replace(o ? `${pathname}?novo=1` : pathname, { scroll: false });

  if (!enabled) return <RestrictedState />;

  const catName = (id: string) => categories?.find((c) => c.id === id)?.name ?? "—";
  const base = (data ?? []).filter((d) => (status === "all" ? true : status === "archived" ? d.status === "archived" : d.status !== "archived"));
  const rows = base
    .filter((d) => !category || d.categoryId === category)
    .filter((d) => !dep || d.departmentId === dep)
    .filter((d) => matchesQuery(query, d.name, d.description, catName(d.categoryId), d.versions.at(-1)?.file?.name))
    .sort((a, b) => (sort === "recent" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "oldest" ? a.updatedAt.localeCompare(b.updatedAt) : a.name.localeCompare(b.name)));

  const columns: Column<InstitutionalDocument>[] = [
    {
      key: "name",
      header: "Documento",
      cell: (d) => (
        <div className="flex items-center gap-3">
          <DocIcon doc={d} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold">
              <span className="truncate">{d.name}</span>
              {d.sample && <DemoTag />}
            </p>
            <p className="truncate text-[12px] text-fg-subtle">{catName(d.categoryId)}</p>
          </div>
        </div>
      ),
    },
    { key: "dep", header: "Departamento", hideBelow: "lg", cell: (d) => <span className="text-fg-muted">{dir.department(d.departmentId)?.name}</span> },
    {
      key: "author",
      header: "Envio",
      hideBelow: "xl",
      cell: (d) => (
        <div className="text-[12.5px]">
          <p>{dir.memberName(d.versions.at(-1)?.uploadedBy)}</p>
          <p className="text-fg-subtle">{formatDate(d.updatedAt)}</p>
        </div>
      ),
    },
    { key: "version", header: "Versão", hideBelow: "lg", cell: (d) => <span className="font-mono text-[12.5px] text-fg-muted">v{d.versions.length}</span> },
    { key: "access", header: "Visibilidade", hideBelow: "xl", cell: (d) => <span className="line-clamp-2 text-[12.5px] text-fg-muted">{describeAudience(d.access, dir)}</span> },
    {
      key: "status",
      header: "Situação",
      cell: (d) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge meta={DOCUMENT_STATUS[d.status]} />
          <span className="hidden lg:inline">
            <OwnershipBadge record={d} />
          </span>
        </div>
      ),
    },
  ];

  const counts = (id: string) => base.filter((d) => d.categoryId === id).length;

  return (
    <>
      <PageHeader
        eyebrow="Biblioteca institucional"
        title="Documentos"
        description="Estatuto, atas, relatórios, contratos e materiais da Atlética. Você vê apenas o que foi compartilhado com o seu perfil."
        actions={
          access.can("documents.create") && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <FilePlus2 /> Adicionar documento
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Categorias" className="hidden lg:block">
          <p className="eyebrow mb-2 px-3">Categorias</p>
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                onClick={() => setCategory("")}
                className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]", !category ? "bg-gold/10 font-medium text-fg" : "text-fg-muted hover:bg-surface")}
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="size-4" /> Todas
                </span>
                <span className="font-mono text-[11px] text-fg-subtle">{base.length}</span>
              </button>
            </li>
            {categories?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setCategory(c.id)}
                  aria-pressed={category === c.id}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px]",
                    category === c.id ? "bg-gold/10 font-medium text-fg" : "text-fg-muted hover:bg-surface",
                  )}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="font-mono text-[11px] text-fg-subtle">{counts(c.id)}</span>
                </button>
              </li>
            ))}
          </ul>
          {categoriesFailed && (
            <p role="alert" className="mt-2 px-3 text-[12px] text-danger">
              Não foi possível carregar as categorias.{" "}
              <button type="button" onClick={() => refetchCategories()} className="font-semibold underline-offset-2 hover:underline">
                Tentar novamente
              </button>
            </p>
          )}
        </nav>

        <section className="min-w-0 rounded-xl border border-line bg-surface">
          <div className="space-y-3 border-b border-line px-4 py-3.5 sm:px-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <FilterChips
                ariaLabel="Situação"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "active", label: "Vigentes e em elaboração", count: (data ?? []).filter((d) => d.status !== "archived").length },
                  { value: "archived", label: "Arquivados", count: (data ?? []).filter((d) => d.status === "archived").length },
                  { value: "all", label: "Todos", count: data?.length ?? 0 },
                ]}
              />
              <Segmented
                ariaLabel="Visualização"
                value={view}
                onChange={setView}
                options={[
                  { value: "list", label: "Lista", icon: <List /> },
                  { value: "cards", label: "Cartões", icon: <LayoutGrid /> },
                ]}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterSelect
                label="Categoria"
                value={category}
                onChange={setCategory}
                className="lg:hidden"
                options={[{ value: "", label: "Todas as categorias" }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              />
              <FilterSelect label="Departamento" value={dep} onChange={setDep} options={[{ value: "", label: "Todos os departamentos" }, ...dir.departments.map((d) => ({ value: d.id, label: d.name }))]} />
              <FilterSelect
                label="Ordenação"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "recent", label: "Mais recentes" },
                  { value: "oldest", label: "Mais antigos" },
                  { value: "name", label: "Nome (A–Z)" },
                ]}
              />
              <SearchInput value={query} onChange={setQuery} placeholder="Buscar documento" className="w-full sm:w-60" />
            </div>
          </div>

          {isError ? (
            <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
          ) : view === "list" ? (
            <DataTable
              caption="Documentos"
              rows={rows}
              columns={columns}
              loading={isLoading}
              getRowId={(d) => d.id}
              onRowClick={(d) => router.push(`/documentos/${d.id}`)}
              mobileCard={(d) => (
                <div className="flex items-center gap-3">
                  <DocIcon doc={d} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{d.name}</p>
                    <p className="truncate text-[12px] text-fg-subtle">
                      {catName(d.categoryId)} · v{d.versions.length} · {formatRelative(d.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge meta={DOCUMENT_STATUS[d.status]} />
                </div>
              )}
              empty={<EmptyState icon={<FileText />} title="Nenhum documento encontrado" description="Ajuste a busca, a categoria ou os filtros." />}
            />
          ) : isLoading ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState icon={<FileText />} title="Nenhum documento encontrado" description="Ajuste a busca, a categoria ou os filtros." />
          ) : (
            <ul className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
              {rows.map((d) => (
                <li key={d.id}>
                  <Link href={`/documentos/${d.id}`} className="flex h-full flex-col gap-3 rounded-xl border border-line bg-sunken p-4 transition-colors hover:border-gold/40">
                    <div className="flex items-start justify-between gap-3">
                      <DocIcon doc={d} />
                      <StatusBadge meta={DOCUMENT_STATUS[d.status]} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-semibold">{d.name}</p>
                      <p className="mt-1 line-clamp-2 text-[12.5px] text-fg-muted">{d.description}</p>
                    </div>
                    <p className="text-[12px] text-fg-subtle">
                      {catName(d.categoryId)} · v{d.versions.length} · {formatRelative(d.updatedAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <AddDocumentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TableSkeleton } from "./states";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Esconde a coluna em telas menores (a informação aparece no cartão móvel). */
  hideBelow?: "lg" | "xl";
  align?: "left" | "right";
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Renderização em cartão para celulares. Sem ela, a tabela rola na horizontal. */
  mobileCard?: (row: T) => ReactNode;
  loading?: boolean;
  empty?: ReactNode;
  pageSize?: number;
  caption?: string;
  rowClassName?: (row: T) => string | undefined;
}

/** Tabela padrão: legível no computador e em cartões no celular, com paginação simples. */
export function DataTable<T>({
  rows,
  columns,
  getRowId,
  onRowClick,
  mobileCard,
  loading,
  empty,
  pageSize = 20,
  caption,
  rowClassName,
}: DataTableProps<T>) {
  const [rawPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // Se o filtro reduzir a lista, volta para a última página válida.
  const page = Math.min(rawPage, pageCount - 1);

  if (loading) return <TableSkeleton columns={Math.min(columns.length, 5)} />;
  if (rows.length === 0) return <>{empty}</>;

  const visible = rows.slice(page * pageSize, page * pageSize + pageSize);
  const onKey = (row: T) => (e: KeyboardEvent) => {
    if (onRowClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div>
      <div className={cn(mobileCard && "hidden md:block", "overflow-x-auto")}>
        <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-4 py-2.5 text-[11.5px] font-semibold tracking-wide whitespace-nowrap text-fg-subtle uppercase first:pl-5 last:pr-5",
                    c.align === "right" && "text-right",
                    c.hideBelow === "lg" && "hidden lg:table-cell",
                    c.hideBelow === "xl" && "hidden xl:table-cell",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? onKey(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  "border-b border-line last:border-b-0",
                  onRowClick && "cursor-pointer transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-4 py-3 align-middle first:pl-5 last:pr-5",
                      c.align === "right" && "text-right",
                      c.hideBelow === "lg" && "hidden lg:table-cell",
                      c.hideBelow === "xl" && "hidden xl:table-cell",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mobileCard && (
        <ul className="divide-y divide-line md:hidden">
          {visible.map((row) => (
            <li key={getRowId(row)}>
              {onRowClick ? (
                <button type="button" onClick={() => onRowClick(row)} className="block w-full px-4 py-3.5 text-left active:bg-surface-2">
                  {mobileCard(row)}
                </button>
              ) : (
                <div className="px-4 py-3.5">{mobileCard(row)}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[12.5px] text-fg-muted sm:px-5">
          <span className="tnum">
            {page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} de {rows.length}
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="icon-sm" variant="ghost" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
            </Button>
            <span className="tnum px-1">
              {page + 1}/{pageCount}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label="Próxima página" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

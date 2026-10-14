"use client";

import { useMemo, useState } from "react";
import { Lock, Receipt } from "lucide-react";
import type { Campaign, Sale, SaleStatus } from "@/types";
import { useDirectory } from "@/hooks/use-data";
import { PAYMENT_METHOD_LABELS, SALE_STATUS } from "@/lib/labels";
import { formatDateTimeShort, formatMoney } from "@/lib/format";
import { formatNumberRanges } from "@/lib/raffle";
import { matchesQuery } from "@/lib/utils";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterChips, SearchInput, Toolbar } from "@/components/shared/filters";
import { StatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/states";

/** Lista de vendas da campanha (inclui canceladas, que nunca são apagadas). */
export function SalesTable({ campaign, sales, onOpen }: { campaign: Campaign; sales: Sale[]; onOpen: (n: number) => void }) {
  const dir = useDirectory();
  const [filter, setFilter] = useState<"all" | SaleStatus>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      sales
        .filter((s) => filter === "all" || s.status === filter)
        .filter((s) => matchesQuery(query, s.buyer?.name, s.buyer?.contact, dir.memberName(s.sellerId), s.numbers.join(" ")))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sales, filter, query, dir],
  );
  const count = (f: "all" | SaleStatus) => (f === "all" ? sales.length : sales.filter((s) => s.status === f).length);

  const columns: Column<Sale>[] = [
    { key: "numbers", header: "Números", cell: (s) => <span className="font-mono text-[13px] font-medium">{formatNumberRanges(s.numbers, campaign.quantity)}</span> },
    {
      key: "buyer",
      header: "Comprador",
      cell: (s) =>
        s.buyer ? (
          <span>{s.buyer.name}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-fg-subtle">
            <Lock className="size-3.5" /> Restrito
          </span>
        ),
    },
    { key: "seller", header: "Responsável", hideBelow: "lg", cell: (s) => <span className="text-fg-muted">{dir.memberName(s.sellerId)}</span> },
    { key: "date", header: "Registro", hideBelow: "xl", cell: (s) => <span className="tnum font-mono text-[12px] text-fg-muted">{formatDateTimeShort(s.createdAt)}</span> },
    {
      key: "payment",
      header: "Pagamento",
      hideBelow: "lg",
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          {s.paymentMethod ? PAYMENT_METHOD_LABELS[s.paymentMethod] : "—"}
          {s.receipt && <Receipt className="size-3.5 text-fg-subtle" aria-label="Com comprovante" />}
        </span>
      ),
    },
    { key: "value", header: "Valor", align: "right", cell: (s) => <span className="tnum font-mono text-[12.5px]">{formatMoney(s.numbers.length * campaign.unitPrice)}</span> },
    {
      key: "status",
      header: "Situação",
      cell: (s) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge meta={SALE_STATUS[s.status]} />
          {s.status === "cancelled" && <span className="text-[11px] text-fg-subtle">{s.releasedAt ? "Números liberados" : "Números bloqueados"}</span>}
        </span>
      ),
    },
  ];

  return (
    <section className="rounded-xl border border-line bg-surface">
      <Toolbar>
        <FilterChips
          ariaLabel="Filtrar vendas"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Todas", count: count("all") },
            { value: "pending", label: "Pendentes", count: count("pending") },
            { value: "paid", label: "Pagas", count: count("paid") },
            { value: "reserved", label: "Reservas", count: count("reserved") },
            { value: "cancelled", label: "Canceladas", count: count("cancelled") },
          ]}
        />
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar comprador, vendedor ou número" className="lg:w-72" />
      </Toolbar>
      <DataTable
        caption="Vendas da campanha"
        rows={rows}
        columns={columns}
        getRowId={(s) => s.id}
        onRowClick={(s) => onOpen(s.numbers[0])}
        mobileCard={(s) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[13px] font-semibold">{formatNumberRanges(s.numbers, campaign.quantity)}</p>
              <p className="truncate text-[12.5px] text-fg-muted">{s.buyer?.name ?? "Comprador restrito"}</p>
              <p className="text-[11.5px] text-fg-subtle">{dir.memberName(s.sellerId)}</p>
            </div>
            <StatusBadge meta={SALE_STATUS[s.status]} />
          </div>
        )}
        empty={<EmptyState compact title="Nenhuma venda encontrada" description="Ajuste o filtro ou registre uma venda pela grade." />}
      />
    </section>
  );
}

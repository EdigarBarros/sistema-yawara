"use client";

import { MemberAvatar } from "@/components/shared/member-avatar";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, List, Megaphone, Plus } from "lucide-react";
import type { ContentItem, ContentStatus } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useContents, useDirectory } from "@/hooks/use-data";
import { CONTENT_STATUS, CONTENT_TYPE_LABELS } from "@/lib/labels";
import { formatDate, formatMonth, todayDateOnly } from "@/lib/format";
import { cn, matchesQuery } from "@/lib/utils";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/form";
import { PageHeader } from "@/components/shared/page";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/filters";
import { EmptyState, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { ContentFormDialog } from "@/features/marketing/content-form-dialog";
import { ContentSheet } from "@/features/marketing/content-sheet";

type View = "lista" | "quadro" | "calendario";
const BOARD: ContentStatus[] = ["briefing", "production", "review", "approved", "published"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function Board({ items, onOpen }: { items: ContentItem[]; onOpen: (id: string) => void }) {
  const dir = useDirectory();
  return (
    <div className="flex gap-3 overflow-x-auto p-4 sm:p-5">
      {BOARD.map((status) => {
        const col = items.filter((i) => i.status === status);
        return (
          <section key={status} className="w-[250px] shrink-0 rounded-xl border border-line bg-sunken" aria-label={CONTENT_STATUS[status].label}>
            <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <StatusBadge meta={CONTENT_STATUS[status]} />
              <span className="font-mono text-[12px] text-fg-subtle">{col.length}</span>
            </header>
            <ul className="space-y-2 p-2">
              {col.length === 0 && <li className="px-2 py-4 text-center text-[12px] text-fg-subtle">Vazio</li>}
              {col.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen(c.id)} className="w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-gold/40">
                    <p className="text-[13px] leading-snug font-semibold">{c.title}</p>
                    <p className="mt-1 text-[11.5px] text-fg-subtle">
                      {CONTENT_TYPE_LABELS[c.type]}
                      {c.publishDate && ` · ${formatDate(c.publishDate)}`}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-fg-muted">
                      <MemberAvatar name={dir.memberName(c.responsibleId)} id={c.responsibleId} size={18} />
                      <span className="truncate">{dir.memberName(c.responsibleId)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Calendar({ items, onOpen }: { items: ContentItem[]; onOpen: (id: string) => void }) {
  const today = todayDateOnly();
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const offset = first.getUTCDay();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => i - offset + 1);
  const byDay = new Map<string, ContentItem[]>();
  for (const it of items) {
    if (!it.publishDate) continue;
    byDay.set(it.publishDate, [...(byDay.get(it.publishDate) ?? []), it]);
  }
  const key = (d: number) => `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const shift = (delta: number) => setCursor((c) => ({ y: c.m + delta < 0 ? c.y - 1 : c.m + delta > 11 ? c.y + 1 : c.y, m: (c.m + delta + 12) % 12 }));
  const monthItems = items.filter((i) => i.publishDate?.startsWith(key(1).slice(0, 7))).sort((a, b) => (a.publishDate ?? "").localeCompare(b.publishDate ?? ""));

  return (
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[20px] font-semibold capitalize">{formatMonth(cursor.y, cursor.m)}</h3>
        <div className="flex gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Mês anterior" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>
            Hoje
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Próximo mês" onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="hidden overflow-hidden rounded-lg border border-line md:block">
        <div className="grid grid-cols-7 border-b border-line bg-sunken">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const inMonth = d >= 1 && d <= daysInMonth;
            const k = inMonth ? key(d) : "";
            const list = inMonth ? (byDay.get(k) ?? []) : [];
            return (
              <div key={i} className={cn("min-h-[104px] border-r border-b border-line p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-sunken/50")}>
                {inMonth && (
                  <>
                    <span className={cn("inline-grid size-6 place-items-center rounded-full font-mono text-[12px]", k === today ? "bg-gold font-semibold text-gold-ink" : "text-fg-muted")}>{d}</span>
                    <ul className="mt-1 space-y-1">
                      {list.slice(0, 3).map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => onOpen(c.id)}
                            title={c.title}
                            className={cn(
                              "block w-full truncate rounded border-l-2 bg-surface-2 px-1.5 py-1 text-left text-[11.5px] hover:bg-surface-3",
                              c.status === "published" ? "border-ok" : c.status === "approved" ? "border-gold" : c.status === "cancelled" ? "border-fg-subtle line-through opacity-60" : "border-info",
                            )}
                          >
                            {c.title}
                          </button>
                        </li>
                      ))}
                      {list.length > 3 && <li className="px-1.5 text-[11px] text-fg-subtle">+{list.length - 3} mais</li>}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Celular: agenda em lista */}
      <ul className="space-y-2 md:hidden">
        {monthItems.length === 0 && <li className="py-6 text-center text-[13px] text-fg-subtle">Nada programado neste mês.</li>}
        {monthItems.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 rounded-lg border border-line bg-sunken px-3 py-2.5 text-left">
              <span className="w-12 shrink-0 font-mono text-[12px] text-gold-fg">{formatDate(c.publishDate).slice(0, 5)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.title}</span>
              <StatusBadge meta={CONTENT_STATUS[c.status]} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap gap-4 text-[12px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-info" /> Em andamento
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-gold" /> Aprovado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-ok" /> Publicado
        </span>
      </p>
    </div>
  );
}

export default function MarketingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("marketing");
  const { data, isLoading, isError, error, refetch } = useContents(enabled);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [owner, setOwner] = useState("");
  const [query, setQuery] = useState("");
  const view = (["lista", "quadro", "calendario"].includes(params.get("visao") ?? "") ? params.get("visao") : "quadro") as View;
  const openId = params.get("item");
  const createOpen = params.get("novo") === "1" && access.can("marketing.create");

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const items = useMemo(
    () =>
      (data ?? [])
        .filter((c) => !status || c.status === status)
        .filter((c) => !type || c.type === type)
        .filter((c) => !owner || c.responsibleId === owner)
        .filter((c) => matchesQuery(query, c.title, c.briefing, c.code)),
    [data, status, type, owner, query],
  );
  if (!enabled) return <RestrictedState />;
  const selected = (data ?? []).find((c) => c.id === openId) ?? null;

  const columns: Column<ContentItem>[] = [
    {
      key: "title",
      header: "Conteúdo",
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.title}</p>
          <p className="truncate text-[12px] text-fg-subtle">
            {c.code} · {CONTENT_TYPE_LABELS[c.type]}
          </p>
        </div>
      ),
    },
    { key: "owner", header: "Responsável", hideBelow: "lg", cell: (c) => <span className="text-fg-muted">{dir.memberName(c.responsibleId)}</span> },
    { key: "created", header: "Criado em", hideBelow: "xl", cell: (c) => <span className="tnum font-mono text-[12.5px] text-fg-muted">{formatDate(c.createdAt)}</span> },
    { key: "date", header: "Publicação", cell: (c) => <span className="tnum font-mono text-[12.5px] text-fg-muted">{formatDate(c.publishDate)}</span> },
    { key: "status", header: "Etapa", cell: (c) => <StatusBadge meta={CONTENT_STATUS[c.status]} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Comunicação"
        title="Marketing"
        description="Produção de conteúdo, do briefing à publicação. Publicações nas redes são feitas fora da Central."
        actions={
          access.can("marketing.create") && (
            <Button variant="primary" onClick={() => setParams({ novo: "1" })}>
              <Plus /> Novo conteúdo
            </Button>
          )
        }
      />
      <section className="rounded-xl border border-line bg-surface">
        <Toolbar>
          <Segmented
            ariaLabel="Visualização"
            value={view}
            onChange={(v) => setParams({ visao: v })}
            options={[
              { value: "quadro", label: "Quadro", icon: <Columns3 /> },
              { value: "lista", label: "Lista", icon: <List /> },
              { value: "calendario", label: "Calendário", icon: <CalendarDays /> },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {view !== "quadro" && (
              <FilterSelect label="Etapa" value={status} onChange={setStatus} options={[{ value: "", label: "Todas as etapas" }, ...Object.entries(CONTENT_STATUS).map(([v, m]) => ({ value: v, label: m.label }))]} />
            )}
            <FilterSelect label="Tipo" value={type} onChange={setType} options={[{ value: "", label: "Todos os tipos" }, ...Object.entries(CONTENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
            <FilterSelect label="Responsável" value={owner} onChange={setOwner} options={[{ value: "", label: "Todos os responsáveis" }, ...dir.activeMembers.map((m) => ({ value: m.id, label: m.name }))]} />
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar conteúdo" className="w-full sm:w-56" />
          </div>
        </Toolbar>
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
        ) : isLoading ? (
          <InlineLoader />
        ) : (data ?? []).length === 0 ? (
          <EmptyState icon={<Megaphone />} title="Nenhum conteúdo ainda" description="Crie o primeiro briefing para começar o fluxo de produção." />
        ) : view === "quadro" ? (
          <Board items={items} onOpen={(id) => setParams({ item: id })} />
        ) : view === "calendario" ? (
          <Calendar items={items} onOpen={(id) => setParams({ item: id })} />
        ) : (
          <DataTable
            caption="Conteúdos"
            rows={[...items].sort((a, b) => (b.publishDate ?? "").localeCompare(a.publishDate ?? ""))}
            columns={columns}
            getRowId={(c) => c.id}
            onRowClick={(c) => setParams({ item: c.id })}
            mobileCard={(c) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.title}</p>
                  <p className="text-[12px] text-fg-subtle">
                    {CONTENT_TYPE_LABELS[c.type]} · {formatDate(c.publishDate)}
                  </p>
                </div>
                <StatusBadge meta={CONTENT_STATUS[c.status]} />
              </div>
            )}
            empty={<EmptyState compact title="Nenhum conteúdo neste filtro" />}
          />
        )}
      </section>
      <ContentSheet item={selected} onOpenChange={(o) => !o && setParams({ item: null })} />
      <ContentFormDialog open={createOpen} onOpenChange={(o) => !o && setParams({ novo: null })} onSaved={(c) => setTimeout(() => setParams({ item: c.id, novo: null }), 50)} />
    </>
  );
}

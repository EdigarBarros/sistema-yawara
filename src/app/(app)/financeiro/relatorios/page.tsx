"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, FileSpreadsheet, Share2 } from "lucide-react";
import type { Audience, EntryStatus, EntryType } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useCampaigns, useDirectory, useDocumentCategories, useEvents, useFinanceCategories, useFinanceEntries } from "@/hooks/use-data";
import { ENTRY_TYPE_LABELS, entryStatusMeta } from "@/lib/labels";
import { formatDate, formatMoney, formatShortMonth, toDateOnly } from "@/lib/format";
import { emptyAudience } from "@/lib/permissions";
import { cn, normalize } from "@/lib/utils";
import { downloadBlob, slugify } from "@/lib/export/common";
import { errorMessage, notifyError, notifySuccess } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader, Panel, Stat } from "@/components/shared/page";
import { FilterSelect } from "@/components/shared/filters";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DemoNotice, EmptyState, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { ColumnChart } from "@/components/shared/column-chart";
import { AudiencePicker, AudienceSummary } from "@/components/shared/audience";
import { FinanceNav } from "@/features/finance/finance-nav";
import { byMonth, summarizeFinance } from "@/features/finance/utils";
import { buildFinancePdf, exportFinanceCsv, groupByCategory, type CategoryRow } from "@/features/finance/report";
import { RAFFLE_INCOME_HELP } from "@/features/finance/receipt";

type Preset = "month" | "quarter" | "semester" | "year" | "custom";

/** Lançamentos carregados para os relatórios no modo Firebase (os mais recentes por data). */
const REPORT_LOAD_LIMIT = 2000;

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const to = toDateOnly(now);
  const back = (days: number) => toDateOnly(new Date(now.getTime() - days * 86_400_000));
  switch (p) {
    case "month":
      return { from: `${to.slice(0, 7)}-01`, to };
    case "quarter":
      return { from: back(90), to };
    case "semester":
      return { from: back(182), to };
    case "year":
      return { from: `${to.slice(0, 4)}-01-01`, to: `${to.slice(0, 4)}-12-31` };
    default:
      return { from: back(182), to };
  }
}

export default function FinanceReportsPage() {
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const enabled = access.canModule("finance");
  const { data, isLoading, isError, error, refetch } = useFinanceEntries(enabled);
  const { data: categories } = useFinanceCategories();
  const { data: events } = useEvents(access.canModule("events"));
  const { data: campaigns } = useCampaigns();
  const [preset, setPreset] = useState<Preset>("semester");
  const [range, setRange] = useState(presetRange("semester"));
  const [type, setType] = useState<"" | EntryType>("");
  const [category, setCategory] = useState("");
  const [eventId, setEventId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [status, setStatus] = useState<"" | EntryStatus>("");
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const entries = useMemo(
    () =>
      (data ?? [])
        .filter((e) => (!range.from || e.date >= range.from) && (!range.to || e.date <= range.to))
        .filter((e) => !type || e.type === type)
        .filter((e) => !category || e.categoryId === category)
        .filter((e) => !eventId || e.eventId === eventId)
        .filter((e) => !campaignId || e.campaignId === campaignId)
        .filter((e) => !status || e.status === status)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [data, range, type, category, eventId, campaignId, status],
  );

  if (!enabled) return <RestrictedState />;
  const s = summarizeFinance(entries);
  const byCat = groupByCategory(entries, categories ?? []);
  const months = byMonth(entries);
  const filtersLabel = [
    `Período: ${range.from ? formatDate(range.from) : "início"} a ${range.to ? formatDate(range.to) : "hoje"}`,
    type && ENTRY_TYPE_LABELS[type],
    category && categories?.find((c) => c.id === category)?.name,
    eventId && `Evento: ${events?.find((e) => e.id === eventId)?.name}`,
    campaignId && `Campanha: ${campaigns?.find((c) => c.id === campaignId)?.name}`,
    status && { pending: "Pendentes", settled: "Realizados", cancelled: "Cancelados" }[status],
  ]
    .filter(Boolean)
    .join(" · ");
  const ctx = { title: "Relatório financeiro", filtersLabel, entries, categories: categories ?? [], memberName: dir.memberName, generatedBy: access.user?.name ?? "—" };
  const canExport = access.can("finance.export");
  /** Registra a exportação na auditoria (melhor esforço; sem dados pessoais). */
  const recordExport = (format: "CSV" | "PDF") => {
    void services.audit
      .recordExport({
        module: "finance",
        resourceType: "financeReport",
        resourceId: "relatorio",
        summary: `${format} do relatório financeiro: ${entries.length} lançamento(s). ${filtersLabel}`,
        personalData: false,
      })
      .catch(() => undefined);
  };

  const catColumns: Column<CategoryRow>[] = [
    { key: "name", header: "Categoria", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "type", header: "Tipo", cell: (r) => <span className="text-fg-muted">{ENTRY_TYPE_LABELS[r.type]}</span> },
    { key: "count", header: "Lançamentos", align: "right", cell: (r) => <span className="tnum font-mono">{r.count}</span> },
    { key: "settled", header: "Realizado", align: "right", cell: (r) => <span className={cn("tnum font-mono font-semibold", r.type === "income" && "text-ok")}>{formatMoney(r.settled)}</span> },
    { key: "pending", header: "Pendente", align: "right", cell: (r) => <span className="tnum font-mono text-warn">{formatMoney(r.pending)}</span> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Relatórios"
        description="Filtre por período, categoria, evento ou campanha. Exporte ou compartilhe o resultado."
        actions={
          canExport && (
            <>
              <Button
                loading={busy === "csv"}
                disabled={entries.length === 0}
                onClick={() => {
                  setBusy("csv");
                  try {
                    exportFinanceCsv(ctx, `relatorio-financeiro-${toDateOnly(new Date())}.csv`);
                    recordExport("CSV");
                    notifySuccess("CSV gerado", `${entries.length} lançamento(s).`);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <FileSpreadsheet /> CSV
              </Button>
              <Button
                loading={busy === "pdf"}
                disabled={entries.length === 0}
                onClick={async () => {
                  setBusy("pdf");
                  try {
                    downloadBlob(await buildFinancePdf(ctx), `relatorio-financeiro-${toDateOnly(new Date())}.pdf`);
                    recordExport("PDF");
                    notifySuccess("PDF gerado", isDemoMode ? "Relatório gerado neste navegador." : "PDF gerado no navegador a partir dos dados registrados.");
                  } catch (e) {
                    notifyError(e);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <FileDown /> PDF
              </Button>
              {access.can("documents.create") && (
                <Button variant="primary" disabled={entries.length === 0} onClick={() => setShareOpen(true)}>
                  <Share2 /> Compartilhar relatório
                </Button>
              )}
            </>
          )
        }
      />
      <FinanceNav />

      <section className="mb-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Período">
            <select
              value={preset}
              onChange={(e) => {
                const p = e.target.value as Preset;
                setPreset(p);
                if (p !== "custom") setRange(presetRange(p));
              }}
              className="h-10 w-full rounded-lg border border-line-strong bg-sunken px-3 text-[14px]"
            >
              <option value="month">Este mês</option>
              <option value="quarter">Últimos 3 meses</option>
              <option value="semester">Últimos 6 meses</option>
              <option value="year">Este ano</option>
              <option value="custom">Personalizado</option>
            </select>
          </Field>
          <Field label="De">
            <Input
              type="date"
              value={range.from}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
            />
          </Field>
          <Field label="Até" error={range.from && range.to && range.to < range.from ? "A data final é anterior à inicial." : undefined}>
            <Input
              type="date"
              value={range.to}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <FilterSelect label="Tipo" value={type} onChange={(v) => setType(v as EntryType | "")} options={[{ value: "", label: "Receitas e despesas" }, { value: "income", label: "Receitas" }, { value: "expense", label: "Despesas" }]} />
          <FilterSelect label="Categoria" value={category} onChange={setCategory} options={[{ value: "", label: "Todas as categorias" }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <FilterSelect label="Evento" value={eventId} onChange={setEventId} options={[{ value: "", label: "Todos os eventos" }, ...(events ?? []).map((e) => ({ value: e.id, label: e.name }))]} />
          <FilterSelect label="Campanha" value={campaignId} onChange={setCampaignId} options={[{ value: "", label: "Todas as campanhas" }, ...(campaigns ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
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
        </div>
      </section>

      {isLoading ? (
        <InlineLoader />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : entries.length === 0 ? (
        <Panel title="Resultado">
          <EmptyState title="Nenhum lançamento no filtro" description="Amplie o período ou remova algum filtro." />
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Receitas recebidas" value={formatMoney(s.income)} footer={<span>{formatMoney(s.receivable)} a receber</span>} />
            <Stat label="Despesas pagas" value={formatMoney(s.expense)} footer={<span>{formatMoney(s.payable)} a pagar</span>} />
            <Stat label="Saldo do período" value={formatMoney(s.balance)} footer={<span>Somente valores realizados</span>} />
            <Stat label="Lançamentos" value={entries.length} footer={<span>{entries.filter((e) => e.status === "cancelled").length} cancelado(s), fora dos totais</span>} />
          </div>
          {months.length > 1 && (
            <Panel title="Evolução mensal" description="Valores realizados no período filtrado">
              <ColumnChart
                title="Receitas e despesas realizadas por mês no período"
                series={[
                  { name: "Receitas", color: "--chart-1" },
                  { name: "Despesas", color: "--chart-2" },
                ]}
                groups={months.map((m) => ({ label: `${formatShortMonth(m.year, m.month)}/${String(m.year).slice(2)}`, values: [m.income, m.expense] }))}
                format={formatMoney}
                extra={(g) => ({ label: "Saldo do mês", value: formatMoney(g.values[0] - g.values[1]) })}
              />
            </Panel>
          )}
          <Panel title="Por categoria" bodyClassName="p-0">
            <DataTable caption="Totais por categoria" rows={byCat} columns={catColumns} getRowId={(r) => r.categoryId} pageSize={50} />
          </Panel>
          <Panel title="Lançamentos do período" bodyClassName="p-0">
            <DataTable
              caption="Lançamentos do relatório"
              rows={entries}
              getRowId={(e) => e.id}
              onRowClick={(e) => router.push(`/financeiro/lancamentos?id=${e.id}`)}
              columns={[
                { key: "date", header: "Data", cell: (e) => <span className="tnum font-mono text-[12.5px] text-fg-muted">{formatDate(e.date)}</span> },
                { key: "desc", header: "Descrição", cell: (e) => <span className="font-medium">{e.description}</span> },
                { key: "cat", header: "Categoria", hideBelow: "lg", cell: (e) => <span className="text-fg-muted">{categories?.find((c) => c.id === e.categoryId)?.name}</span> },
                { key: "status", header: "Situação", cell: (e) => <StatusBadge meta={entryStatusMeta(e.type, e.status)} /> },
                {
                  key: "amount",
                  header: "Valor",
                  align: "right",
                  cell: (e) => (
                    <span className={cn("tnum font-mono font-semibold whitespace-nowrap", e.type === "income" && "text-ok", e.status === "cancelled" && "line-through opacity-50")}>
                      {e.type === "income" ? "+" : "−"} {formatMoney(e.amount)}
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
        </div>
      )}
      <Panel title="Como os valores são calculados" className="mt-4">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-fg-muted">
          <li>
            <b className="font-medium text-fg">Realizado</b>: receitas recebidas e despesas pagas. O saldo considera somente valores realizados (receitas recebidas − despesas pagas).
          </li>
          <li>
            <b className="font-medium text-fg">Pendente</b>: valores a receber e a pagar, mostrados à parte — ainda não entram no saldo.
          </li>
          <li>
            <b className="font-medium text-fg">Cancelados</b> ficam fora de todos os totais, mas continuam listados (e no histórico) para conferência.
          </li>
          <li>{RAFFLE_INCOME_HELP}</li>
          <li>Os totais são calculados a partir dos lançamentos que o seu perfil pode consultar, com os filtros acima; o arquivo exportado traz exatamente o que aparece nesta página.</li>
          {!isDemoMode && <li>São considerados os {REPORT_LOAD_LIMIT.toLocaleString("pt-BR")} lançamentos mais recentes (por data).</li>}
        </ul>
        {!isDemoMode && (data?.length ?? 0) >= REPORT_LOAD_LIMIT && (
          <p role="status" className="mt-3 rounded-lg border border-warn/30 bg-warn/[0.08] px-3.5 py-2.5 text-[12.5px] text-fg-muted">
            O limite de {REPORT_LOAD_LIMIT.toLocaleString("pt-BR")} lançamentos foi atingido: lançamentos mais antigos podem não estar incluídos. Filtre por um período recente para relatórios completos.
          </p>
        )}
      </Panel>
      <ShareReportDialog open={shareOpen} onOpenChange={setShareOpen} buildBlob={() => buildFinancePdf(ctx)} filtersLabel={filtersLabel} />
    </>
  );
}

function ShareReportDialog({ open, onOpenChange, buildBlob, filtersLabel }: { open: boolean; onOpenChange: (o: boolean) => void; buildBlob: () => Promise<Blob>; filtersLabel: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ShareReportBody onOpenChange={onOpenChange} buildBlob={buildBlob} filtersLabel={filtersLabel} />}
    </Dialog>
  );
}

function ShareReportBody({ onOpenChange, buildBlob, filtersLabel }: { onOpenChange: (o: boolean) => void; buildBlob: () => Promise<Blob>; filtersLabel: string }) {
  const router = useRouter();
  const access = useAccess();
  const { data: docCategories } = useDocumentCategories();
  // Categoria configurável em Configurações; usa "Relatórios financeiros" quando existir.
  const reportCategoryId = docCategories?.find((c) => normalize(c.name).includes("relatorios financeiros"))?.id ?? docCategories?.[0]?.id ?? "";
  const [title, setTitle] = useState(`Relatório financeiro — ${new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date())}`);
  const [audience, setAudience] = useState<Audience>(emptyAudience("board"));
  const [error, setError] = useState<string>();
  // O PDF é gerado ANTES da ação: assim o identificador de requisição chega ao
  // serviço e um reenvio após falha de conexão não duplica o documento.
  const share = useAction(
    (blob: Blob) =>
      services.documents.create(
        {
          name: title,
          description: `Gerado no módulo Financeiro. ${filtersLabel}.`,
          categoryId: reportCategoryId,
          departmentId: access.role?.departmentId ?? "",
          status: "current",
          access: audience.scope === "department" ? { ...audience, departmentId: access.role?.departmentId } : audience,
        },
        blob,
        `${slugify(title)}.pdf`,
      ),
    {
      success: "Relatório compartilhado",
      successDescription: isDemoMode ? "Salvo em Documentos › Relatórios financeiros (somente neste navegador)." : "Salvo em Documentos › Relatórios financeiros, visível para o público escolhido.",
      silentError: true,
    },
  );
  return (
    <DialogContent
      size="lg"
      title="Compartilhar relatório"
      description="O PDF é salvo na biblioteca de Documentos e fica visível para o público escolhido."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={share.pending}
            onClick={async () => {
              if (title.trim().length < 3) return setError("Informe um título.");
              setError(undefined);
              try {
                const doc = await share.run(await buildBlob());
                onOpenChange(false);
                router.push(`/documentos/${doc.id}`);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            <Share2 /> Compartilhar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título do documento" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <p className="text-[12.5px] text-fg-muted">Filtros aplicados: {filtersLabel}</p>
        <AudiencePicker name="report-access" value={audience} onChange={setAudience} scopes={["department", "board", "all", "roles", "people"]} departmentId={access.role?.departmentId} />
        <div className="rounded-lg border border-line bg-sunken px-4 py-3">
          <AudienceSummary module="documents" audience={audience} departmentId={access.role?.departmentId} alwaysIncluded={access.user ? [access.user.id] : []} />
        </div>
        {isDemoMode ? (
          <DemoNotice>Compartilhamento simulado: o arquivo fica neste navegador. No backend, ele será salvo no armazenamento da Atlética.</DemoNotice>
        ) : (
          <p className="text-[12.5px] text-fg-muted">O PDF é gerado no navegador a partir dos dados registrados e salvo em Documentos com acesso restrito ao público escolhido.</p>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </DialogContent>
  );
}

import type { FinanceCategory, FinanceEntry } from "@/types";
import { ENTRY_TYPE_LABELS, entryStatusMeta } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { autoTable, createPdf, downloadCsv, drawPdfFooters, drawPdfHeader, PDF_COLORS } from "@/lib/export/common";
import { summarizeFinance } from "./utils";

export interface CategoryRow {
  categoryId: string;
  name: string;
  type: FinanceEntry["type"];
  count: number;
  settled: number;
  pending: number;
}

export function groupByCategory(entries: FinanceEntry[], categories: FinanceCategory[]): CategoryRow[] {
  const map = new Map<string, CategoryRow>();
  for (const e of entries) {
    if (e.status === "cancelled") continue;
    const cat = categories.find((c) => c.id === e.categoryId);
    const row = map.get(e.categoryId) ?? { categoryId: e.categoryId, name: cat?.name ?? "—", type: e.type, count: 0, settled: 0, pending: 0 };
    row.count += 1;
    if (e.status === "settled") row.settled += e.amount;
    else row.pending += e.amount;
    map.set(e.categoryId, row);
  }
  return [...map.values()].sort((a, b) => (a.type === b.type ? b.settled + b.pending - (a.settled + a.pending) : a.type === "income" ? -1 : 1));
}

interface ReportCtx {
  title: string;
  filtersLabel: string;
  entries: FinanceEntry[];
  categories: FinanceCategory[];
  memberName: (id?: string) => string;
  generatedBy: string;
}

export function exportFinanceCsv({ entries, categories, memberName }: ReportCtx, fileName: string) {
  downloadCsv(
    [
      ["codigo", "data", "tipo", "descricao", "categoria", "valor", "situacao", "responsavel"],
      ...entries.map((e) => [
        e.code,
        formatDate(e.date),
        ENTRY_TYPE_LABELS[e.type],
        e.description,
        categories.find((c) => c.id === e.categoryId)?.name ?? "",
        (e.amount / 100).toFixed(2).replace(".", ","),
        entryStatusMeta(e.type, e.status).label,
        memberName(e.responsibleId),
      ]),
    ],
    fileName,
  );
}

/** PDF do relatório (resumo + categorias + lançamentos). Retorna o arquivo para baixar ou compartilhar. */
export async function buildFinancePdf(ctx: ReportCtx): Promise<Blob> {
  const doc = await createPdf("portrait");
  let y = await drawPdfHeader(doc, ctx.title, ctx.filtersLabel);
  const s = summarizeFinance(ctx.entries);
  const width = doc.internal.pageSize.getWidth();
  const boxes: [string, string][] = [
    ["Receitas recebidas", formatMoney(s.income)],
    ["Despesas pagas", formatMoney(s.expense)],
    ["Saldo", formatMoney(s.balance)],
    ["Pendente (receber/pagar)", `${formatMoney(s.receivable)} / ${formatMoney(s.payable)}`],
  ];
  const bw = (width - 24 - 9) / 4;
  boxes.forEach(([label, value], i) => {
    const x = 12 + i * (bw + 3);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.roundedRect(x, y, bw, 18, 1.5, 1.5, "S");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.setFont("helvetica", "normal");
    doc.text(label.toUpperCase(), x + 3, y + 6);
    doc.setFontSize(10.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PDF_COLORS.text);
    doc.text(value, x + 3, y + 13.5);
  });
  y += 26;

  const table = await autoTable();
  const styles = { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, textColor: PDF_COLORS.text, lineColor: PDF_COLORS.line, lineWidth: 0.1 } as const;
  const headStyles = { fillColor: PDF_COLORS.navy, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const };
  table(doc, {
    startY: y,
    head: [["Categoria", "Tipo", "Lanç.", "Realizado", "Pendente"]],
    body: groupByCategory(ctx.entries, ctx.categories).map((r) => [r.name, ENTRY_TYPE_LABELS[r.type], String(r.count), formatMoney(r.settled), formatMoney(r.pending)]),
    styles,
    headStyles,
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    margin: { left: 12, right: 12, bottom: 20 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  table(doc, {
    startY: y,
    head: [["Data", "Descrição", "Categoria", "Situação", "Valor"]],
    body: ctx.entries.map((e) => [
      formatDate(e.date),
      e.description,
      ctx.categories.find((c) => c.id === e.categoryId)?.name ?? "",
      entryStatusMeta(e.type, e.status).label,
      `${e.type === "income" ? "+" : "-"} ${formatMoney(e.amount)}`,
    ]),
    styles,
    headStyles,
    columnStyles: { 0: { cellWidth: 20 }, 4: { halign: "right", cellWidth: 28 } },
    margin: { left: 12, right: 12, bottom: 20 },
  });
  drawPdfFooters(doc, ctx.generatedBy);
  return doc.output("blob");
}

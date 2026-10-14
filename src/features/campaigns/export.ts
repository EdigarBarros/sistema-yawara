/**
 * Exportações da rifa geradas localmente a partir dos dados de demonstração.
 * A versão de divulgação NUNCA inclui nome ou contato dos compradores.
 */
import type { Campaign, NumberSlot, NumberStatus } from "@/types";
import { NUMBER_STATUS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatDate, formatDateTimeShort, formatMoney } from "@/lib/format";
import { padNumber } from "@/lib/raffle";
import { autoTable, createPdf, downloadBlob, downloadCsv, drawPdfFooters, drawPdfHeader, loadLogo, PDF_COLORS, slugify } from "@/lib/export/common";

export type ExportFormat = "pdf" | "csv" | "png";
export type ExportScope = "all" | "available" | "sold" | "paid" | "pending";
export type ExportAudience = "public" | "internal";

export const SCOPE_LABELS: Record<ExportScope, string> = {
  all: "Todos os números",
  available: "Somente disponíveis",
  sold: "Somente vendidos (pendentes e pagos)",
  paid: "Somente pagos",
  pending: "Somente pendentes",
};

export function filterSlots(slots: NumberSlot[], scope: ExportScope) {
  const rule: Record<ExportScope, (s: NumberStatus) => boolean> = {
    all: () => true,
    available: (s) => s === "available",
    sold: (s) => s === "pending" || s === "paid",
    paid: (s) => s === "paid",
    pending: (s) => s === "pending",
  };
  return slots.filter((s) => rule[scope](s.status));
}

interface ExportContext {
  campaign: Campaign;
  slots: NumberSlot[];
  scope: ExportScope;
  audience: ExportAudience;
  memberName: (id?: string) => string;
  generatedBy: string;
}

function baseName(ctx: ExportContext) {
  return `${slugify(ctx.campaign.name)}-${ctx.audience === "public" ? "divulgacao" : "interno"}-${ctx.scope}`;
}

/* ---------------------------------- CSV ---------------------------------- */

export function exportCsv(ctx: ExportContext) {
  const rows = filterSlots(ctx.slots, ctx.scope);
  const { campaign } = ctx;
  if (ctx.audience === "public") {
    downloadCsv([["numero", "situacao"], ...rows.map((s) => [padNumber(s.number, campaign.quantity), NUMBER_STATUS[s.status].label])], `${baseName(ctx)}.csv`);
    return rows.length;
  }
  downloadCsv(
    [
      ["numero", "situacao", "comprador", "contato", "responsavel_venda", "registrado_por", "data_venda", "forma_pagamento", "confirmado_em", "observacoes"],
      ...rows.map((s) => {
        const sale = s.sale;
        return [
          padNumber(s.number, campaign.quantity),
          NUMBER_STATUS[s.status].label,
          sale ? (sale.buyer?.name ?? "Restrito") : "",
          sale ? (sale.buyer?.contact ?? "Restrito") : "",
          sale ? ctx.memberName(sale.sellerId) : "",
          sale ? ctx.memberName(sale.registeredById) : "",
          sale ? formatDateTimeShort(sale.createdAt) : "",
          sale?.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod] : "",
          sale?.paidAt ? formatDateTimeShort(sale.paidAt) : "",
          sale?.notes ?? "",
        ];
      }),
    ],
    `${baseName(ctx)}.csv`,
  );
  return rows.length;
}

/* ---------------------------------- PDF ---------------------------------- */

const STATUS_FILL: Record<NumberStatus, [number, number, number]> = {
  available: [255, 255, 255],
  reserved: [222, 234, 244],
  pending: [253, 238, 206],
  paid: [214, 242, 226],
  cancelled: [236, 238, 243],
};

export async function exportPdf(ctx: ExportContext) {
  const { campaign } = ctx;
  const rows = filterSlots(ctx.slots, ctx.scope);
  const doc = await createPdf("portrait");
  const subtitle = [
    `Prêmio: ${campaign.prize}`,
    `${formatMoney(campaign.unitPrice)} por número`,
    campaign.drawDate ? `Sorteio previsto: ${formatDate(campaign.drawDate)}` : null,
    SCOPE_LABELS[ctx.scope],
  ]
    .filter(Boolean)
    .join("  ·  ");
  let y = await drawPdfHeader(doc, campaign.name, subtitle);
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  if (ctx.audience === "public") {
    // Grade de números (sem dados pessoais)
    const cols = 10;
    const gap = 1.6;
    const cellW = (width - 24 - gap * (cols - 1)) / cols;
    const cellH = 8;
    let x = 12;
    doc.setFontSize(9);
    rows.forEach((slot, i) => {
      if (i > 0 && i % cols === 0) {
        x = 12;
        y += cellH + gap;
      }
      if (y + cellH > height - 30) {
        doc.addPage();
        y = 20;
      }
      doc.setFillColor(...STATUS_FILL[slot.status]);
      doc.setDrawColor(...(slot.status === "available" ? PDF_COLORS.goldDark : PDF_COLORS.line));
      doc.roundedRect(x, y, cellW, cellH, 1, 1, "FD");
      doc.setTextColor(...(slot.status === "available" ? PDF_COLORS.text : PDF_COLORS.muted));
      doc.setFont("helvetica", slot.status === "available" ? "bold" : "normal");
      doc.text(padNumber(slot.number, campaign.quantity), x + cellW / 2, y + cellH / 2 + 1.2, { align: "center" });
      if (slot.status === "cancelled") doc.line(x + 2, y + cellH / 2, x + cellW - 2, y + cellH / 2);
      x += cellW + gap;
    });
    y += cellH + 8;
    if (y > height - 30) {
      doc.addPage();
      y = 20;
    }
    // Legenda
    doc.setFontSize(8);
    let lx = 12;
    (Object.keys(STATUS_FILL) as NumberStatus[]).forEach((s) => {
      doc.setFillColor(...STATUS_FILL[s]);
      doc.setDrawColor(...PDF_COLORS.line);
      doc.rect(lx, y - 3, 4, 4, "FD");
      doc.setTextColor(...PDF_COLORS.muted);
      doc.setFont("helvetica", "normal");
      const label = NUMBER_STATUS[s].label;
      doc.text(label, lx + 5.5, y);
      lx += 7 + doc.getTextWidth(label) + 4;
    });
    doc.text("Versão de divulgação: não contém dados pessoais dos compradores.", 12, y + 7);
  } else {
    const table = await autoTable();
    table(doc, {
      startY: y,
      head: [["Número", "Situação", "Comprador", "Contato", "Responsável", "Pagamento", "Data da venda"]],
      body: rows.map((s) => [
        padNumber(s.number, campaign.quantity),
        NUMBER_STATUS[s.status].label,
        s.sale ? (s.sale.buyer?.name ?? "Restrito") : "",
        s.sale ? (s.sale.buyer?.contact ?? "Restrito") : "",
        s.sale ? ctx.memberName(s.sale.sellerId) : "",
        s.sale?.paymentMethod ? PAYMENT_METHOD_LABELS[s.sale.paymentMethod] : "",
        s.sale ? formatDate(s.sale.createdAt) : "",
      ]),
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.8, textColor: PDF_COLORS.text, lineColor: PDF_COLORS.line, lineWidth: 0.1 },
      headStyles: { fillColor: PDF_COLORS.navy, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 248, 252] },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 16 } },
      margin: { left: 12, right: 12, bottom: 20 },
    });
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text("Relatório interno: contém dados pessoais. Não compartilhe fora da diretoria autorizada.", 12, Math.min(finalY + 7, height - 18));
  }

  drawPdfFooters(doc, ctx.generatedBy);
  doc.save(`${baseName(ctx)}.pdf`);
  return rows.length;
}

/* ------------------------------- Imagem (PNG) ------------------------------- */

const PNG_COLORS: Record<NumberStatus, { fill: string; stroke: string; text: string }> = {
  available: { fill: "#0a1236", stroke: "#e1af37", text: "#ffffff" },
  reserved: { fill: "#132a4a", stroke: "#94b6d0", text: "#94b6d0" },
  pending: { fill: "#3a2a08", stroke: "#f2a93b", text: "#f2a93b" },
  paid: { fill: "#0f3326", stroke: "#3fcf8e", text: "#3fcf8e" },
  cancelled: { fill: "#0a1236", stroke: "#2a3566", text: "#5f6b95" },
};

/** Imagem da grade para divulgação (sempre sem dados pessoais). */
export async function exportPng(ctx: ExportContext) {
  const { campaign } = ctx;
  const rows = filterSlots(ctx.slots, ctx.scope);
  const cols = rows.length > 400 ? 20 : rows.length > 150 ? 15 : 10;
  const cell = 64;
  const gap = 8;
  const pad = 56;
  const headerH = 210;
  const gridRows = Math.ceil(rows.length / cols);
  const width = pad * 2 + cols * cell + (cols - 1) * gap;
  const height = headerH + gridRows * (cell + gap) + 140;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  await document.fonts?.ready;

  g.fillStyle = "#030820";
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#e1af37";
  g.fillRect(0, 0, width, 6);

  const logoUrl = await loadLogo();
  if (logoUrl) {
    const img = new Image();
    img.src = logoUrl;
    await img.decode().catch(() => undefined);
    g.drawImage(img, pad, 44, 96, 96);
  }
  const tx = logoUrl ? pad + 120 : pad;
  g.fillStyle = "#e1af37";
  g.font = "600 18px Inter, sans-serif";
  g.fillText("ATLÉTICA YAWARA · RIFA", tx, 64);
  g.fillStyle = "#ffffff";
  g.font = "700 44px 'Barlow Semi Condensed', Inter, sans-serif";
  g.fillText(campaign.name, tx, 112);
  g.fillStyle = "#97a3c7";
  g.font = "400 20px Inter, sans-serif";
  const info = [campaign.prize, `${formatMoney(campaign.unitPrice)} por número`, campaign.drawDate ? `Sorteio: ${formatDate(campaign.drawDate)}` : null].filter(Boolean).join("  ·  ");
  g.fillText(info, tx, 146, width - tx - pad);

  rows.forEach((slot, i) => {
    const x = pad + (i % cols) * (cell + gap);
    const y = headerH + Math.floor(i / cols) * (cell + gap);
    const c = PNG_COLORS[slot.status];
    g.fillStyle = c.fill;
    g.strokeStyle = c.stroke;
    g.lineWidth = slot.status === "available" ? 2 : 1.5;
    g.beginPath();
    g.roundRect(x, y, cell, cell, 10);
    g.fill();
    g.stroke();
    g.fillStyle = c.text;
    g.font = `${slot.status === "available" ? 700 : 500} 20px 'JetBrains Mono', ui-monospace, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(padNumber(slot.number, campaign.quantity), x + cell / 2, y + cell / 2);
    if (slot.status === "cancelled") {
      g.strokeStyle = c.text;
      g.beginPath();
      g.moveTo(x + 12, y + cell / 2);
      g.lineTo(x + cell - 12, y + cell / 2);
      g.stroke();
    }
  });
  g.textAlign = "left";
  g.textBaseline = "alphabetic";

  // Legenda
  let lx = pad;
  const ly = height - 82;
  g.font = "500 17px Inter, sans-serif";
  (Object.keys(PNG_COLORS) as NumberStatus[]).forEach((s) => {
    const c = PNG_COLORS[s];
    g.fillStyle = c.fill;
    g.strokeStyle = c.stroke;
    g.beginPath();
    g.roundRect(lx, ly - 16, 22, 22, 5);
    g.fill();
    g.stroke();
    g.fillStyle = "#97a3c7";
    const label = NUMBER_STATUS[s].label;
    g.fillText(label, lx + 32, ly);
    lx += 32 + g.measureText(label).width + 28;
  });
  g.fillStyle = "#5f6b95";
  g.font = "400 15px Inter, sans-serif";
  g.fillText("#SomosYawara · Imagem gerada na Central Yawara (ambiente de demonstração, dados fictícios)", pad, height - 36);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível gerar a imagem neste navegador.");
  downloadBlob(blob, `${baseName({ ...ctx, audience: "public" })}.png`);
  return rows.length;
}

/**
 * Utilitários de exportação local. Todos os arquivos são gerados no próprio
 * navegador, a partir dos dados já carregados — nada é enviado a servidores.
 */
import { isDemoMode } from "@/lib/mode";
import type { jsPDF } from "jspdf";
import { formatDateTimeShort } from "@/lib/format";

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** CSV com ";" e BOM — abre corretamente no Excel em português. */
export function toCsv(rows: (string | number | undefined | null)[][]) {
  const escape = (v: string | number | undefined | null) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(escape).join(";")).join("\r\n");
}

export function downloadCsv(rows: (string | number | undefined | null)[][], fileName: string) {
  downloadBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), fileName);
}

export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

let logoCache: string | null = null;
export async function loadLogo(): Promise<string | null> {
  if (logoCache) return logoCache;
  try {
    const res = await fetch("/brand/escudo-192.png");
    const blob = await res.blob();
    logoCache = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return logoCache;
  } catch {
    return null;
  }
}

export const PDF_COLORS = {
  navy: [3, 15, 69] as [number, number, number],
  night: [0, 2, 12] as [number, number, number],
  gold: [225, 175, 55] as [number, number, number],
  goldDark: [178, 132, 19] as [number, number, number],
  text: [20, 26, 50] as [number, number, number],
  muted: [95, 105, 135] as [number, number, number],
  line: [215, 220, 232] as [number, number, number],
};

export async function createPdf(orientation: "portrait" | "landscape" = "portrait") {
  const { jsPDF } = await import("jspdf");
  return new jsPDF({ orientation, unit: "mm", format: "a4" });
}

/** Cabeçalho institucional com escudo (e aviso de demonstração, no modo demo). Retorna o Y onde o conteúdo começa. */
export async function drawPdfHeader(doc: jsPDF, title: string, subtitle?: string) {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PDF_COLORS.navy);
  doc.rect(0, 0, width, 30, "F");
  doc.setFillColor(...PDF_COLORS.gold);
  doc.rect(0, 30, width, 0.8, "F");
  const logo = await loadLogo();
  if (logo) doc.addImage(logo, "PNG", 12, 5, 20, 20);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Central Yawara", logo ? 36 : 12, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(200, 210, 235);
  doc.text("Associação Atlética Acadêmica de Psicologia Yawara", logo ? 36 : 12, 18.5);
  doc.setTextColor(...PDF_COLORS.gold);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(isDemoMode ? "DOCUMENTO DE DEMONSTRAÇÃO · DADOS FICTÍCIOS" : "DOCUMENTO INTERNO", width - 12, 13, { align: "right" });

  doc.setTextColor(...PDF_COLORS.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  const titleLines = doc.splitTextToSize(title, width - 24);
  doc.text(titleLines, 12, 43);
  let y = 43 + (titleLines.length - 1) * 7;
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.muted);
    const lines = doc.splitTextToSize(subtitle, width - 24);
    doc.text(lines, 12, y + 7);
    y += 7 + (lines.length - 1) * 4.5;
  }
  return y + 8;
}

/** Rodapé em todas as páginas. */
export function drawPdfFooters(doc: jsPDF, generatedBy: string) {
  const pages = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.line(12, height - 14, width - 12, height - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.muted);
    const origin = isDemoMode ? "Ambiente de demonstração da Central Yawara" : "Gerado no navegador a partir dos dados registrados na Central Yawara";
    doc.text(`Gerado em ${formatDateTimeShort(new Date().toISOString())} por ${generatedBy} · ${origin}`, 12, height - 9);
    doc.text(`Página ${i} de ${pages}`, width - 12, height - 9, { align: "right" });
  }
}

export async function autoTable() {
  return (await import("jspdf-autotable")).autoTable;
}

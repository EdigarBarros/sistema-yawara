import type { Meeting } from "@/types";
import { MEETING_MODE_LABELS, MEETING_STATUS } from "@/lib/labels";
import { formatDate, formatTime } from "@/lib/format";
import { createPdf, drawPdfFooters, drawPdfHeader, PDF_COLORS, slugify } from "@/lib/export/common";

interface Ctx {
  meeting: Meeting;
  memberName: (id?: string) => string;
  roleName: (memberId?: string) => string | undefined;
  documentName: (id: string) => string | undefined;
  generatedBy: string;
}

/** Ata em PDF com formatação institucional. Campos vazios aparecem como "Não registrado" — nada é inventado. */
export async function exportMeetingPdf({ meeting: m, memberName, roleName, documentName, generatedBy }: Ctx) {
  const doc = await createPdf("portrait");
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const maxW = width - 24;
  let y = await drawPdfHeader(
    doc,
    `Ata — ${m.title}`,
    `${formatDate(m.date)} · ${formatTime(m.startTime)}${m.endTime ? ` às ${formatTime(m.endTime)}` : ""} · ${MEETING_MODE_LABELS[m.mode]} · ${m.location}`,
  );

  const ensure = (h: number) => {
    if (y + h > height - 22) {
      doc.addPage();
      y = 20;
    }
  };
  const heading = (text: string) => {
    ensure(14);
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.goldDark);
    doc.text(text.toUpperCase(), 12, y);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.line(12, y + 1.8, width - 12, y + 1.8);
    y += 7;
  };
  const paragraph = (text: string, opts: { muted?: boolean; indent?: number } = {}) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...(opts.muted ? PDF_COLORS.muted : PDF_COLORS.text));
    const lines = doc.splitTextToSize(text, maxW - (opts.indent ?? 0));
    for (const line of lines) {
      ensure(6);
      doc.text(line, 12 + (opts.indent ?? 0), y);
      y += 5;
    }
  };
  const list = (items: string[], numbered = true) => {
    if (items.length === 0) return paragraph("Não registrado.", { muted: true });
    items.forEach((item, i) => {
      const prefix = numbered ? `${i + 1}.` : "•";
      ensure(6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...PDF_COLORS.text);
      doc.text(prefix, 12, y);
      paragraph(item, { indent: 7 });
      y += 1;
    });
  };

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text(`Registro ${m.code} · Situação: ${MEETING_STATUS[m.status].label}`, 12, y);
  y += 6;

  heading("Participantes");
  paragraph(m.participantIds.map((id) => `${memberName(id)}${roleName(id) ? ` (${roleName(id)})` : ""}`).join("; ") + ".");

  heading("Pauta");
  list(m.agenda);

  heading("Resumo das discussões");
  if (m.summary.trim()) paragraph(m.summary);
  else paragraph("Não registrado.", { muted: true });

  heading("Decisões");
  list(m.decisions);

  heading("Encaminhamentos");
  list(m.actions.map((a) => `${a.description}${a.responsibleId ? ` — responsável: ${memberName(a.responsibleId)}` : ""}${a.dueDate ? ` — prazo: ${formatDate(a.dueDate)}` : ""}`));

  if (m.documentIds.length) {
    heading("Documentos relacionados");
    list(m.documentIds.map((id) => documentName(id) ?? "Documento não disponível para este perfil"), false);
  }

  ensure(30);
  y += 10;
  doc.setDrawColor(...PDF_COLORS.line);
  doc.line(12, y, 90, y);
  doc.line(width - 90, y, width - 12, y);
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("Secretaria-geral", 12, y + 4.5);
  doc.text("Presidência", width - 90, y + 4.5);
  doc.text("Assinaturas não têm validade: documento gerado em ambiente de demonstração.", 12, y + 11);

  drawPdfFooters(doc, generatedBy);
  doc.save(`ata-${slugify(m.title)}.pdf`);
}

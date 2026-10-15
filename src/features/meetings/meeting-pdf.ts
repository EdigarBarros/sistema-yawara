import type { HistoryEntry, Meeting } from "@/types";
import { MEETING_MODE_LABELS, MEETING_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { createPdf, drawPdfFooters, drawPdfHeader, PDF_COLORS, slugify } from "@/lib/export/common";

interface Ctx {
  meeting: Meeting;
  memberName: (id?: string) => string;
  roleName: (memberId?: string) => string | undefined;
  documentName: (id: string) => string | undefined;
  /** Nome do evento relacionado, quando o perfil pode vê-lo. */
  eventName?: (id: string) => string | undefined;
  generatedBy: string;
}

/** Textos do histórico que registram uma aprovação (o atual e o usado em registros antigos da demonstração). */
const APPROVAL_SUMMARIES = ["Ata aprovada", `Situação alterada para ${MEETING_STATUS.approved.label}`];

/**
 * Registro da aprovação no histórico da ata (quem aprovou e quando), se houver.
 * Só faz sentido para atas aprovadas ou arquivadas; nada é deduzido além do que foi registrado.
 */
export function approvalEntry(m: Pick<Meeting, "status" | "history">): HistoryEntry | undefined {
  if (m.status !== "approved" && m.status !== "archived") return undefined;
  return [...m.history].reverse().find((h) => h.action === "status" && APPROVAL_SUMMARIES.includes(h.summary));
}

/** Ata em PDF com formatação institucional. Campos vazios aparecem como "Não registrado" — nada é inventado. */
export async function exportMeetingPdf({ meeting: m, memberName, roleName, documentName, eventName, generatedBy }: Ctx) {
  const doc = await createPdf("portrait");
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const maxW = width - 24;
  const approved = m.status === "approved" || m.status === "archived";
  const approval = approvalEntry(m);

  /** Marca d'água das atas não aprovadas, desenhada sob o conteúdo de cada página. */
  const watermark = () => {
    if (approved) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(46);
    doc.setTextColor(238, 226, 226);
    doc.text(m.status === "draft" ? "RASCUNHO" : "NÃO APROVADA", width / 2, height / 2 + 20, { align: "center", angle: 35 });
  };

  let y = await drawPdfHeader(
    doc,
    `Ata — ${m.title}`,
    `${formatDate(m.date)} · ${formatTime(m.startTime)}${m.endTime ? ` às ${formatTime(m.endTime)}` : ""} · ${MEETING_MODE_LABELS[m.mode]} · ${m.location}`,
  );
  watermark();

  const ensure = (h: number) => {
    if (y + h > height - 22) {
      doc.addPage();
      watermark();
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
  y += 5;

  // Situação real da ata: aprovação registrada (quem e quando) ou marca clara de que não foi aprovada.
  const statusLines = approved
    ? [
        approval
          ? `Ata aprovada por ${memberName(approval.actorId)} em ${formatDateTime(approval.at)}.`
          : "Ata aprovada. O registro de quem aprovou não está mais disponível no histórico resumido (consulte a auditoria).",
        ...(m.status === "archived" ? ["Ata arquivada: mantida para consulta."] : []),
      ]
    : [`Ata não aprovada — ${m.status === "draft" ? "rascunho" : "aguardando aprovação"}.`, "Este documento não tem validade como ata oficial."];
  doc.setFontSize(9.5);
  const boxLines = statusLines.flatMap((l) => doc.splitTextToSize(l, maxW - 8) as string[]);
  const boxH = 5 + boxLines.length * 4.6;
  ensure(boxH + 4);
  if (approved) {
    doc.setFillColor(232, 246, 238);
    doc.setDrawColor(120, 180, 140);
  } else {
    doc.setFillColor(253, 240, 228);
    doc.setDrawColor(214, 140, 70);
  }
  doc.rect(12, y, maxW, boxH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...(approved ? ([28, 110, 60] as [number, number, number]) : ([150, 70, 10] as [number, number, number])));
  boxLines.forEach((line, i) => doc.text(line, 16, y + 5.2 + i * 4.6));
  y += boxH + 4;

  heading("Participantes");
  paragraph(m.participantIds.map((id) => `${memberName(id)}${roleName(id) ? ` (${roleName(id)})` : ""}`).join("; ") + ".");

  const guests = m.guests ?? [];
  if (guests.length) {
    heading("Convidados externos");
    paragraph(guests.join("; ") + ".");
  }

  if (m.eventId) {
    heading("Evento relacionado");
    const name = eventName?.(m.eventId);
    paragraph(name ?? "Evento não disponível para este perfil.", { muted: !name });
  }

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
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("Secretaria-geral", 12, y + 4.5);
  doc.text("Presidência", width - 90, y + 4.5);
  const note = isDemoMode
    ? "Assinaturas não têm validade: documento gerado em ambiente de demonstração."
    : approved
      ? "Cópia gerada a partir da ata aprovada registrada na Central. A via oficial é a assinada."
      : "Ata ainda não aprovada: não colha assinaturas nesta versão.";
  doc.text(note, 12, y + 11);

  drawPdfFooters(doc, generatedBy);
  doc.save(`ata-${slugify(m.title)}.pdf`);
}

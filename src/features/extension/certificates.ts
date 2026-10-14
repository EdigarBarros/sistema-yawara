import type { ExtensionProject } from "@/types";
import { ACTIVITY_TYPE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { createPdf, loadLogo, PDF_COLORS, slugify } from "@/lib/export/common";

/**
 * Certificados DEMONSTRATIVOS (sem validade) para quem teve presença marcada.
 * Cada participante recebe uma página em A4 paisagem.
 */
export async function exportCertificatesPdf(project: ExtensionProject, signerName: string) {
  const present = project.attendees.filter((a) => a.present);
  if (present.length === 0) throw new Error("Nenhum participante com presença marcada.");
  const doc = await createPdf("landscape");
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const logo = await loadLogo();

  present.forEach((a, i) => {
    if (i > 0) doc.addPage();
    doc.setFillColor(...PDF_COLORS.navy);
    doc.rect(0, 0, w, h, "F");
    doc.setDrawColor(...PDF_COLORS.gold);
    doc.setLineWidth(0.8);
    doc.rect(10, 10, w - 20, h - 20, "S");
    doc.setLineWidth(0.2);
    doc.rect(13, 13, w - 26, h - 26, "S");
    if (logo) doc.addImage(logo, "PNG", w / 2 - 14, 22, 28, 28);

    doc.setTextColor(...PDF_COLORS.gold);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("CERTIFICADO", w / 2, 62, { align: "center" });
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text("Certificamos que", w / 2, 78, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text(a.name, w / 2, 93, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    const line = `participou da atividade “${project.name}” (${ACTIVITY_TYPE_LABELS[project.activityType].toLowerCase()}), realizada em ${formatDate(project.date)}${
      project.certificateHours ? `, com carga horária de ${project.certificateHours} hora(s)` : ""
    }, promovida pela Associação Atlética Acadêmica de Psicologia Yawara.`;
    doc.text(doc.splitTextToSize(line, w - 80), w / 2, 108, { align: "center" });

    doc.setDrawColor(200, 210, 235);
    doc.line(w / 2 - 50, h - 48, w / 2 + 50, h - 48);
    doc.setFontSize(10);
    doc.text(signerName, w / 2, h - 42, { align: "center" });
    doc.setTextColor(200, 210, 235);
    doc.setFontSize(8.5);
    doc.text("Ensino e Extensão · Atlética Yawara", w / 2, h - 37, { align: "center" });

    doc.setTextColor(...PDF_COLORS.gold);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DOCUMENTO DE DEMONSTRAÇÃO · SEM VALIDADE · PARTICIPANTE FICTÍCIO", w / 2, h - 20, { align: "center" });
  });

  doc.save(`certificados-${slugify(project.name)}.pdf`);
  return present.length;
}

/** Lista de presença em CSV. */
export function attendanceRows(project: ExtensionProject) {
  return [["participante", "presenca"], ...project.attendees.map((a) => [a.name, a.present ? "Presente" : "Ausente"])];
}

import type { ExtensionProject } from "@/types";
import { ACTIVITY_TYPE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { createPdf, loadLogo, PDF_COLORS, slugify } from "@/lib/export/common";
import { ServiceError } from "@/services/errors";
import { RESTRICTED_ATTENDEES_TEXT } from "./labels";

/** Participantes com presença marcada (a partir da lista registrada). Recusa listas restritas ao perfil. */
export function presentAttendees(project: ExtensionProject) {
  if (project.attendeesRestricted) throw new ServiceError("forbidden", `${RESTRICTED_ATTENDEES_TEXT}.`);
  return project.attendees.filter((a) => a.present);
}

/**
 * Certificados em PDF, gerados no navegador a partir dos dados registrados,
 * somente para quem teve presença marcada. Cada participante recebe uma
 * página em A4 paisagem. No modo demonstração levam a marca "sem validade".
 *
 * `onBeforeSave` roda depois de montar o PDF e antes de entregá-lo (ex.:
 * registrar a exportação na auditoria — fechar a aba logo após o download não
 * pode perder o registro).
 */
export async function exportCertificatesPdf(project: ExtensionProject, signerName: string, { onBeforeSave }: { onBeforeSave?: (count: number) => Promise<void> } = {}) {
  const present = presentAttendees(project);
  if (present.length === 0) throw new ServiceError("invalid", "Nenhum participante com presença marcada. Marque a presença antes de gerar os certificados.");
  const doc = await createPdf("landscape");
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const logo = await loadLogo();
  const generatedOn = formatDate(new Date().toISOString());

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

    if (isDemoMode) {
      doc.setTextColor(...PDF_COLORS.gold);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("DOCUMENTO DE DEMONSTRAÇÃO · SEM VALIDADE · PARTICIPANTE FICTÍCIO", w / 2, h - 20, { align: "center" });
    } else {
      doc.setTextColor(200, 210, 235);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`${project.code} · Gerado em ${generatedOn} pela Central Yawara`, w / 2, h - 20, { align: "center" });
    }
  });

  await onBeforeSave?.(present.length);
  doc.save(`certificados-${slugify(project.name)}.pdf`);
  return present.length;
}

/** Lista de presença em CSV (recusa listas restritas ao perfil). */
export function attendanceRows(project: ExtensionProject) {
  if (project.attendeesRestricted) throw new ServiceError("forbidden", `${RESTRICTED_ATTENDEES_TEXT}.`);
  return [["participante", "presenca"], ...project.attendees.map((a) => [a.name, a.present ? "Presente" : "Ausente"])];
}

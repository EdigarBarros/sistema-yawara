import type { CertificateStatus, ExtensionProject } from "@/types";
import { CERTIFICATE_STATUS, type StatusMeta } from "@/lib/labels";
import { isDemoMode } from "@/lib/mode";

/** Situação dos certificados com texto adequado ao modo (no Firebase não há "demonstração"). */
export function certificateStatusMeta(status: CertificateStatus): StatusMeta {
  const meta = CERTIFICATE_STATUS[status];
  return isDemoMode || status !== "issued" ? meta : { ...meta, label: "Emitidos" };
}

/** Total de inscritos, mesmo quando a lista de nomes é restrita ao perfil. */
export function attendeeTotal(p: Pick<ExtensionProject, "attendees" | "attendeeCount" | "attendeesRestricted">) {
  return p.attendeesRestricted ? (p.attendeeCount ?? 0) : p.attendees.length;
}

export const RESTRICTED_ATTENDEES_TEXT = "Lista restrita a quem organiza o projeto";

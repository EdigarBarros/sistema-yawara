import type { AuditService } from "../contracts";
import type { AuditLogEntry, HistoryEntry, ModuleKey } from "@/types";
import { getDB } from "./db";
import { accessContext, latency, requirePermission } from "./context";

/**
 * Demonstração: a "auditoria" é montada a partir dos históricos dos registros
 * fictícios deste navegador. Com o Firebase, os registros vêm da coleção
 * oficial `auditLogs`, gravada somente pelo servidor.
 */
export const localAudit: AuditService = {
  async list(query) {
    await latency(120, 260);
    const db = getDB();
    const ctx = accessContext(db);
    requirePermission(ctx, "audit.view", "Seu perfil não pode consultar a auditoria.");
    const name = (id: string) => db.members.find((m) => m.id === id)?.name ?? "—";
    const collect = (module: ModuleKey, type: string, items: { id: string; history: HistoryEntry[] }[]) =>
      items.flatMap((item) =>
        item.history.map(
          (h): AuditLogEntry => ({
            id: h.id,
            at: h.at,
            actorId: h.actorId,
            actorName: name(h.actorId),
            action: `${module}.${h.action}`,
            module,
            resourceType: type,
            resourceId: item.id,
            outcome: "success",
            summary: h.summary,
          }),
        ),
      );
    let entries = [
      ...collect("campaigns", "campaign", db.campaigns),
      ...collect("campaigns", "sale", db.sales),
      ...collect("events", "event", db.events),
      ...collect("documents", "document", db.documents),
      ...collect("meetings", "meeting", db.meetings),
      ...collect("finance", "financeEntry", db.financeEntries),
      ...collect("marketing", "content", db.contents),
      ...collect("extension", "project", db.projects),
    ].sort((a, b) => b.at.localeCompare(a.at));
    if (query.module) entries = entries.filter((e) => e.module === query.module);
    if (query.actorId) entries = entries.filter((e) => e.actorId === query.actorId);
    if (query.resourceId) entries = entries.filter((e) => e.resourceId === query.resourceId);
    if (query.outcome) entries = entries.filter((e) => e.outcome === query.outcome);
    const size = Math.min(query.pageSize ?? 50, 100);
    const start = query.after ? entries.findIndex((e) => e.id === query.after) + 1 : 0;
    const page = entries.slice(start, start + size);
    return { entries: page, nextCursor: start + size < entries.length ? (page[page.length - 1]?.id ?? null) : null };
  },
};

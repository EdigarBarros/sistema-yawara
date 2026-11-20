import type { NotificationService, SearchService, SettingsService } from "../contracts";
import type { SearchResult } from "@/types";
import { canViewModule, hasPermission, matchesAudience } from "@/lib/permissions";
import { MODULE_MAP } from "@/lib/modules";
import { ENTRY_TYPE_LABELS, EVENT_TYPE_LABELS, MEETING_STATUS } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { matchesQuery, newId } from "@/lib/utils";
import { commit, getDB, resetDB } from "./db";
import { accessContext, clone, findOrThrow, latency, requirePermission, ServiceError } from "./context";
import { canSeeCampaign, canSeeContent, canSeeDocument, canSeeEvent, canSeeMeeting, canSeeProject, canSeeTeam } from "@/lib/policies";

function validName(name: string) {
  if (!name || name.trim().length < 2) throw new ServiceError("invalid", "Informe um nome com pelo menos 2 caracteres.");
  return name.trim();
}

export const localSettings: SettingsService = {
  async get() {
    await latency(60, 140);
    return clone(getDB().settings);
  },

  async updateInstitution(input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "settings.edit", "Seu perfil não pode editar os dados institucionais.");
      if (input.systemName !== undefined && input.systemName.trim().length < 3) {
        throw new ServiceError("invalid", "O nome do sistema precisa ter pelo menos 3 caracteres.");
      }
      if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new ServiceError("invalid", "Informe um e-mail válido.");
      Object.assign(db.settings.institution, input);
      return clone(db.settings);
    });
  },

  async setModuleEnabled(module, enabled) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "settings.admin", "Seu perfil não pode ativar ou desativar módulos.");
      if (MODULE_MAP[module].core) throw new ServiceError("invalid", "Este módulo é essencial e não pode ser desativado.");
      db.settings.modules[module] = enabled;
      return clone(db.settings);
    });
  },

  async createDocumentCategory(name) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "settings.edit", "Seu perfil não pode alterar categorias.");
      const clean = validName(name);
      if (db.documentCategories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new ServiceError("conflict", "Essa categoria já existe.");
      const cat = { id: newId("dcat"), name: clean };
      db.documentCategories.push(cat);
      return clone(cat);
    });
  },

  async renameDocumentCategory(id, name) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "settings.edit", "Seu perfil não pode alterar categorias.");
      const cat = findOrThrow(db.documentCategories, id, "Categoria");
      cat.name = validName(name);
      return clone(cat);
    });
  },

  async createFinanceCategory(name, type) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "settings.edit", "Seu perfil não pode alterar categorias.");
      const clean = validName(name);
      if (db.financeCategories.some((c) => c.type === type && c.name.toLowerCase() === clean.toLowerCase())) {
        throw new ServiceError("conflict", "Essa categoria já existe.");
      }
      const cat = { id: newId("fcat"), name: clean, type };
      db.financeCategories.push(cat);
      return clone(cat);
    });
  },

  async renameFinanceCategory(id, name) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "settings.edit", "Seu perfil não pode alterar categorias.");
      const cat = findOrThrow(db.financeCategories, id, "Categoria");
      cat.name = validName(name);
      return clone(cat);
    });
  },

  async resetDemoData() {
    await latency(400, 700);
    resetDB();
  },
};

export const localNotifications: NotificationService = {
  async list() {
    await latency(80, 180);
    const db = getDB();
    const ctx = accessContext(db);
    return clone(
      db.notifications
        .filter((n) => n.actorId !== ctx.user.id && matchesAudience(ctx, n.audience))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },

  async markRead(id) {
    await latency(40, 100);
    commit((db) => {
      const ctx = accessContext(db);
      const n = findOrThrow(db.notifications, id, "Notificação");
      if (!n.readBy.includes(ctx.user.id)) n.readBy.push(ctx.user.id);
    });
  },

  async markAllRead() {
    await latency(80, 160);
    commit((db) => {
      const ctx = accessContext(db);
      for (const n of db.notifications) {
        if (matchesAudience(ctx, n.audience) && !n.readBy.includes(ctx.user.id)) n.readBy.push(ctx.user.id);
      }
    });
  },
};

/** Busca nos dados que o perfil atual pode ver — nada oculto aparece nos resultados. */
export const localSearch: SearchService = {
  async search(query) {
    await latency(80, 180);
    const q = query.trim();
    if (q.length < 2) return [];
    const db = getDB();
    const ctx = accessContext(db);
    const on = (m: keyof typeof db.settings.modules) => db.settings.modules[m] && canViewModule(ctx, m);
    const results: SearchResult[] = [];

    if (on("campaigns")) {
      for (const c of db.campaigns) {
        if (canSeeCampaign(ctx, c) && matchesQuery(q, c.name, c.prize, c.code, c.description)) {
          results.push({ id: c.id, kind: "campaign", title: c.name, subtitle: `${c.code} · ${c.prize}`, href: `/campanhas/${c.id}`, at: c.updatedAt });
        }
      }
    }
    if (on("events")) {
      for (const e of db.events) {
        if (canSeeEvent(ctx, e) && matchesQuery(q, e.name, e.location, e.code, e.description)) {
          results.push({ id: e.id, kind: "event", title: e.name, subtitle: `${EVENT_TYPE_LABELS[e.type]} · ${formatDate(e.date)}`, href: `/eventos/${e.id}`, at: e.updatedAt });
        }
      }
    }
    if (on("documents")) {
      for (const d of db.documents) {
        const category = db.documentCategories.find((c) => c.id === d.categoryId)?.name;
        if (canSeeDocument(ctx, d) && matchesQuery(q, d.name, d.description, category)) {
          results.push({ id: d.id, kind: "document", title: d.name, subtitle: category ?? "Documento", href: `/documentos/${d.id}`, at: d.updatedAt });
        }
      }
    }
    if (on("meetings")) {
      for (const m of db.meetings) {
        if (canSeeMeeting(ctx, m) && matchesQuery(q, m.title, m.code, m.agenda.join(" "), m.summary)) {
          results.push({ id: m.id, kind: "meeting", title: m.title, subtitle: `${formatDate(m.date)} · ${MEETING_STATUS[m.status].label}`, href: `/secretaria/${m.id}`, at: m.updatedAt });
        }
      }
    }
    if (on("finance") && hasPermission(ctx, "finance.view")) {
      for (const f of db.financeEntries) {
        if (matchesQuery(q, f.description, f.code)) {
          results.push({ id: f.id, kind: "finance", title: f.description, subtitle: `${ENTRY_TYPE_LABELS[f.type]} · ${formatMoney(f.amount)} · ${formatDate(f.date)}`, href: `/financeiro/lancamentos?id=${f.id}`, at: f.updatedAt });
        }
      }
    }
    if (on("extension")) {
      for (const p of db.projects) {
        if (canSeeProject(ctx, p) && matchesQuery(q, p.name, p.code, p.description)) {
          results.push({ id: p.id, kind: "project", title: p.name, subtitle: `${p.code} · ${formatDate(p.date)}`, href: `/extensao/${p.id}`, at: p.updatedAt });
        }
      }
    }
    if (on("sports")) {
      for (const t of db.sportsTeams) {
        if (canSeeTeam(ctx, t) && matchesQuery(q, t.name, t.code, t.sport, t.coach ?? "", t.description)) {
          results.push({ id: t.id, kind: "team", title: t.name, subtitle: `${t.code} · ${t.sport}`, href: `/esportes/${t.id}`, at: t.updatedAt });
        }
      }
    }
    if (on("marketing")) {
      for (const c of db.contents) {
        if (canSeeContent(ctx, c) && matchesQuery(q, c.title, c.code, c.briefing)) {
          results.push({ id: c.id, kind: "content", title: c.title, subtitle: `${c.code}${c.publishDate ? ` · publicação ${formatDate(c.publishDate)}` : ""}`, href: `/marketing?item=${c.id}`, at: c.updatedAt });
        }
      }
    }
    return results.slice(0, 60);
  },
};

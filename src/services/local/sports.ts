import type { ItemInput, SportsService, TeamInput, TeamList } from "../contracts";
import type { Athlete, Competition, Match, SportTeam, TrainingSlot } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import type { AccessContext } from "@/lib/permissions";
import { TEAM_STATUS } from "@/lib/labels";
import { newId } from "@/lib/utils";
import { canArchiveTeam, canEditTeam, canSeeTeam } from "@/lib/policies";
import { commit, getDB } from "./db";
import { accessContext, clone, findOrThrow, historyEntry, latency, nextCode, now, requireModuleEnabled, requirePermission, sanitizeAudience, ServiceError, validateAudience } from "./context";

const LIST_LABEL: Record<TeamList, string> = { trainings: "Treino", athletes: "Atleta", matches: "Jogo", competitions: "Competição" };

function visible(db: DemoDB, ctx: AccessContext, id: string) {
  const t = findOrThrow(db.sportsTeams, id, "Modalidade");
  if (!canSeeTeam(ctx, t)) throw new ServiceError("forbidden", "Esta modalidade não está disponível para o seu perfil.");
  return t;
}

function editable(db: DemoDB, ctx: AccessContext, id: string) {
  const t = visible(db, ctx, id);
  if (!canEditTeam(ctx, t)) throw new ServiceError("forbidden", "Seu perfil não pode editar esta modalidade.");
  if (t.status === "archived") throw new ServiceError("conflict", "A modalidade está arquivada. Reative-a para editar.");
  return t;
}

function validate(input: Partial<TeamInput>, creating: boolean) {
  if ((creating || input.name !== undefined) && (!input.name || input.name.trim().length < 3)) throw new ServiceError("invalid", "Informe o nome da modalidade.");
  if ((creating || input.sport !== undefined) && (!input.sport || input.sport.trim().length < 2)) throw new ServiceError("invalid", "Informe o esporte.");
  if (input.access) validateAudience(input.access, "Visibilidade");
}

function touch(t: SportTeam, actorId: string, summary: string, action: "updated" | "status" | "archived" | "restored" = "updated") {
  t.updatedAt = now();
  t.history.push(historyEntry(actorId, action, summary));
}

/** Inclui ou atualiza um item de uma das listas (mesma regra do servidor). */
function save<T extends { id: string }>(id: string, list: TeamList, item: ItemInput<T>, check?: (team: SportTeam, itemId: string) => void, sort?: (a: T, b: T) => number) {
  return commit((db) => {
    const ctx = accessContext(db);
    const t = editable(db, ctx, id);
    const items = t[list] as unknown as T[];
    if (item.id && !items.some((i) => i.id === item.id)) throw new ServiceError("not_found", `${LIST_LABEL[list]} não encontrado(a). Pode ter sido removido(a).`);
    const itemId = item.id ?? newId(list.slice(0, 3));
    check?.(t, itemId);
    const saved = { ...item, id: itemId } as T;
    let next = item.id ? items.map((i) => (i.id === item.id ? saved : i)) : [...items, saved];
    if (sort) next = [...next].sort(sort);
    (t as unknown as Record<TeamList, T[]>)[list] = next;
    touch(t, ctx.user.id, `${LIST_LABEL[list]} ${item.id ? "atualizado(a)" : "adicionado(a)"}`);
    return clone(t);
  });
}

const byDate = (a: { date: string; time?: string }, b: { date: string; time?: string }) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "");

export const localSports: SportsService = {
  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "sports");
    const ctx = accessContext(db);
    return clone(db.sportsTeams.filter((t) => canSeeTeam(ctx, t)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "sports");
    return clone(visible(db, accessContext(db), id));
  },

  async create(input) {
    await latency(300, 550);
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "sports.create", "Seu perfil não pode criar modalidades.");
      validate(input, true);
      const at = now();
      const team: SportTeam = {
        id: newId("esp"),
        code: nextCode(db, "ESP"),
        name: input.name.trim(),
        sport: input.sport.trim(),
        category: input.category,
        description: input.description.trim(),
        coach: input.coach?.trim() || undefined,
        responsibleId: input.responsibleId,
        status: "active",
        trainings: [],
        athletes: [],
        matches: [],
        competitions: [],
        access: sanitizeAudience(input.access),
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", "Modalidade criada")],
      };
      db.sportsTeams.unshift(team);
      return clone(team);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const t = editable(db, ctx, id);
      validate(input, false);
      Object.assign(t, input, input.access ? { access: sanitizeAudience(input.access) } : {});
      if ("coach" in input && !input.coach) t.coach = undefined;
      touch(t, ctx.user.id, "Modalidade editada");
      return clone(t);
    });
  },

  async setStatus(id, status) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const t = visible(db, ctx, id);
      if (!canArchiveTeam(ctx, t)) throw new ServiceError("forbidden", "Seu perfil não pode pausar, arquivar ou reativar modalidades.");
      if (t.status === status) return clone(t);
      t.status = status;
      touch(t, ctx.user.id, `Situação alterada para ${TEAM_STATUS[status].label}`, status === "archived" ? "archived" : status === "active" ? "restored" : "status");
      return clone(t);
    });
  },

  async saveTraining(id, item) {
    await latency();
    if (!item.location?.trim()) throw new ServiceError("invalid", "Informe o local do treino.");
    if (item.end && item.end <= item.start) throw new ServiceError("invalid", "O término precisa ser depois do início.");
    return save<TrainingSlot>(id, "trainings", { ...item, end: item.end || undefined }, undefined, (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  },

  async saveAthlete(id, item) {
    await latency();
    const name = item.name.replace(/\s+/g, " ").trim();
    if (name.length < 2) throw new ServiceError("invalid", "Informe o nome do(a) atleta.");
    if (item.number && !/^\d{1,4}$/.test(item.number)) throw new ServiceError("invalid", "O número da camisa deve ter só algarismos.");
    return save<Athlete>(
      id,
      "athletes",
      { ...item, name, number: item.number || undefined, position: item.position?.trim() || undefined, captain: item.captain || undefined },
      (t, itemId) => {
        if (t.athletes.some((a) => a.id !== itemId && a.name.toLowerCase() === name.toLowerCase())) throw new ServiceError("conflict", "Este nome já está no elenco.");
        if (item.number && t.athletes.some((a) => a.id !== itemId && a.number === item.number)) throw new ServiceError("conflict", `A camisa ${item.number} já é de outra pessoa do elenco.`);
      },
      (a, b) => Number(a.number ?? 9999) - Number(b.number ?? 9999) || a.name.localeCompare(b.name, "pt-BR"),
    );
  },

  async saveMatch(id, item) {
    await latency();
    if (!item.opponent?.trim()) throw new ServiceError("invalid", "Informe o adversário.");
    if ((item.scoreFor == null) !== (item.scoreAgainst == null)) throw new ServiceError("invalid", "Informe o placar dos dois lados (ou deixe os dois em branco).");
    return save<Match>(id, "matches", { ...item, competitionId: item.competitionId || undefined, time: item.time || undefined, notes: item.notes?.trim() || undefined }, undefined, byDate);
  },

  async saveCompetition(id, item) {
    await latency();
    if (!item.name?.trim()) throw new ServiceError("invalid", "Informe o nome da competição.");
    if (item.endDate && item.endDate < item.startDate) throw new ServiceError("invalid", "O término precisa ser no mesmo dia ou depois do início.");
    return save<Competition>(id, "competitions", { ...item, endDate: item.endDate || undefined, placement: item.placement?.trim() || undefined }, undefined, (a, b) => a.startDate.localeCompare(b.startDate));
  },

  async removeItem(id, list, itemId) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const t = editable(db, ctx, id);
      const items = t[list] as { id: string }[];
      if (!items.some((i) => i.id === itemId)) throw new ServiceError("not_found", `${LIST_LABEL[list]} não encontrado(a). Pode já ter sido removido(a).`);
      (t as unknown as Record<TeamList, { id: string }[]>)[list] = items.filter((i) => i.id !== itemId);
      if (list === "competitions") t.matches = t.matches.map((m) => (m.competitionId === itemId ? { ...m, competitionId: undefined } : m));
      touch(t, ctx.user.id, `${LIST_LABEL[list]} removido(a)`);
      return clone(t);
    });
  },
};

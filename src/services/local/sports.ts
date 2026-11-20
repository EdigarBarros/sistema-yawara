import type { SportsService, TeamInput } from "../contracts";
import type { SportTeam } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import type { AccessContext } from "@/lib/permissions";
import { athleteError, cleanLineup, cleanSession, MODALITIES, SPORT_LIMITS, sessionError, SESSION_KIND_LABELS, withAthlete, withoutAthlete } from "@/lib/sports";
import { canArchiveTeam, canEditTeam, canEditTeamSettings, canSeeTeam } from "@/lib/policies";
import { newId } from "@/lib/utils";
import { commit, getDB } from "./db";
import { accessContext, clone, findOrThrow, historyEntry, latency, nextCode, now, requireModuleEnabled, requirePermission, sanitizeAudience, ServiceError, validateAudience } from "./context";

function visibleTeam(db: DemoDB, ctx: AccessContext, id: string) {
  const team = findOrThrow(db.teams, id, "Time");
  if (!canSeeTeam(ctx, team)) throw new ServiceError("forbidden", "Este time não está disponível para o seu perfil.");
  return team;
}

function editableTeam(db: DemoDB, ctx: AccessContext, id: string) {
  requireModuleEnabled(db, "sports");
  const team = visibleTeam(db, ctx, id);
  if (!canEditTeam(ctx, team)) throw new ServiceError("forbidden", "Seu perfil não pode alterar este time.");
  if (team.status === "archived") throw new ServiceError("conflict", "Este time está arquivado. Reative-o antes de alterar.");
  return team;
}

function validate(input: Partial<TeamInput>, creating: boolean) {
  if (creating || input.name !== undefined) {
    if (!input.name || input.name.trim().length < 3) throw new ServiceError("invalid", "Informe o nome do time (mínimo de 3 caracteres).");
  }
  if (input.modality !== undefined && !MODALITIES.includes(input.modality)) throw new ServiceError("invalid", "Escolha uma modalidade válida.");
  if (input.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.color)) throw new ServiceError("invalid", "Escolha uma cor válida.");
  if (input.coachIds && input.coachIds.length > SPORT_LIMITS.coaches) throw new ServiceError("invalid", `Escolha no máximo ${SPORT_LIMITS.coaches} técnicos(as).`);
  if (input.access) validateAudience(input.access, "Visibilidade");
}

/** Troca o time no banco e devolve a cópia. */
function save(db: DemoDB, next: SportTeam) {
  next.updatedAt = now();
  db.teams = db.teams.map((t) => (t.id === next.id ? next : t));
  return clone(next);
}

export const localSports: SportsService = {
  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "sports");
    const ctx = accessContext(db);
    return clone(db.teams.filter((t) => canSeeTeam(ctx, t)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "sports");
    return clone(visibleTeam(db, accessContext(db), id));
  },

  async create(input) {
    await latency(300, 550);
    return commit((db) => {
      requireModuleEnabled(db, "sports");
      const ctx = accessContext(db);
      requirePermission(ctx, "sports.create", "Seu perfil não pode criar times.");
      validate(input, true);
      const at = now();
      const team: SportTeam = {
        id: newId("tim"),
        code: nextCode(db, "TIM"),
        name: input.name.trim(),
        modality: input.modality,
        category: input.category,
        color: input.color,
        departmentId: input.departmentId,
        coachIds: [...new Set(input.coachIds)],
        access: sanitizeAudience(input.access),
        status: "active",
        athletes: [],
        lineup: { formation: "", slots: [] },
        sessions: [],
        notes: input.notes?.trim() || undefined,
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", "Time criado")],
      };
      db.teams.unshift(team);
      return clone(team);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const team = editableTeam(db, ctx, id);
      if (!canEditTeamSettings(ctx, team)) throw new ServiceError("forbidden", "Seu perfil não pode editar os dados deste time.");
      validate(input, false);
      if (input.modality && input.modality !== team.modality && team.athletes.length > 0) throw new ServiceError("conflict", "Não dá para trocar a modalidade de um time que já tem atletas.");
      const next: SportTeam = {
        ...team,
        ...input,
        name: input.name?.trim() ?? team.name,
        coachIds: input.coachIds ? [...new Set(input.coachIds)] : team.coachIds,
        access: input.access ? sanitizeAudience(input.access) : team.access,
        notes: "notes" in input ? input.notes?.trim() || undefined : team.notes,
        history: [...team.history, historyEntry(ctx.user.id, "updated", "Dados do time editados")],
      };
      return save(db, next);
    });
  },

  async setStatus(id, status) {
    await latency();
    return commit((db) => {
      requireModuleEnabled(db, "sports");
      const ctx = accessContext(db);
      const team = visibleTeam(db, ctx, id);
      if (!canArchiveTeam(ctx, team)) throw new ServiceError("forbidden", "Seu perfil não pode arquivar ou reativar este time.");
      if (team.status === status) return clone(team);
      const label = status === "archived" ? "Time arquivado" : "Time reativado";
      return save(db, { ...team, status, history: [...team.history, historyEntry(ctx.user.id, status === "archived" ? "archived" : "restored", label)] });
    });
  },

  async saveAthlete(teamId, input, athleteId) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const team = editableTeam(db, ctx, teamId);
      const error = athleteError(team, input, athleteId);
      if (error) throw new ServiceError("invalid", error);
      const next = withAthlete(team, input, athleteId ?? newId("atl"));
      next.history = [...team.history, historyEntry(ctx.user.id, "updated", athleteId ? "Atleta editado(a)" : "Atleta incluído(a) no elenco")];
      return save(db, next);
    });
  },

  async removeAthlete(teamId, athleteId) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const team = editableTeam(db, ctx, teamId);
      if (!team.athletes.some((a) => a.id === athleteId)) throw new ServiceError("not_found", "Atleta não encontrado(a) neste time.");
      const next = withoutAthlete(team, athleteId);
      next.history = [...team.history, historyEntry(ctx.user.id, "updated", "Atleta removido(a) do elenco")];
      return save(db, next);
    });
  },

  async saveLineup(teamId, lineup) {
    await latency(200, 400);
    return commit((db) => {
      const ctx = accessContext(db);
      const team = editableTeam(db, ctx, teamId);
      const result = cleanLineup(team, lineup);
      if ("error" in result) throw new ServiceError("invalid", result.error);
      return save(db, {
        ...team,
        lineup: { ...result.lineup, updatedAt: now(), updatedBy: ctx.user.id },
        history: [...team.history, historyEntry(ctx.user.id, "updated", "Escalação salva")],
      });
    });
  },

  async saveSession(teamId, input, sessionId) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const team = editableTeam(db, ctx, teamId);
      const error = sessionError(input);
      if (error) throw new ServiceError("invalid", error);
      const current = sessionId ? team.sessions.find((s) => s.id === sessionId) : undefined;
      if (sessionId && !current) throw new ServiceError("not_found", "Treino ou jogo não encontrado.");
      if (!sessionId && team.sessions.length >= SPORT_LIMITS.sessions) throw new ServiceError("invalid", `O time pode ter no máximo ${SPORT_LIMITS.sessions} treinos e jogos.`);
      const at = now();
      const data = cleanSession(input);
      const sessions = current
        ? team.sessions.map((s) => (s.id === sessionId ? { ...data, id: s.id, createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: at } : s))
        : [...team.sessions, { ...data, id: newId("ses"), createdBy: ctx.user.id, createdAt: at, updatedAt: at }];
      const what = SESSION_KIND_LABELS[input.kind];
      return save(db, { ...team, sessions, history: [...team.history, historyEntry(ctx.user.id, "updated", current ? `${what} atualizado` : `${what} marcado`)] });
    });
  },
};

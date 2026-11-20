/**
 * ESPORTES: times, elenco, escalação, treinos e jogos.
 * ---------------------------------------------------------------------------
 * Armazenamento: `sportTeams/{id}` = sportTeamDoc(time). Elenco (até 40
 * atletas), escalação e treinos/jogos (até 300) ficam no próprio documento,
 * junto com `readers` (criador + técnicos + público), sempre recalculado aqui.
 *
 * Regras (as mesmas do serviço de demonstração, em src/lib/policies.ts e
 * src/lib/sports.ts):
 *  - Ver: `canSeeTeam` (público, criador, técnicos ou sports.admin).
 *  - Dados do time (nome, modalidade, técnicos, público): `canEditTeamSettings`.
 *  - Elenco, escalação, treinos e jogos: `canEditTeam` (sports.edit, criador
 *    ou técnicos). Time arquivado fica bloqueado até ser reativado.
 *  - Arquivar/reativar: criador ou sports.archive.
 *  - Escalação: só atletas ativos do elenco, sem repetir, no máximo o número
 *    de titulares da modalidade, posições presas aos limites da quadra.
 *  - Placar: só em amistosos e campeonatos realizados.
 *
 * A auditoria registra identificadores e contagens, não nomes de atletas.
 */
import { randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { sportTeamDoc } from "@/lib/firestore-model";
import { canArchiveTeam, canEditTeam, canEditTeamSettings, canSeeTeam } from "@/lib/policies";
import { teamReaders } from "@/lib/record-readers";
import { athleteError, cleanLineup, cleanSession, MODALITIES, SESSION_KIND_LABELS, SPORT_LIMITS, sessionError, withAthlete, withoutAthlete } from "@/lib/sports";
import type { Audience, AudienceScope, HistoryAction, SportModality, SportTeam } from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { nextCode } from "../core/counters";
import { mutation, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { appendHistory, historyEntry } from "../core/history";
import { requireDoc, toDTO } from "../core/records";

/* ------------------------------- esquemas ------------------------------- */

const AUDIENCE_SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const satisfies readonly AudienceScope[];

function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? "Alguns campos enviados não são aceitos nesta operação. Atualize a página e tente novamente." : undefined),
  });
}

const docId = z.string({ error: "Identificador inválido." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Identificador inválido.");
const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label} pode ter no máximo ${max} caracteres.`).nullish();

const audienceSchema = strict({
  scope: z.enum(AUDIENCE_SCOPES, { error: "Escolha quem pode ver o time." }),
  departmentId: z.union([docId, z.literal("")]).nullish(),
  roleIds: z.array(docId).max(50, "Escolha no máximo 50 cargos.").default([]),
  userIds: z.array(docId).max(100, "Escolha no máximo 100 pessoas.").default([]),
}).superRefine((a, ctx) => {
  if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos um cargo." });
  if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos uma pessoa." });
});

const teamFields = {
  name: z.string({ error: "Informe o nome do time (mínimo de 3 caracteres)." }).trim().min(3, "Informe o nome do time (mínimo de 3 caracteres).").max(80, "O nome do time pode ter no máximo 80 caracteres."),
  modality: z.enum(MODALITIES as [SportModality, ...SportModality[]], { error: "Escolha uma modalidade válida." }),
  category: z.enum(["masculino", "feminino", "misto"], { error: "Escolha a categoria do time." }),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Escolha uma cor válida."),
  departmentId: docId,
  coachIds: z.array(docId).max(SPORT_LIMITS.coaches, `Escolha no máximo ${SPORT_LIMITS.coaches} técnicos(as).`),
  access: audienceSchema,
  notes: optionalText(600, "As observações"),
};

const createSchema = strict(teamFields);
const updateSchema = strict({ id: docId, input: strict(teamFields).partial() });
const statusSchema = strict({ id: docId, status: z.enum(["active", "archived"], { error: "Situação inválida." }) });

const athleteSchema = strict({
  teamId: docId,
  athleteId: docId.nullish(),
  input: strict({
    name: z.string({ error: "Informe o nome do(a) atleta." }).trim(),
    number: z.number({ error: "Informe o número da camisa." }).int("Informe o número da camisa."),
    position: z.string({ error: "Escolha a posição." }).max(40),
    course: optionalText(80, "O curso"),
    memberId: z.union([docId, z.literal("")]).nullish(),
    active: z.boolean(),
  }),
});

const removeAthleteSchema = strict({ teamId: docId, athleteId: docId });

const lineupSchema = strict({
  teamId: docId,
  formation: z.string().max(40, "Formação inválida."),
  slots: z
    .array(strict({ athleteId: docId, x: z.number().finite(), z: z.number().finite() }))
    .max(11, "Escalação com titulares demais."),
});

const sessionSchema = strict({
  teamId: docId,
  sessionId: docId.nullish(),
  input: strict({
    kind: z.enum(["treino", "amistoso", "campeonato"], { error: "Escolha o tipo: treino, amistoso ou campeonato." }),
    date: z.string({ error: "Informe a data." }),
    time: z.string({ error: "Informe o horário." }),
    location: z.string({ error: "Informe o local." }),
    opponent: z.string().nullish(),
    competition: z.string().nullish(),
    status: z.enum(["scheduled", "done", "cancelled"], { error: "Situação inválida." }),
    score: strict({ us: z.number().int(), them: z.number().int() }).nullish(),
    notes: z.string().nullish(),
  }),
});

/* ------------------------------- auxiliares ------------------------------ */

const ARCHIVED_LOCK = "Este time está arquivado. Reative-o antes de alterar.";

function itemId(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeTeam(t: SportTeam): SportTeam {
  return {
    ...t,
    coachIds: t.coachIds ?? [],
    athletes: t.athletes ?? [],
    lineup: t.lineup ?? { formation: "", slots: [] },
    sessions: t.sessions ?? [],
    history: t.history ?? [],
  };
}

async function loadTeam(tx: Transaction, teamId: string): Promise<{ ref: DocumentReference; team: SportTeam }> {
  const ref = db.doc(`sportTeams/${teamId}`);
  const snap = requireDoc(await tx.get(ref), "Time");
  return { ref, team: normalizeTeam(toDTO<SportTeam>(snap)) };
}

function requireVisible(actor: Actor, team: SportTeam) {
  if (!canSeeTeam(actor.ctx, team)) fail("forbidden", "Este time não está disponível para o seu perfil.");
}

/** Time visível, editável e não arquivado (elenco, escalação, treinos e jogos). */
async function loadEditable(tx: Transaction, actor: Actor, teamId: string) {
  await requireModuleEnabled(tx, "sports");
  const loaded = await loadTeam(tx, teamId);
  requireVisible(actor, loaded.team);
  if (!canEditTeam(actor.ctx, loaded.team)) fail("forbidden", "Seu perfil não pode alterar este time.");
  if (loaded.team.status === "archived") fail("conflict", ARCHIVED_LOCK);
  return loaded;
}

function sanitizeAudience(audience: { scope: AudienceScope; departmentId?: string | null; roleIds?: string[]; userIds?: string[] }): Audience {
  return {
    scope: audience.scope,
    departmentId: audience.scope === "department" ? audience.departmentId || undefined : undefined,
    roleIds: audience.scope === "roles" ? [...new Set(audience.roleIds ?? [])] : [],
    userIds: audience.scope === "people" ? [...new Set(audience.userIds ?? [])] : [],
  };
}

/** Técnicos precisam ser integrantes; quem entra agora precisa estar ativo. */
async function assertCoaches(tx: Transaction, ids: string[], previous: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const snaps = await tx.getAll(...unique.map((id) => db.doc(`members/${id}`)));
  for (const snap of snaps) {
    if (!snap.exists) fail("invalid", "O(a) técnico(a) escolhido(a) não é integrante da Central.");
    if (snap.data()!.status !== "active" && !previous.includes(snap.id)) fail("invalid", "O(a) técnico(a) escolhido(a) está com a conta desativada.");
  }
}

async function assertDepartment(tx: Transaction, departmentId: string, previousId?: string) {
  const snap = await tx.get(db.doc(`departments/${departmentId}`));
  if (!snap.exists) fail("invalid", "O departamento escolhido não existe.");
  if (snap.data()!.active === false && snap.id !== previousId) fail("invalid", "O departamento escolhido está desativado. Escolha outro departamento.");
}

function addHistory(team: SportTeam, actor: Actor, ctx: RunContext, action: HistoryAction, summary: string) {
  return appendHistory(team.history, historyEntry(actor.uid, action, summary, ctx.now));
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, teamId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(
    tx,
    { uid: actor.uid, name: actor.name },
    { action: `sports.${action}`, module: "sports", resourceType: "team", resourceId: teamId, summary, details },
    ctx.requestId,
    ctx.now,
  );
}

async function presentTeam(teamId: string, actor: Actor | null): Promise<SportTeam> {
  const snap = await db.doc(`sportTeams/${teamId}`).get();
  if (!snap.exists) fail("not_found", "Time não encontrado.");
  const team = normalizeTeam(toDTO<SportTeam>(snap));
  if (!actor || !canSeeTeam(actor.ctx, team)) fail("forbidden", "A operação foi concluída, mas este time não está mais disponível para o seu perfil.");
  return team;
}

interface TeamRef {
  id: string;
}

const present = { present: (result: TeamRef, actor: Actor | null) => presentTeam(result.id, actor) };

/* -------------------------------- ações --------------------------------- */

export const sportsActions = {
  create: mutation({
    module: "sports",
    schema: createSchema,
    async run(tx, actor, input, ctx): Promise<TeamRef> {
      actor = actor!;
      requirePermission(actor, "sports.create", "Seu perfil não pode criar times.");
      await requireModuleEnabled(tx, "sports");
      const code = await nextCode(tx, ctx, "TIM");
      const coachIds = [...new Set(input.coachIds)];
      await assertDepartment(tx, input.departmentId);
      await assertCoaches(tx, coachIds, []);
      const ref = db.collection("sportTeams").doc();
      const team: SportTeam = {
        id: ref.id,
        code,
        name: input.name,
        modality: input.modality,
        category: input.category,
        color: input.color,
        departmentId: input.departmentId,
        coachIds,
        access: sanitizeAudience(input.access),
        status: "active",
        athletes: [],
        lineup: { formation: "", slots: [] },
        sessions: [],
        notes: input.notes || undefined,
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", "Time criado", ctx.now)],
      };
      tx.create(ref, sportTeamDoc(team));
      audit(tx, actor, ctx, "create", ref.id, `Time criado: ${team.name} (${code})`, { code, modality: team.modality, scope: team.access.scope });
      return { id: ref.id };
    },
    ...present,
  }),

  update: mutation({
    module: "sports",
    schema: updateSchema,
    async run(tx, actor, { id, input }, ctx): Promise<TeamRef> {
      actor = actor!;
      const { ref, team } = await loadEditable(tx, actor, id);
      if (!canEditTeamSettings(actor.ctx, team)) fail("forbidden", "Seu perfil não pode editar os dados deste time.");
      if (input.modality && input.modality !== team.modality && team.athletes.length > 0) fail("conflict", "Não dá para trocar a modalidade de um time que já tem atletas.");
      if (input.departmentId && input.departmentId !== team.departmentId) await assertDepartment(tx, input.departmentId, team.departmentId);
      const coachIds = input.coachIds ? [...new Set(input.coachIds)] : team.coachIds;
      if (input.coachIds) await assertCoaches(tx, coachIds, team.coachIds);

      const next: SportTeam = { ...team, coachIds, updatedAt: ctx.now };
      if (input.name !== undefined) next.name = input.name;
      if (input.modality !== undefined) next.modality = input.modality;
      if (input.category !== undefined) next.category = input.category;
      if (input.color !== undefined) next.color = input.color;
      if (input.departmentId !== undefined) next.departmentId = input.departmentId;
      if (input.access !== undefined) next.access = sanitizeAudience(input.access);
      if ("notes" in input) next.notes = input.notes || undefined;
      next.history = addHistory(team, actor, ctx, "updated", "Dados do time editados");
      tx.set(ref, sportTeamDoc(next));
      const readersChanged = JSON.stringify(teamReaders(next)) !== JSON.stringify(teamReaders(team));
      audit(tx, actor, ctx, "update", id, `Time ${team.code} editado`, { readersChanged, coaches: coachIds.length });
      return { id };
    },
    ...present,
  }),

  setStatus: mutation({
    module: "sports",
    schema: statusSchema,
    async run(tx, actor, { id, status }, ctx): Promise<TeamRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "sports");
      const { ref, team } = await loadTeam(tx, id);
      requireVisible(actor, team);
      if (!canArchiveTeam(actor.ctx, team)) fail("forbidden", "Seu perfil não pode arquivar ou reativar este time.");
      if (team.status === status) return { id };
      const history = addHistory(team, actor, ctx, status === "archived" ? "archived" : "restored", status === "archived" ? "Time arquivado" : "Time reativado");
      tx.update(ref, { status, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "setStatus", id, `Time ${team.code}: ${status === "archived" ? "arquivado" : "reativado"}`, { to: status });
      return { id };
    },
    ...present,
  }),

  saveAthlete: mutation({
    module: "sports",
    schema: athleteSchema,
    async run(tx, actor, { teamId, athleteId, input }, ctx): Promise<TeamRef> {
      actor = actor!;
      const { ref, team } = await loadEditable(tx, actor, teamId);
      const data = { ...input, course: input.course ?? undefined, memberId: input.memberId || undefined };
      const error = athleteError(team, data, athleteId ?? undefined);
      if (error) fail("invalid", error);
      const next = withAthlete(team, data, athleteId ?? itemId("atl"));
      const history = addHistory(team, actor, ctx, "updated", athleteId ? "Atleta editado(a)" : "Atleta incluído(a) no elenco");
      tx.update(ref, { athletes: next.athletes, lineup: next.lineup, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, athleteId ? "updateAthlete" : "addAthlete", teamId, `Elenco do time ${team.code} alterado`, { athletes: next.athletes.length });
      return { id: teamId };
    },
    ...present,
  }),

  removeAthlete: mutation({
    module: "sports",
    schema: removeAthleteSchema,
    async run(tx, actor, { teamId, athleteId }, ctx): Promise<TeamRef> {
      actor = actor!;
      const { ref, team } = await loadEditable(tx, actor, teamId);
      if (!team.athletes.some((a) => a.id === athleteId)) fail("not_found", "Atleta não encontrado(a) neste time.");
      const next = withoutAthlete(team, athleteId);
      const history = addHistory(team, actor, ctx, "updated", "Atleta removido(a) do elenco");
      tx.update(ref, { athletes: next.athletes, lineup: next.lineup, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "removeAthlete", teamId, `Atleta removido(a) do time ${team.code}`, { athletes: next.athletes.length });
      return { id: teamId };
    },
    ...present,
  }),

  saveLineup: mutation({
    module: "sports",
    schema: lineupSchema,
    async run(tx, actor, { teamId, formation, slots }, ctx): Promise<TeamRef> {
      actor = actor!;
      const { ref, team } = await loadEditable(tx, actor, teamId);
      const result = cleanLineup(team, { formation, slots });
      if ("error" in result) fail("invalid", result.error);
      const lineup = { ...result.lineup, updatedAt: ctx.now, updatedBy: actor.uid };
      const history = addHistory(team, actor, ctx, "updated", "Escalação salva");
      tx.update(ref, { lineup, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "saveLineup", teamId, `Escalação do time ${team.code} salva`, { starters: lineup.slots.length, formation: lineup.formation });
      return { id: teamId };
    },
    ...present,
  }),

  saveSession: mutation({
    module: "sports",
    schema: sessionSchema,
    async run(tx, actor, { teamId, sessionId, input }, ctx): Promise<TeamRef> {
      actor = actor!;
      const { ref, team } = await loadEditable(tx, actor, teamId);
      const data = {
        ...input,
        opponent: input.opponent ?? undefined,
        competition: input.competition ?? undefined,
        notes: input.notes ?? undefined,
      };
      const error = sessionError(data);
      if (error) fail("invalid", error);
      const current = sessionId ? team.sessions.find((s) => s.id === sessionId) : undefined;
      if (sessionId && !current) fail("not_found", "Treino ou jogo não encontrado.");
      if (!sessionId && team.sessions.length >= SPORT_LIMITS.sessions) fail("invalid", `O time pode ter no máximo ${SPORT_LIMITS.sessions} treinos e jogos.`);
      const clean = cleanSession(data);
      const sessions = current
        ? team.sessions.map((s) => (s.id === sessionId ? { ...clean, id: s.id, createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: ctx.now } : s))
        : [...team.sessions, { ...clean, id: itemId("ses"), createdBy: actor.uid, createdAt: ctx.now, updatedAt: ctx.now }];
      const what = SESSION_KIND_LABELS[input.kind];
      const history = addHistory(team, actor, ctx, "updated", current ? `${what} atualizado` : `${what} marcado`);
      tx.update(ref, { sessions, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, current ? "updateSession" : "addSession", teamId, `${what} do time ${team.code} ${current ? "atualizado" : "marcado"}`, {
        kind: input.kind,
        status: input.status,
      });
      return { id: teamId };
    },
    ...present,
  }),
};

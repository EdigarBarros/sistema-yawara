/**
 * ESPORTES: modalidades, treinos, elenco, jogos e competições.
 * ---------------------------------------------------------------------------
 * Armazenamento (src/lib/firestore-model.ts → teamDoc): `sportsTeams/{id}`,
 * com treinos, elenco, jogos e competições no próprio documento e `readers`
 * (criador + responsável + público) sempre recalculado aqui.
 *
 * Regras (as mesmas do serviço de demonstração e de src/lib/policies.ts):
 *  - Ver: `canSeeTeam` (público, criador, responsável ou sports.admin).
 *  - Criar: sports.create.
 *  - Editar dados, treinos, elenco, jogos e competições: `canEditTeam`
 *    (sports.edit, criador ou responsável). Modalidade arquivada não é editada.
 *  - Pausar, arquivar e reativar: `canArchiveTeam` (criador ou sports.archive).
 *  - Responsável precisa ser integrante ativo da Central.
 *
 * O elenco guarda só nome e dados de jogo (número, posição, capitão). Nomes de
 * atletas não entram no histórico, na auditoria nem no índice de busca.
 */
import { randomUUID } from "node:crypto";
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { teamDoc } from "@/lib/firestore-model";
import { canArchiveTeam, canEditTeam, canSeeTeam } from "@/lib/policies";
import type { Athlete, Audience, AudienceScope, Competition, CompetitionStatus, HistoryAction, HistoryEntry, Match, MatchStatus, SportCategory, SportTeam, TeamStatus, TrainingSlot } from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { nextCode } from "../core/counters";
import { mutation, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { appendHistory, historyEntry } from "../core/history";
import { toDTO } from "../core/records";
import { indexRecord, searchEntryFor } from "../core/search-index";

/* ------------------------------- limites -------------------------------- */

export const MAX_TRAININGS = 30;
export const MAX_ATHLETES = 200;
export const MAX_MATCHES = 300;
export const MAX_COMPETITIONS = 100;

/* ------------------------------- esquemas ------------------------------- */

const CATEGORIES = ["feminino", "masculino", "misto"] as const satisfies readonly SportCategory[];
const TEAM_STATUSES = ["active", "paused", "archived"] as const satisfies readonly TeamStatus[];
const MATCH_STATUSES = ["scheduled", "played", "cancelled"] as const satisfies readonly MatchStatus[];
const COMPETITION_STATUSES = ["upcoming", "ongoing", "finished"] as const satisfies readonly CompetitionStatus[];
const AUDIENCE_SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const satisfies readonly AudienceScope[];

const STATUS_LABEL: Record<TeamStatus, string> = { active: "Em atividade", paused: "Pausada", archived: "Arquivada" };

/** Objeto que recusa campos desconhecidos (com mensagem em português). */
function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? "Alguns campos enviados não são aceitos nesta operação. Atualize a página e tente novamente." : undefined),
  });
}

/** Identificadores usados em caminhos do Firestore: sem barras ou caracteres especiais. */
const docId = z.string({ error: "Identificador inválido." }).regex(/^[A-Za-z0-9_-]{1,128}$/, "Identificador inválido.");

function isRealDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const dateOnly = (message: string) =>
  z
    .string({ error: message })
    .regex(/^\d{4}-\d{2}-\d{2}$/, message)
    .refine(isRealDate, "Data inválida.");

const timeOnly = (message: string) => z.string({ error: message }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, message);

/** Texto opcional: `null`/vazio limpa o campo. */
const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label} pode ter no máximo ${max} caracteres.`).nullish();

const requiredText = (min: number, max: number, label: string) =>
  z
    .string({ error: `Informe ${label}.` })
    .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min, `Informe ${label}.`).max(max, `${label[0].toUpperCase()}${label.slice(1)} pode ter no máximo ${max} caracteres.`));

const score = z.number({ error: "Placar inválido." }).int("Use números inteiros no placar.").min(0, "Placar inválido.").max(999, "Placar inválido.").nullish();

const audienceSchema = strict({
  scope: z.enum(AUDIENCE_SCOPES, { error: "Escolha quem pode ver a modalidade." }),
  departmentId: z.union([docId, z.literal("")]).nullish(),
  roleIds: z.array(docId).max(50, "Escolha no máximo 50 cargos.").default([]),
  userIds: z.array(docId).max(100, "Escolha no máximo 100 pessoas.").default([]),
}).superRefine((a, ctx) => {
  if (a.scope === "department" && !a.departmentId) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha o departamento." });
  if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos um cargo." });
  if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos uma pessoa." });
});

const teamFields = {
  name: requiredText(3, 100, "o nome da modalidade"),
  sport: requiredText(2, 60, "o esporte"),
  category: z.enum(CATEGORIES, { error: "Escolha o naipe (feminino, masculino ou misto)." }),
  description: z.string().trim().max(800, "A descrição pode ter no máximo 800 caracteres."),
  coach: optionalText(120, "O nome do técnico"),
  responsibleId: docId,
  access: audienceSchema,
};

/** Campos editáveis (os nomes entram na auditoria; os valores, não). */
const TEAM_FIELDS = ["name", "sport", "category", "description", "coach", "responsibleId", "access"] as const;

const createSchema = strict({ ...teamFields, description: teamFields.description.default("") });
const updateSchema = strict({ id: docId, input: strict(teamFields).partial() });
const statusSchema = strict({ id: docId, status: z.enum(TEAM_STATUSES, { error: "Situação inválida." }) });

const trainingSchema = strict({
  id: docId,
  item: strict({
    id: docId.nullish(),
    weekday: z.number({ error: "Escolha o dia da semana." }).int().min(0, "Escolha o dia da semana.").max(6, "Escolha o dia da semana."),
    start: timeOnly("Informe o horário de início."),
    end: z.union([timeOnly("Horário de término inválido."), z.literal("")]).nullish(),
    location: requiredText(2, 160, "o local do treino"),
  }).refine((t) => !t.end || t.end > t.start, "O término precisa ser depois do início."),
});

const athleteSchema = strict({
  id: docId,
  item: strict({
    id: docId.nullish(),
    name: requiredText(2, 120, "o nome do(a) atleta"),
    number: z.string().trim().max(4, "O número da camisa pode ter no máximo 4 caracteres.").regex(/^\d*$/, "O número da camisa deve ter só algarismos.").nullish(),
    position: optionalText(40, "A posição"),
    captain: z.boolean().nullish(),
  }),
});

const matchSchema = strict({
  id: docId,
  item: strict({
    id: docId.nullish(),
    date: dateOnly("Informe a data do jogo."),
    time: z.union([timeOnly("Horário inválido."), z.literal("")]).nullish(),
    opponent: requiredText(2, 120, "o adversário"),
    location: requiredText(2, 160, "o local do jogo"),
    competitionId: z.union([docId, z.literal("")]).nullish(),
    scoreFor: score,
    scoreAgainst: score,
    status: z.enum(MATCH_STATUSES, { error: "Situação do jogo inválida." }),
    notes: optionalText(400, "A observação"),
  }).refine((m) => (m.scoreFor == null) === (m.scoreAgainst == null), "Informe o placar dos dois lados (ou deixe os dois em branco)."),
});

const competitionSchema = strict({
  id: docId,
  item: strict({
    id: docId.nullish(),
    name: requiredText(2, 120, "o nome da competição"),
    startDate: dateOnly("Informe a data de início."),
    endDate: z.union([dateOnly("Data de término inválida."), z.literal("")]).nullish(),
    location: requiredText(2, 160, "o local da competição"),
    placement: optionalText(60, "O resultado"),
    status: z.enum(COMPETITION_STATUSES, { error: "Situação da competição inválida." }),
    notes: optionalText(400, "A observação"),
  }).refine((c) => !c.endDate || c.endDate >= c.startDate, "O término precisa ser no mesmo dia ou depois do início."),
});

const LISTS = ["trainings", "athletes", "matches", "competitions"] as const;
type ListName = (typeof LISTS)[number];
const removeSchema = strict({ id: docId, list: z.enum(LISTS, { error: "Lista inválida." }), itemId: docId });

const LIST_LABEL: Record<ListName, { one: string; limit: number; prefix: string }> = {
  trainings: { one: "Treino", limit: MAX_TRAININGS, prefix: "trn" },
  athletes: { one: "Atleta", limit: MAX_ATHLETES, prefix: "ath" },
  matches: { one: "Jogo", limit: MAX_MATCHES, prefix: "mch" },
  competitions: { one: "Competição", limit: MAX_COMPETITIONS, prefix: "cmp" },
};

/* ------------------------------- auxiliares ------------------------------ */

function itemId(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeTeam(t: SportTeam): SportTeam {
  return {
    ...t,
    trainings: t.trainings ?? [],
    athletes: t.athletes ?? [],
    matches: t.matches ?? [],
    competitions: t.competitions ?? [],
    history: t.history ?? [],
  };
}

function fromSnap(snap: DocumentSnapshot): SportTeam {
  const { readers: _r, ...data } = toDTO<SportTeam & { readers?: string[] }>(snap);
  void _r;
  return normalizeTeam(data);
}

async function loadTeam(tx: Transaction, teamId: string): Promise<{ ref: DocumentReference; team: SportTeam }> {
  const ref = db.doc(`sportsTeams/${teamId}`);
  const snap = await tx.get(ref);
  if (!snap.exists) fail("not_found", "Modalidade não encontrada. Ela pode ter sido removida ou não estar disponível para o seu perfil.");
  return { ref, team: fromSnap(snap) };
}

function requireVisible(actor: Actor, t: SportTeam) {
  if (!canSeeTeam(actor.ctx, t)) fail("forbidden", "Esta modalidade não está disponível para o seu perfil.");
}

function requireEditable(actor: Actor, t: SportTeam) {
  requireVisible(actor, t);
  if (!canEditTeam(actor.ctx, t)) fail("forbidden", "Seu perfil não pode editar esta modalidade.");
  if (t.status === "archived") fail("conflict", "A modalidade está arquivada. Reative-a para editar.");
}

/** Mantém só os campos que valem para o escopo escolhido (como o serviço de demonstração). */
function sanitizeAudience(audience: { scope: AudienceScope; departmentId?: string | null; roleIds?: string[]; userIds?: string[] }): Audience {
  return {
    scope: audience.scope,
    departmentId: audience.scope === "department" ? audience.departmentId || undefined : undefined,
    roleIds: audience.scope === "roles" ? [...new Set(audience.roleIds ?? [])] : [],
    userIds: audience.scope === "people" ? [...new Set(audience.userIds ?? [])] : [],
  };
}

function sameAudience(a: Audience, b: Audience) {
  const norm = (x: Audience) => JSON.stringify([x.scope, x.departmentId ?? null, [...(x.roleIds ?? [])].sort(), [...(x.userIds ?? [])].sort()]);
  return norm(a) === norm(b);
}

/** Quem é designado agora precisa estar ativo; quem já era responsável pode permanecer. */
function assertResponsible(snap: DocumentSnapshot | null, previous?: string) {
  if (!snap) return;
  if (!snap.exists) fail("invalid", "O responsável escolhido não é integrante da Central.");
  if (snap.data()!.status !== "active" && snap.id !== previous) fail("invalid", "O responsável escolhido está com a conta desativada. Escolha um integrante ativo.");
}

function addHistory(t: SportTeam, actor: Actor, ctx: RunContext, ...entries: [HistoryAction, string][]): HistoryEntry[] {
  return appendHistory(t.history, ...entries.map(([action, summary]) => historyEntry(actor.uid, action, summary, ctx.now)));
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, teamId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(tx, { uid: actor.uid, name: actor.name }, { action: `sports.${action}`, module: "sports", resourceType: "team", resourceId: teamId, summary, details }, ctx.requestId, ctx.now);
}

/** Grava a modalidade completa (público recalculado) e a entrada de busca. */
function writeTeam(tx: Transaction, ref: DocumentReference, team: SportTeam) {
  tx.set(ref, teamDoc(team));
  indexRecord(tx, searchEntryFor.team(team));
}

const byDate = (a: { date: string; time?: string }, b: { date: string; time?: string }) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "");

/** Monta a resposta: a modalidade, se o autor ainda pode vê-la. */
export async function presentTeam(teamId: string, actor: Actor | null): Promise<SportTeam> {
  const snap = await db.doc(`sportsTeams/${teamId}`).get();
  if (!snap.exists) fail("not_found", "Modalidade não encontrada.");
  const team = fromSnap(snap);
  if (!actor || !canSeeTeam(actor.ctx, team)) fail("forbidden", "A operação foi concluída, mas esta modalidade não está mais disponível para o seu perfil.");
  return team;
}

interface TeamRef {
  id: string;
}

const presentResult = async (result: TeamRef, actor: Actor | null) => presentTeam(result.id, actor);

/**
 * Inclui ou atualiza um item de uma das listas da modalidade (`item.id`
 * presente = atualizar). Lê, aplica as regras comuns e grava.
 */
async function saveItem<T extends { id: string }>(
  tx: Transaction,
  actor: Actor,
  ctx: RunContext,
  teamId: string,
  list: ListName,
  build: (id: string, team: SportTeam) => T,
  existingId: string | null | undefined,
  sort?: (a: T, b: T) => number,
): Promise<TeamRef> {
  await requireModuleEnabled(tx, "sports");
  const { ref, team } = await loadTeam(tx, teamId);
  requireEditable(actor, team);
  const items = team[list] as unknown as T[];
  const meta = LIST_LABEL[list];
  if (existingId && !items.some((i) => i.id === existingId)) fail("not_found", `${meta.one} não encontrado(a). Pode ter sido removido(a).`);
  if (!existingId && items.length >= meta.limit) fail("conflict", `Esta modalidade já tem ${meta.limit} itens em “${meta.one}”, o limite. Remova itens antigos antes.`);
  const item = build(existingId ?? itemId(meta.prefix), team);
  let next = existingId ? items.map((i) => (i.id === existingId ? item : i)) : [...items, item];
  if (sort) next = [...next].sort(sort);
  const updated: SportTeam = {
    ...team,
    [list]: next,
    updatedAt: ctx.now,
    history: addHistory(team, actor, ctx, ["updated", `${meta.one} ${existingId ? "atualizado(a)" : "adicionado(a)"}`]),
  };
  writeTeam(tx, ref, updated);
  audit(tx, actor, ctx, existingId ? "updateItem" : "addItem", teamId, `${meta.one} ${existingId ? "atualizado(a)" : "adicionado(a)"} na modalidade ${team.code}`, { list, itemId: item.id });
  return { id: teamId };
}

/* -------------------------------- ações --------------------------------- */

export const sportsActions = {
  create: mutation({
    module: "sports",
    schema: createSchema,
    async run(tx, actor, input, ctx): Promise<TeamRef> {
      actor = actor!;
      requirePermission(actor, "sports.create", "Seu perfil não pode criar modalidades.");
      await requireModuleEnabled(tx, "sports");
      const code = await nextCode(tx, ctx, "ESP");
      const responsibleSnap = await tx.get(db.doc(`members/${input.responsibleId}`));
      assertResponsible(responsibleSnap);

      const ref = db.collection("sportsTeams").doc();
      const team: SportTeam = {
        id: ref.id,
        code,
        name: input.name,
        sport: input.sport,
        category: input.category,
        description: input.description,
        coach: input.coach || undefined,
        responsibleId: input.responsibleId,
        status: "active",
        trainings: [],
        athletes: [],
        matches: [],
        competitions: [],
        access: sanitizeAudience(input.access),
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", "Modalidade criada", ctx.now)],
      };
      tx.create(ref, teamDoc(team));
      indexRecord(tx, searchEntryFor.team(team));
      audit(tx, actor, ctx, "create", ref.id, `Modalidade criada: ${team.name} (${code})`, { code, category: team.category, scope: team.access.scope });
      return { id: ref.id };
    },
    present: presentResult,
  }),

  update: mutation({
    module: "sports",
    schema: updateSchema,
    async run(tx, actor, { id: teamId, input }, ctx): Promise<TeamRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "sports");
      const { ref, team: current } = await loadTeam(tx, teamId);
      requireEditable(actor, current);
      const responsibleChanged = input.responsibleId !== undefined && input.responsibleId !== current.responsibleId;
      const responsibleSnap = responsibleChanged ? await tx.get(db.doc(`members/${input.responsibleId}`)) : null;
      assertResponsible(responsibleSnap, current.responsibleId);

      const next: SportTeam = { ...current };
      if (input.name !== undefined) next.name = input.name;
      if (input.sport !== undefined) next.sport = input.sport;
      if (input.category !== undefined) next.category = input.category;
      if (input.description !== undefined) next.description = input.description;
      if ("coach" in input) next.coach = input.coach || undefined;
      if (input.responsibleId !== undefined) next.responsibleId = input.responsibleId;
      const accessChanged = input.access !== undefined && !sameAudience(sanitizeAudience(input.access), current.access);
      if (input.access !== undefined) next.access = sanitizeAudience(input.access);

      const changed = TEAM_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null));
      if (changed.length === 0) return { id: teamId };
      next.updatedAt = ctx.now;
      next.history = addHistory(current, actor, ctx, ["updated", "Modalidade editada"], ...(accessChanged ? [["shared", "Visibilidade da modalidade alterada"] as [HistoryAction, string]] : []));
      writeTeam(tx, ref, next);
      audit(tx, actor, ctx, "update", teamId, `Modalidade ${next.code} editada: ${changed.join(", ")}`, { fields: changed.join(","), accessChanged, responsibleChanged });
      return { id: teamId };
    },
    present: presentResult,
  }),

  setStatus: mutation({
    module: "sports",
    schema: statusSchema,
    async run(tx, actor, { id: teamId, status }, ctx): Promise<TeamRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "sports");
      const { ref, team: current } = await loadTeam(tx, teamId);
      requireVisible(actor, current);
      if (!canArchiveTeam(actor.ctx, current)) fail("forbidden", "Seu perfil não pode pausar, arquivar ou reativar modalidades.");
      if (current.status === status) return { id: teamId };
      const next: SportTeam = {
        ...current,
        status,
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, [status === "archived" ? "archived" : status === "active" ? "restored" : "status", `Situação alterada para ${STATUS_LABEL[status]}`]),
      };
      writeTeam(tx, ref, next);
      audit(tx, actor, ctx, "setStatus", teamId, `Modalidade ${current.code}: ${STATUS_LABEL[current.status]} → ${STATUS_LABEL[status]}`, { from: current.status, to: status });
      return { id: teamId };
    },
    present: presentResult,
  }),

  saveTraining: mutation({
    module: "sports",
    schema: trainingSchema,
    async run(tx, actor, { id: teamId, item }, ctx): Promise<TeamRef> {
      return saveItem<TrainingSlot>(
        tx,
        actor!,
        ctx,
        teamId,
        "trainings",
        (id) => ({ id, weekday: item.weekday, start: item.start, end: item.end || undefined, location: item.location }),
        item.id,
        (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start),
      );
    },
    present: presentResult,
  }),

  saveAthlete: mutation({
    module: "sports",
    schema: athleteSchema,
    async run(tx, actor, { id: teamId, item }, ctx): Promise<TeamRef> {
      return saveItem<Athlete>(
        tx,
        actor!,
        ctx,
        teamId,
        "athletes",
        (id, team) => {
          const key = item.name.toLocaleLowerCase("pt-BR");
          if (team.athletes.some((a) => a.id !== id && a.name.toLocaleLowerCase("pt-BR") === key)) fail("conflict", "Este nome já está no elenco.");
          if (item.number && team.athletes.some((a) => a.id !== id && a.number === item.number)) fail("conflict", `A camisa ${item.number} já é de outra pessoa do elenco.`);
          return { id, name: item.name, number: item.number || undefined, position: item.position || undefined, captain: item.captain || undefined };
        },
        item.id,
        (a, b) => (Number(a.number ?? 9999) - Number(b.number ?? 9999)) || a.name.localeCompare(b.name, "pt-BR"),
      );
    },
    present: presentResult,
  }),

  saveMatch: mutation({
    module: "sports",
    schema: matchSchema,
    async run(tx, actor, { id: teamId, item }, ctx): Promise<TeamRef> {
      return saveItem<Match>(
        tx,
        actor!,
        ctx,
        teamId,
        "matches",
        (id, team) => {
          const competitionId = item.competitionId || undefined;
          if (competitionId && !team.competitions.some((c) => c.id === competitionId)) fail("invalid", "A competição escolhida não existe mais nesta modalidade.");
          return {
            id,
            date: item.date,
            time: item.time || undefined,
            opponent: item.opponent,
            location: item.location,
            competitionId,
            scoreFor: item.scoreFor ?? undefined,
            scoreAgainst: item.scoreAgainst ?? undefined,
            status: item.status,
            notes: item.notes || undefined,
          };
        },
        item.id,
        byDate,
      );
    },
    present: presentResult,
  }),

  saveCompetition: mutation({
    module: "sports",
    schema: competitionSchema,
    async run(tx, actor, { id: teamId, item }, ctx): Promise<TeamRef> {
      return saveItem<Competition>(
        tx,
        actor!,
        ctx,
        teamId,
        "competitions",
        (id) => ({
          id,
          name: item.name,
          startDate: item.startDate,
          endDate: item.endDate || undefined,
          location: item.location,
          placement: item.placement || undefined,
          status: item.status,
          notes: item.notes || undefined,
        }),
        item.id,
        (a, b) => a.startDate.localeCompare(b.startDate),
      );
    },
    present: presentResult,
  }),

  removeItem: mutation({
    module: "sports",
    schema: removeSchema,
    async run(tx, actor, { id: teamId, list, itemId: removedId }, ctx): Promise<TeamRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "sports");
      const { ref, team } = await loadTeam(tx, teamId);
      requireEditable(actor, team);
      const meta = LIST_LABEL[list];
      const items = team[list] as { id: string }[];
      if (!items.some((i) => i.id === removedId)) fail("not_found", `${meta.one} não encontrado(a). Pode já ter sido removido(a).`);
      const next: SportTeam = {
        ...team,
        [list]: items.filter((i) => i.id !== removedId),
        updatedAt: ctx.now,
        history: addHistory(team, actor, ctx, ["updated", `${meta.one} removido(a)`]),
      };
      // Jogos de uma competição removida ficam sem competição (não são apagados).
      if (list === "competitions") next.matches = team.matches.map((m) => (m.competitionId === removedId ? { ...m, competitionId: undefined } : m));
      writeTeam(tx, ref, next);
      audit(tx, actor, ctx, "removeItem", teamId, `${meta.one} removido(a) da modalidade ${team.code}`, { list, itemId: removedId });
      return { id: teamId };
    },
    present: presentResult,
  }),
};

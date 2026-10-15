/**
 * SECRETARIA E REUNIÕES: registro de reuniões e fluxo de aprovação das atas.
 * ---------------------------------------------------------------------------
 * Armazenamento: `meetings/{id}` = meetingDoc(reunião) — pauta, decisões,
 * encaminhamentos, convidados externos (apenas nomes) e vínculos (documentos,
 * evento) ficam no próprio documento, junto com `readers` (público + criador
 * + participantes), sempre recalculado aqui.
 *
 * Regras (as mesmas do serviço de demonstração e de src/lib/policies.ts):
 *  - Ver: `canSeeMeeting` (participante com meetings.view, criador ou público).
 *  - Registrar: meetings.create. A reunião começa como rascunho.
 *  - Editar: `canEditMeeting` (criador ou meetings.edit); atas aprovadas ou
 *    arquivadas não podem ser editadas (conflito).
 *  - Situação: `MEETING_TRANSITIONS` / `allowedMeetingTransitions` — o criador
 *    faz as transições de "edição" (enviar para aprovação, devolver para
 *    rascunho); aprovar exige meetings.approve (é o ÚNICO caminho de rascunho
 *    para aprovada); arquivar/desarquivar exige meetings.archive.
 *  - O resumo das discussões é obrigatório para enviar a ata para aprovação
 *    (e para mantê-la aguardando aprovação).
 *  - Participantes precisam ser integrantes ativos (quem já participava pode
 *    permanecer mesmo que a conta tenha sido desativada depois); o término
 *    precisa ser depois do início; evento e documentos vinculados precisam
 *    existir e estar visíveis para quem vincula.
 *
 * A auditoria não registra nomes de convidados, textos da pauta, do resumo ou
 * das decisões — apenas identificadores, códigos, situações e contagens.
 */
import { randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { meetingDoc } from "@/lib/firestore-model";
import { MEETING_STATUS } from "@/lib/labels";
import { allowedMeetingTransitions, canEditMeeting, canSeeDocument, canSeeEvent, canSeeMeeting, MEETING_TRANSITIONS } from "@/lib/policies";
import { meetingReaders } from "@/lib/record-readers";
import type {
  AtleticaEvent,
  Audience,
  AudienceScope,
  HistoryAction,
  HistoryEntry,
  InstitutionalDocument,
  Meeting,
  MeetingAction,
  MeetingMode,
  MeetingStatus,
} from "@/types";
import { db } from "../core/admin";
import { requireModuleEnabled, requirePermission, type Actor } from "../core/actor";
import { auditInTx } from "../core/audit";
import { nextCode } from "../core/counters";
import { mutation, type RunContext } from "../core/dispatch";
import { fail } from "../core/errors";
import { appendHistory, historyEntry } from "../core/history";
import { notify } from "../core/notify";
import { requireDoc, toDTO } from "../core/records";
import { indexRecord, searchEntryFor } from "../core/search-index";

/* ------------------------------- limites -------------------------------- */

export const MAX_PARTICIPANTS = 100;
export const MAX_GUESTS = 50;
export const MAX_AGENDA = 50;
export const MAX_DECISIONS = 50;
export const MAX_ACTIONS = 50;
export const MAX_DOCUMENTS = 30;

/* ------------------------------- esquemas ------------------------------- */

const MEETING_MODES = ["presencial", "online", "hibrida"] as const satisfies readonly MeetingMode[];
const MEETING_STATUSES = ["draft", "pending_approval", "approved", "archived"] as const satisfies readonly MeetingStatus[];
const AUDIENCE_SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const satisfies readonly AudienceScope[];

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

/** Lista de textos: itens em branco são descartados (como no serviço de demonstração). */
const textList = (maxItems: number, maxLength: number, label: string) =>
  z
    .array(z.string({ error: `${label}: item inválido.` }).trim().max(maxLength, `${label}: cada item pode ter no máximo ${maxLength} caracteres.`), { error: `${label}: lista inválida.` })
    .max(maxItems, `${label}: no máximo ${maxItems} itens.`)
    .transform((items) => items.filter(Boolean));

/** Convidados externos: apenas nomes (2 a 80 caracteres), sem repetição. */
const guestsSchema = z
  .array(z.string({ error: "Convidados externos: nome inválido." }).trim().max(80, "O nome de cada convidado pode ter no máximo 80 caracteres."), {
    error: "Convidados externos: lista inválida.",
  })
  .max(MAX_GUESTS, `Informe no máximo ${MAX_GUESTS} convidados externos.`)
  .transform((items) => {
    const seen = new Set<string>();
    return items
      .map((g) => g.replace(/\s+/g, " "))
      .filter((g) => {
        const key = g.toLocaleLowerCase("pt-BR");
        if (!g || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  })
  .refine((items) => items.every((g) => g.length >= 2), "Informe o nome de cada convidado externo (mínimo de 2 caracteres).");

const audienceSchema = strict({
  scope: z.enum(AUDIENCE_SCOPES, { error: "Escolha quem pode consultar a reunião." }),
  departmentId: z.union([docId, z.literal("")]).nullish(),
  roleIds: z.array(docId).max(50, "Escolha no máximo 50 cargos.").default([]),
  userIds: z.array(docId).max(100, "Escolha no máximo 100 pessoas.").default([]),
}).superRefine((a, ctx) => {
  if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos um cargo." });
  if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos uma pessoa." });
  // Reuniões não têm departamento próprio: o público "departamento" precisa indicar qual.
  if (a.scope === "department" && !a.departmentId) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha o departamento." });
});

const actionSchema = strict({
  id: docId.nullish(),
  description: z.string({ error: "Descreva o encaminhamento." }).trim().max(300, "Cada encaminhamento pode ter no máximo 300 caracteres."),
  responsibleId: z.union([docId, z.literal("")]).nullish(),
  dueDate: z.union([dateOnly("Prazo do encaminhamento inválido."), z.literal("")]).nullish(),
});

const meetingFields = {
  title: z
    .string({ error: "Informe o título da reunião." })
    .trim()
    .min(3, "Informe o título da reunião (mínimo de 3 caracteres).")
    .max(160, "O título pode ter no máximo 160 caracteres."),
  date: dateOnly("Informe a data."),
  startTime: timeOnly("Informe o horário de início."),
  endTime: z.union([timeOnly("Horário de término inválido."), z.literal("")]).nullish(),
  mode: z.enum(MEETING_MODES, { error: "Escolha a modalidade da reunião." }),
  location: z
    .string({ error: "Informe o local ou link." })
    .trim()
    .min(2, "Informe o local ou link (mínimo de 2 caracteres).")
    .max(300, "O local ou link pode ter no máximo 300 caracteres."),
  participantIds: z
    .array(docId, { error: "Selecione pelo menos um participante." })
    .min(1, "Selecione pelo menos um participante.")
    .max(MAX_PARTICIPANTS, `Selecione no máximo ${MAX_PARTICIPANTS} participantes.`),
  guests: guestsSchema.nullish(),
  eventId: z.union([docId, z.literal("")]).nullish(),
  agenda: textList(MAX_AGENDA, 300, "Pauta"),
  summary: z.string({ error: "Resumo das discussões inválido." }).trim().max(4000, "O resumo pode ter no máximo 4.000 caracteres."),
  decisions: textList(MAX_DECISIONS, 400, "Decisões"),
  actions: z.array(actionSchema, { error: "Encaminhamentos inválidos." }).max(MAX_ACTIONS, `Registre no máximo ${MAX_ACTIONS} encaminhamentos.`),
  documentIds: z.array(docId, { error: "Documentos relacionados inválidos." }).max(MAX_DOCUMENTS, `Vincule no máximo ${MAX_DOCUMENTS} documentos.`),
  access: audienceSchema,
};

/** Campos editáveis (os nomes entram na auditoria; os valores, não). */
const MEETING_FIELDS = ["title", "date", "startTime", "endTime", "mode", "location", "participantIds", "guests", "eventId", "agenda", "summary", "decisions", "actions", "documentIds", "access"] as const;

function endAfterStart(v: { startTime?: string; endTime?: string | null }, ctx: z.RefinementCtx) {
  if (v.startTime && v.endTime && v.endTime <= v.startTime) ctx.addIssue({ code: "custom", message: "O horário de término deve ser depois do início." });
}

const createSchema = strict({
  ...meetingFields,
  agenda: meetingFields.agenda.default([]),
  summary: meetingFields.summary.default(""),
  decisions: meetingFields.decisions.default([]),
  actions: meetingFields.actions.default([]),
  documentIds: meetingFields.documentIds.default([]),
}).superRefine(endAfterStart);

const updateSchema = strict({ id: docId, input: strict(meetingFields).partial().superRefine(endAfterStart) });

const statusSchema = strict({ id: docId, status: z.enum(MEETING_STATUSES, { error: "Situação inválida." }) });

type ActionInput = z.infer<typeof actionSchema>;

/* ------------------------------- auxiliares ------------------------------ */

function normalizeMeeting(m: Meeting): Meeting {
  return {
    ...m,
    participantIds: m.participantIds ?? [],
    guests: m.guests ?? [],
    agenda: m.agenda ?? [],
    summary: m.summary ?? "",
    decisions: m.decisions ?? [],
    actions: m.actions ?? [],
    documentIds: m.documentIds ?? [],
    history: m.history ?? [],
  };
}

async function loadMeeting(tx: Transaction, meetingId: string): Promise<{ ref: DocumentReference; meeting: Meeting }> {
  const ref = db.doc(`meetings/${meetingId}`);
  const snap = requireDoc(await tx.get(ref), "Reunião");
  return { ref, meeting: normalizeMeeting(toDTO<Meeting>(snap)) };
}

function requireVisible(actor: Actor, m: Meeting) {
  if (!canSeeMeeting(actor.ctx, m)) fail("forbidden", "Esta reunião não está disponível para o seu perfil.");
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
  const norm = (x: Audience) => JSON.stringify([x.scope, x.departmentId ?? null, [...x.roleIds].sort(), [...x.userIds].sort()]);
  return norm(a) === norm(b);
}

/** Situação de cada integrante consultado (ausente = não existe). Leitura na transação. */
async function loadMemberStatus(tx: Transaction, ids: (string | undefined | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const snaps = await tx.getAll(...unique.map((id) => db.doc(`members/${id}`)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, String(s.data()!.status ?? "")]));
}

/**
 * Integrantes precisam existir. Quem é incluído agora precisa estar ativo;
 * quem já constava pode permanecer mesmo que a conta tenha sido desativada
 * depois (sem acesso efetivo: contas desativadas não têm marcadores).
 */
function assertMembers(ids: string[], previous: string[], status: Map<string, string>, label: "participante" | "responsável pelo encaminhamento") {
  for (const memberId of ids) {
    const s = status.get(memberId);
    if (!s) fail("invalid", `Um ${label} escolhido não é integrante da Central.`);
    if (s !== "active" && !previous.includes(memberId)) fail("invalid", `Um ${label} escolhido está com a conta desativada. Escolha integrantes ativos.`);
  }
}

/** Documentos vinculados agora precisam existir e estar visíveis para quem vincula. */
async function loadDocuments(tx: Transaction, ids: string[]) {
  if (ids.length === 0) return [];
  return tx.getAll(...ids.map((id) => db.doc(`documents/${id}`)));
}

function assertDocuments(actor: Actor, snaps: FirebaseFirestore.DocumentSnapshot[]) {
  for (const snap of snaps) {
    const visible = snap.exists && canSeeDocument(actor.ctx, toDTO<InstitutionalDocument>(snap));
    if (!visible) fail("invalid", "Um dos documentos relacionados não existe ou não está disponível para o seu perfil.");
  }
}

/** Evento vinculado agora precisa existir e estar visível para quem vincula. */
async function loadEventSnap(tx: Transaction, eventId: string | undefined) {
  return eventId ? tx.get(db.doc(`events/${eventId}`)) : null;
}

function assertEvent(actor: Actor, snap: FirebaseFirestore.DocumentSnapshot | null) {
  if (!snap) return;
  const ev = snap.exists ? toDTO<AtleticaEvent>(snap) : null;
  const visible = !!ev && canSeeEvent(actor.ctx, { ...ev, responsibleIds: ev.responsibleIds ?? [] });
  if (!visible) fail("invalid", "O evento relacionado não existe ou não está disponível para o seu perfil.");
}

function newActionId() {
  return `act-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Encaminhamentos: itens sem descrição são descartados; um `id` enviado só é
 * mantido se já pertence a esta reunião (o servidor gera os demais).
 */
function buildActions(input: ActionInput[], current: MeetingAction[]): MeetingAction[] {
  const known = new Set(current.map((a) => a.id));
  const used = new Set<string>();
  return input
    .filter((a) => a.description.trim())
    .map((a) => {
      const id = a.id && known.has(a.id) && !used.has(a.id) ? a.id : newActionId();
      used.add(id);
      return { id, description: a.description, responsibleId: a.responsibleId || undefined, dueDate: a.dueDate || undefined };
    });
}

function addHistory(m: Meeting, actor: Actor, ctx: RunContext, ...entries: [HistoryAction, string][]): HistoryEntry[] {
  return appendHistory(m.history, ...entries.map(([action, summary]) => historyEntry(actor.uid, action, summary, ctx.now)));
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, meetingId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(
    tx,
    { uid: actor.uid, name: actor.name },
    { action: `meetings.${action}`, module: "meetings", resourceType: "meeting", resourceId: meetingId, summary, details },
    ctx.requestId,
    ctx.now,
  );
}

/** Texto do histórico de cada mudança de situação (o mesmo do serviço de demonstração). */
function statusSummary(from: MeetingStatus, to: MeetingStatus) {
  if (to === "pending_approval") return "Enviada para aprovação";
  if (to === "approved") return from === "archived" ? "Ata desarquivada" : "Ata aprovada";
  if (to === "draft") return "Ata devolvida para rascunho";
  return "Ata arquivada";
}

/** Monta a resposta: a reunião completa, se o autor ainda pode vê-la. */
async function presentMeeting(meetingId: string, actor: Actor | null): Promise<Meeting> {
  const snap = await db.doc(`meetings/${meetingId}`).get();
  if (!snap.exists) fail("not_found", "Reunião não encontrada.");
  const m = normalizeMeeting(toDTO<Meeting>(snap));
  if (!actor || !canSeeMeeting(actor.ctx, m)) fail("forbidden", "A operação foi concluída, mas esta reunião não está mais disponível para o seu perfil.");
  return m;
}

interface MeetingRef {
  id: string;
}

/* -------------------------------- ações --------------------------------- */

export const meetingsActions = {
  create: mutation({
    module: "meetings",
    schema: createSchema,
    async run(tx, actor, input, ctx): Promise<MeetingRef> {
      actor = actor!;
      requirePermission(actor, "meetings.create", "Seu perfil não pode registrar reuniões.");
      // Leituras
      await requireModuleEnabled(tx, "meetings");
      const code = await nextCode(tx, ctx, "REU");
      const participantIds = [...new Set(input.participantIds)];
      const actions = buildActions(input.actions, []);
      const documentIds = [...new Set(input.documentIds)];
      const eventId = input.eventId || undefined;
      const [members, docs, eventSnap] = await Promise.all([
        loadMemberStatus(tx, [...participantIds, ...actions.map((a) => a.responsibleId)]),
        loadDocuments(tx, documentIds),
        loadEventSnap(tx, eventId),
      ]);
      // Regras
      assertMembers(participantIds, [], members, "participante");
      assertMembers(actions.map((a) => a.responsibleId).filter((id): id is string => !!id), [], members, "responsável pelo encaminhamento");
      assertDocuments(actor, docs);
      assertEvent(actor, eventSnap);

      // Escritas
      const ref = db.collection("meetings").doc();
      const meeting: Meeting = {
        id: ref.id,
        code,
        title: input.title,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime || undefined,
        mode: input.mode,
        location: input.location,
        participantIds,
        guests: input.guests ?? [],
        eventId,
        agenda: input.agenda,
        summary: input.summary,
        decisions: input.decisions,
        actions,
        documentIds,
        access: sanitizeAudience(input.access),
        status: "draft",
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", "Reunião registrada como rascunho", ctx.now)],
      };
      tx.create(ref, meetingDoc(meeting));
      indexRecord(tx, searchEntryFor.meeting(meeting));
      audit(tx, actor, ctx, "create", ref.id, `Reunião ${code} registrada como rascunho`, {
        code,
        scope: meeting.access.scope,
        participants: participantIds.length,
        guests: meeting.guests!.length,
        eventId: eventId ?? null,
        documents: documentIds.length,
      });

      const readers = meetingReaders(meeting);
      const title = "Reunião registrada";
      const body = `${actor.name} registrou “${meeting.title}”.`;
      const actorId = actor.uid;
      ctx.after(async () => {
        await notify({ eventKey: `meeting_registered__${ref.id}`, kind: "meeting_registered", title, body, href: `/secretaria/${ref.id}`, module: "meetings", readers, actorId });
      });
      return { id: ref.id };
    },
    async present(result, actor) {
      return presentMeeting(result.id, actor);
    },
  }),

  update: mutation({
    module: "meetings",
    schema: updateSchema,
    async run(tx, actor, { id: meetingId, input }, ctx): Promise<MeetingRef> {
      actor = actor!;
      // Leituras
      await requireModuleEnabled(tx, "meetings");
      const { ref, meeting: current } = await loadMeeting(tx, meetingId);
      requireVisible(actor, current);
      if (!canEditMeeting(actor.ctx, current)) {
        const locked = current.status === "approved" || current.status === "archived";
        fail(
          locked ? "conflict" : "forbidden",
          locked ? "Atas aprovadas ou arquivadas não podem ser editadas. Devolva para rascunho antes, se necessário." : "Seu perfil não pode editar esta reunião.",
        );
      }

      const participantIds = input.participantIds ? [...new Set(input.participantIds)] : current.participantIds;
      const actions = input.actions ? buildActions(input.actions, current.actions) : current.actions;
      const documentIds = input.documentIds ? [...new Set(input.documentIds)] : current.documentIds;
      const eventId = "eventId" in input ? input.eventId || undefined : current.eventId;

      // Só o que é incluído agora é conferido (vínculos anteriores permanecem).
      const newParticipants = input.participantIds ? participantIds.filter((p) => !current.participantIds.includes(p)) : [];
      const previousResponsibles = new Set(current.actions.map((a) => a.responsibleId).filter(Boolean));
      const newResponsibles = input.actions ? [...new Set(actions.map((a) => a.responsibleId).filter((id): id is string => !!id && !previousResponsibles.has(id)))] : [];
      const newDocuments = documentIds.filter((d) => !current.documentIds.includes(d));
      const eventChanged = !!eventId && eventId !== current.eventId;
      const [members, docs, eventSnap] = await Promise.all([
        loadMemberStatus(tx, [...newParticipants, ...newResponsibles]),
        loadDocuments(tx, newDocuments),
        loadEventSnap(tx, eventChanged ? eventId : undefined),
      ]);

      // Regras
      assertMembers(newParticipants, [], members, "participante");
      assertMembers(newResponsibles, [], members, "responsável pelo encaminhamento");
      assertDocuments(actor, docs);
      assertEvent(actor, eventSnap);

      const next: Meeting = { ...current, participantIds, actions, documentIds, eventId };
      if (input.title !== undefined) next.title = input.title;
      if (input.date !== undefined) next.date = input.date;
      if (input.startTime !== undefined) next.startTime = input.startTime;
      if ("endTime" in input) next.endTime = input.endTime || undefined;
      if (input.mode !== undefined) next.mode = input.mode;
      if (input.location !== undefined) next.location = input.location;
      if ("guests" in input) next.guests = input.guests ?? [];
      if (input.agenda !== undefined) next.agenda = input.agenda;
      if (input.summary !== undefined) next.summary = input.summary;
      if (input.decisions !== undefined) next.decisions = input.decisions;
      if (next.endTime && next.endTime <= next.startTime) fail("invalid", "O horário de término deve ser depois do início.");
      if (next.status === "pending_approval" && !next.summary.trim()) {
        fail("invalid", "O resumo das discussões é obrigatório enquanto a ata aguarda aprovação. Devolva para rascunho se precisar apagá-lo.");
      }
      const accessChanged = input.access !== undefined && !sameAudience(sanitizeAudience(input.access), current.access);
      if (input.access !== undefined) next.access = sanitizeAudience(input.access);

      const changed = MEETING_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null));
      if (changed.length === 0) return { id: meetingId };

      next.updatedAt = ctx.now;
      next.history = addHistory(
        current,
        actor,
        ctx,
        ["updated", "Registro da reunião editado"],
        ...(accessChanged ? [["shared", "Visibilidade da reunião alterada"] as [HistoryAction, string]] : []),
      );

      // Escritas (documento completo: campos esvaziados deixam de existir)
      tx.set(ref, meetingDoc(next));
      indexRecord(tx, searchEntryFor.meeting(next));
      audit(tx, actor, ctx, "update", meetingId, `Reunião ${current.code} editada: ${changed.join(", ")}`, {
        accessChanged,
        participants: next.participantIds.length,
        guests: next.guests!.length,
        eventId: next.eventId ?? null,
      });
      return { id: meetingId };
    },
    async present(result, actor) {
      return presentMeeting(result.id, actor);
    },
  }),

  setStatus: mutation({
    module: "meetings",
    schema: statusSchema,
    async run(tx, actor, { id: meetingId, status }, ctx): Promise<MeetingRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "meetings");
      const { ref, meeting: current } = await loadMeeting(tx, meetingId);
      requireVisible(actor, current);
      // Mesma regra do serviço de demonstração: transição inexistente = conflito; sem permissão = recusada.
      if (!allowedMeetingTransitions(actor.ctx, current).includes(status)) {
        const possible = MEETING_TRANSITIONS[current.status][status];
        fail(
          possible ? "forbidden" : "conflict",
          possible
            ? "Seu perfil não pode fazer esta alteração de situação."
            : `Não é possível passar de “${MEETING_STATUS[current.status].label}” para “${MEETING_STATUS[status].label}”.`,
        );
      }
      if (status === "pending_approval" && !current.summary.trim()) {
        fail("invalid", "Preencha o resumo das discussões antes de enviar a ata para aprovação.");
      }

      const from = current.status;
      const approving = status === "approved" && from === "pending_approval";
      const next: Meeting = {
        ...current,
        status,
        updatedAt: ctx.now,
        // O histórico guarda quem aprovou (actorId) e quando (at).
        history: addHistory(current, actor, ctx, [status === "archived" ? "archived" : "status", statusSummary(from, status)]),
      };
      tx.update(ref, { status, updatedAt: ctx.now, history: next.history });
      indexRecord(tx, searchEntryFor.meeting(next));
      if (approving) {
        audit(tx, actor, ctx, "approve", meetingId, `Ata ${current.code} aprovada`, { from, to: status, approvedBy: actor.uid, approvedAt: ctx.now });
      } else {
        audit(tx, actor, ctx, "setStatus", meetingId, `Reunião ${current.code}: ${MEETING_STATUS[from].label} → ${MEETING_STATUS[status].label}`, { from, to: status });
      }

      if (status === "pending_approval") {
        const readers = meetingReaders(next);
        const title = "Ata aguardando aprovação";
        const body = `“${next.title}” foi enviada para aprovação.`;
        const actorId = actor.uid;
        ctx.after(async () => {
          await notify({
            eventKey: `meeting_pending_approval__${meetingId}__${ctx.requestId}`,
            kind: "meeting_registered",
            title,
            body,
            href: `/secretaria/${meetingId}`,
            module: "meetings",
            readers,
            permission: "meetings.approve",
            includeModuleAdmins: true,
            actorId,
          });
        });
      }
      return { id: meetingId };
    },
    async present(result, actor) {
      return presentMeeting(result.id, actor);
    },
  }),
};

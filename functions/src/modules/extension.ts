/**
 * ENSINO E EXTENSÃO: projetos, palestrantes, programação, presença e certificados.
 * ---------------------------------------------------------------------------
 * Armazenamento (src/lib/firestore-model.ts → projectDocs):
 *  - `projects/{id}`: dados do projeto + `attendeeCount` + `readers` (criador +
 *    responsável + público), SEM a lista de presença;
 *  - `projects/{id}/private/attendance`: lista de presença (nomes = dados
 *    pessoais) + `editors` (criador + responsável). As regras do Firestore só
 *    liberam a leitura para quem pode editar o projeto.
 *
 * Regras (as mesmas do serviço de demonstração e de src/lib/policies.ts):
 *  - Ver: `canSeeProject`; ver nomes da lista: `canSeeAttendees` (a resposta de
 *    toda ação aplica essa regra para quem chamou).
 *  - Editar dados, palestrantes, programação, presença, certificados e
 *    documentos: `canEditProject` (extension.edit, criador ou responsável).
 *  - Concluir/cancelar (e reabrir um projeto concluído ou cancelado):
 *    `canCloseProject` (criador ou extension.archive).
 *  - Certificados "emitidos" (marcar ou desfazer): extension.approve e pelo
 *    menos um participante com presença marcada.
 *  - Carga horária 0–400 h; evento vinculado precisa existir e estar visível;
 *    documento vinculado precisa existir e estar visível para quem vincula.
 *  - Lista de presença: até 1000 nomes, sem repetição (sem diferenciar
 *    maiúsculas/minúsculas e espaços).
 *
 * Nomes de participantes nunca entram em `projects/{id}`, no histórico, na
 * auditoria ou no índice de busca — apenas identificadores e contagens.
 */
import { randomUUID } from "node:crypto";
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { projectDocs, projectFromDocs, type ProjectDoc } from "@/lib/firestore-model";
import { canCloseProject, canEditProject, canSeeAttendees, canSeeDocument, canSeeEvent, canSeeProject } from "@/lib/policies";
import type {
  ActivityType,
  AtleticaEvent,
  Attendee,
  Audience,
  AudienceScope,
  CertificateStatus,
  ExtensionProject,
  HistoryAction,
  HistoryEntry,
  InstitutionalDocument,
  ProjectStatus,
  ScheduleItem,
  Speaker,
} from "@/types";
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

export const MAX_ATTENDEES = 1000;
export const MAX_SPEAKERS = 100;
export const MAX_SCHEDULE = 100;
export const MAX_DOCUMENTS = 200;
export const MAX_CERTIFICATE_HOURS = 400;

/* ------------------------------- esquemas ------------------------------- */

const ACTIVITY_TYPES = ["palestra", "workshop", "roda_conversa", "minicurso", "projeto_extensao", "grupo_estudos", "outro"] as const satisfies readonly ActivityType[];
const PROJECT_STATUSES = ["planning", "open", "done", "cancelled"] as const satisfies readonly ProjectStatus[];
const CERTIFICATE_STATUSES = ["not_started", "in_progress", "issued"] as const satisfies readonly CertificateStatus[];
const AUDIENCE_SCOPES = ["department", "board", "directors", "directors_advisors", "all", "roles", "people"] as const satisfies readonly AudienceScope[];

/** Textos do histórico e da auditoria (sem termos da demonstração). */
const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Em planejamento",
  open: "Inscrições abertas",
  done: "Realizado",
  cancelled: "Cancelado",
};

const CERTIFICATE_LABEL: Record<CertificateStatus, string> = {
  not_started: "Não iniciados",
  in_progress: "Em preparação",
  issued: "Emitidos",
};

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

/** Nome de pessoa: espaços normalizados (evita "Ana  Silva" e "Ana Silva" como nomes diferentes). */
function cleanName(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function nameKey(value: string) {
  return cleanName(value).toLocaleLowerCase("pt-BR");
}

const audienceSchema = strict({
  scope: z.enum(AUDIENCE_SCOPES, { error: "Escolha quem pode ver o projeto." }),
  departmentId: z.union([docId, z.literal("")]).nullish(),
  roleIds: z.array(docId).max(50, "Escolha no máximo 50 cargos.").default([]),
  userIds: z.array(docId).max(100, "Escolha no máximo 100 pessoas.").default([]),
}).superRefine((a, ctx) => {
  if (a.scope === "department" && !a.departmentId) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha o departamento." });
  if (a.scope === "roles" && a.roleIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos um cargo." });
  if (a.scope === "people" && a.userIds.length === 0) ctx.addIssue({ code: "custom", message: "Visibilidade: escolha pelo menos uma pessoa." });
});

const projectFields = {
  name: z.string({ error: "Informe o nome do projeto." }).trim().min(3, "Informe o nome do projeto (mínimo de 3 caracteres).").max(120, "O nome do projeto pode ter no máximo 120 caracteres."),
  description: z.string().trim().max(800, "A descrição pode ter no máximo 800 caracteres."),
  objective: z.string().trim().max(400, "O objetivo pode ter no máximo 400 caracteres."),
  activityType: z.enum(ACTIVITY_TYPES, { error: "Escolha um tipo de atividade válido." }),
  responsibleId: docId,
  date: dateOnly("Informe a data."),
  time: z.union([timeOnly("Horário inválido."), z.literal("")]).nullish(),
  location: z.string({ error: "Informe o local." }).trim().min(2, "Informe o local.").max(200, "O local pode ter no máximo 200 caracteres."),
  /** `null`/vazio = sem vínculo com evento. */
  eventId: z.union([docId, z.literal("")]).nullish(),
  certificateHours: z
    .number({ error: "A carga horária deve estar entre 0 e 400 horas." })
    .int("Use um número inteiro de horas.")
    .min(0, `A carga horária deve estar entre 0 e ${MAX_CERTIFICATE_HOURS} horas.`)
    .max(MAX_CERTIFICATE_HOURS, `A carga horária deve estar entre 0 e ${MAX_CERTIFICATE_HOURS} horas.`)
    .nullish(),
  access: audienceSchema,
};

/** Campos editáveis (os nomes entram na auditoria; os valores, não). */
const PROJECT_FIELDS = ["name", "description", "objective", "activityType", "responsibleId", "date", "time", "location", "eventId", "certificateHours", "access", "report"] as const;

const createSchema = strict({
  ...projectFields,
  description: projectFields.description.default(""),
  objective: projectFields.objective.default(""),
});

const updateSchema = strict({
  id: docId,
  input: strict({
    ...projectFields,
    report: z.string().trim().max(5000, "O relatório pode ter no máximo 5000 caracteres.").nullish(),
  }).partial(),
});

const statusSchema = strict({ id: docId, status: z.enum(PROJECT_STATUSES, { error: "Situação inválida." }) });

const addSpeakerSchema = strict({
  id: docId,
  speaker: strict({
    name: z.string({ error: "Informe o nome do palestrante ou parceiro." }).trim().min(1, "Informe o nome do palestrante ou parceiro.").max(120, "O nome pode ter no máximo 120 caracteres."),
    affiliation: z.string().trim().max(160, "A instituição pode ter no máximo 160 caracteres.").nullish(),
    topic: optionalText(200, "O tema"),
  }),
});

const removeSpeakerSchema = strict({ id: docId, speakerId: docId });

const addScheduleSchema = strict({
  id: docId,
  item: strict({
    time: timeOnly("Informe horário e atividade."),
    title: z.string({ error: "Informe horário e atividade." }).trim().min(1, "Informe horário e atividade.").max(120, "A atividade pode ter no máximo 120 caracteres."),
    description: optionalText(300, "A descrição da atividade"),
  }),
});

const removeScheduleSchema = strict({ id: docId, itemId: docId });

const addAttendeeSchema = strict({
  id: docId,
  name: z
    .string({ error: "Informe o nome do participante." })
    .transform(cleanName)
    .pipe(z.string().min(2, "Informe o nome do participante.").max(120, "O nome do participante pode ter no máximo 120 caracteres.")),
});

const attendanceSchema = strict({
  id: docId,
  attendeeId: docId,
  present: z.boolean({ error: "Informe se o participante esteve presente." }),
});

const certificateSchema = strict({ id: docId, status: z.enum(CERTIFICATE_STATUSES, { error: "Situação dos certificados inválida." }) });

const linkDocumentSchema = strict({ id: docId, documentId: docId });

/* ------------------------------- auxiliares ------------------------------ */

function itemId(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function refsFor(projectId: string) {
  return {
    ref: db.doc(`projects/${projectId}`),
    attRef: db.doc(`projects/${projectId}/private/attendance`),
  };
}

type ProjectData = Omit<ProjectDoc, "readers">;

function normalizeProject(p: ExtensionProject): ExtensionProject {
  return {
    ...p,
    speakers: p.speakers ?? [],
    schedule: p.schedule ?? [],
    attendees: p.attendees ?? [],
    documentIds: p.documentIds ?? [],
    history: p.history ?? [],
  };
}

function fromSnaps(projectSnap: DocumentSnapshot, attendanceSnap: DocumentSnapshot | null): ExtensionProject {
  const data = toDTO<ProjectData & { id: string }>(projectSnap);
  const attendance = attendanceSnap ? { attendees: ((attendanceSnap.exists ? attendanceSnap.data()!.attendees : []) ?? []) as Attendee[] } : null;
  return normalizeProject(projectFromDocs(projectSnap.id, data, attendance));
}

interface Loaded {
  ref: DocumentReference;
  attRef: DocumentReference;
  project: ExtensionProject;
  /** O documento da lista de presença existe? (registros antigos podem não ter). */
  hasAttendanceDoc: boolean;
}

/** Lê o projeto e a lista de presença (leituras da transação). */
async function loadProject(tx: Transaction, projectId: string): Promise<Loaded> {
  const { ref, attRef } = refsFor(projectId);
  const [snap, attSnap] = await tx.getAll(ref, attRef);
  if (!snap.exists) fail("not_found", "Projeto não encontrado. Ele pode ter sido removido ou não estar disponível para o seu perfil.");
  return { ref, attRef, project: fromSnaps(snap, attSnap), hasAttendanceDoc: attSnap.exists };
}

function requireVisible(actor: Actor, p: ExtensionProject) {
  if (!canSeeProject(actor.ctx, p)) fail("forbidden", "Este projeto não está disponível para o seu perfil.");
}

function requireEditable(actor: Actor, p: ExtensionProject) {
  requireVisible(actor, p);
  if (!canEditProject(actor.ctx, p)) fail("forbidden", "Seu perfil não pode editar este projeto.");
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

/**
 * Responsável precisa ser integrante da Central. Quem é designado agora
 * precisa estar com a conta ativa; quem já era responsável pode permanecer.
 */
function assertResponsible(snap: DocumentSnapshot | null, previous?: string) {
  if (!snap) return;
  if (!snap.exists) fail("invalid", "O responsável escolhido não é integrante da Central.");
  if (snap.data()!.status !== "active" && snap.id !== previous) fail("invalid", "O responsável escolhido está com a conta desativada. Escolha um integrante ativo.");
}

/** Evento vinculado: precisa existir e estar visível para quem vincula. */
function assertEvent(actor: Actor, snap: DocumentSnapshot | null) {
  if (!snap) return;
  if (!snap.exists) fail("not_found", "Evento vinculado não encontrado. Ele pode ter sido removido ou não estar disponível para o seu perfil.");
  const ev = toDTO<AtleticaEvent>(snap);
  const visible = canSeeEvent(actor.ctx, { ...ev, responsibleIds: ev.responsibleIds ?? [] });
  if (!visible) fail("not_found", "Evento vinculado não encontrado. Ele pode ter sido removido ou não estar disponível para o seu perfil.");
}

function addHistory(p: ExtensionProject, actor: Actor, ctx: RunContext, ...entries: [HistoryAction, string][]): HistoryEntry[] {
  return appendHistory(p.history, ...entries.map(([action, summary]) => historyEntry(actor.uid, action, summary, ctx.now)));
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, projectId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(
    tx,
    { uid: actor.uid, name: actor.name },
    { action: `extension.${action}`, module: "extension", resourceType: "project", resourceId: projectId, summary, details },
    ctx.requestId,
    ctx.now,
  );
}

/**
 * Grava o projeto completo (campos esvaziados deixam de existir) e, quando
 * pedido, a lista de presença. `readers` e `editors` são sempre recalculados.
 */
function writeProject(tx: Transaction, loaded: Pick<Loaded, "ref" | "attRef">, next: ExtensionProject, options: { attendance: boolean }) {
  const docs = projectDocs(next);
  tx.set(loaded.ref, docs.project);
  if (options.attendance) tx.set(loaded.attRef, docs.attendance);
}

/** Transições permitidas e quem pode fazê-las ("edit" = canEditProject; "close" = canCloseProject). */
const STATUS_TRANSITIONS: Record<ProjectStatus, Partial<Record<ProjectStatus, "edit" | "close">>> = {
  planning: { open: "edit", done: "close", cancelled: "close" },
  open: { planning: "edit", done: "close", cancelled: "close" },
  done: { planning: "close", cancelled: "close" },
  cancelled: { planning: "close", done: "close" },
};

/**
 * Monta a resposta: o projeto, se o autor ainda pode vê-lo, com a lista de
 * presença SOMENTE para quem pode vê-la (`canSeeAttendees`); para os demais,
 * `attendees` vem vazio e `attendeesRestricted` = true.
 */
export async function presentProject(projectId: string, actor: Actor | null): Promise<ExtensionProject> {
  const { ref, attRef } = refsFor(projectId);
  const snap = await ref.get();
  if (!snap.exists) fail("not_found", "Projeto não encontrado.");
  const restricted = fromSnaps(snap, null);
  if (!actor || !canSeeProject(actor.ctx, restricted)) fail("forbidden", "A operação foi concluída, mas este projeto não está mais disponível para o seu perfil.");
  if (!canSeeAttendees(actor.ctx, restricted)) return restricted;
  return fromSnaps(snap, await attRef.get());
}

interface ProjectRef {
  id: string;
}

const presentResult = async (result: ProjectRef, actor: Actor | null) => presentProject(result.id, actor);

/* -------------------------------- ações --------------------------------- */

export const extensionActions = {
  create: mutation({
    module: "extension",
    schema: createSchema,
    async run(tx, actor, input, ctx): Promise<ProjectRef> {
      actor = actor!;
      requirePermission(actor, "extension.create", "Seu perfil não pode criar projetos.");
      // Leituras
      await requireModuleEnabled(tx, "extension");
      const code = await nextCode(tx, ctx, "ENS");
      const eventId = input.eventId || undefined;
      const [responsibleSnap, eventSnap] = await Promise.all([
        tx.get(db.doc(`members/${input.responsibleId}`)),
        eventId ? tx.get(db.doc(`events/${eventId}`)) : Promise.resolve(null),
      ]);
      // Regras
      assertResponsible(responsibleSnap);
      assertEvent(actor, eventSnap);

      // Escritas
      const ref = db.collection("projects").doc();
      const project: ExtensionProject = {
        id: ref.id,
        code,
        name: input.name,
        description: input.description,
        objective: input.objective,
        activityType: input.activityType,
        responsibleId: input.responsibleId,
        date: input.date,
        time: input.time || undefined,
        location: input.location,
        speakers: [],
        schedule: [],
        attendees: [],
        certificateStatus: "not_started",
        certificateHours: input.certificateHours ?? undefined,
        documentIds: [],
        eventId,
        status: "planning",
        access: sanitizeAudience(input.access),
        createdBy: actor.uid,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        history: [historyEntry(actor.uid, "created", eventId ? "Projeto criado e vinculado a um evento existente" : "Projeto criado", ctx.now)],
      };
      const docs = projectDocs(project);
      tx.create(ref, docs.project);
      tx.create(db.doc(`projects/${ref.id}/private/attendance`), docs.attendance);
      indexRecord(tx, searchEntryFor.project(project));
      audit(tx, actor, ctx, "create", ref.id, `Projeto criado: ${project.name} (${code})`, {
        code,
        activityType: project.activityType,
        scope: project.access.scope,
        eventLinked: !!eventId,
      });
      return { id: ref.id };
    },
    present: presentResult,
  }),

  update: mutation({
    module: "extension",
    schema: updateSchema,
    async run(tx, actor, { id: projectId, input }, ctx): Promise<ProjectRef> {
      actor = actor!;
      // Leituras
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const current = loaded.project;
      requireEditable(actor, current);
      const responsibleChanged = input.responsibleId !== undefined && input.responsibleId !== current.responsibleId;
      const nextEventId = "eventId" in input ? input.eventId || undefined : current.eventId;
      const eventChanged = (nextEventId ?? null) !== (current.eventId ?? null);
      const [responsibleSnap, eventSnap] = await Promise.all([
        responsibleChanged ? tx.get(db.doc(`members/${input.responsibleId}`)) : Promise.resolve(null),
        eventChanged && nextEventId ? tx.get(db.doc(`events/${nextEventId}`)) : Promise.resolve(null),
      ]);
      // Regras
      assertResponsible(responsibleSnap, current.responsibleId);
      assertEvent(actor, eventSnap);

      const next: ExtensionProject = { ...current };
      if (input.name !== undefined) next.name = input.name;
      if (input.description !== undefined) next.description = input.description;
      if (input.objective !== undefined) next.objective = input.objective;
      if (input.activityType !== undefined) next.activityType = input.activityType;
      if (input.responsibleId !== undefined) next.responsibleId = input.responsibleId;
      if (input.date !== undefined) next.date = input.date;
      if ("time" in input) next.time = input.time || undefined;
      if (input.location !== undefined) next.location = input.location;
      if ("eventId" in input) next.eventId = nextEventId;
      if ("certificateHours" in input) next.certificateHours = input.certificateHours ?? undefined;
      if ("report" in input) next.report = input.report || undefined;
      const accessChanged = input.access !== undefined && !sameAudience(sanitizeAudience(input.access), current.access);
      if (input.access !== undefined) next.access = sanitizeAudience(input.access);

      const changed = PROJECT_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null));
      if (changed.length === 0) return { id: projectId };

      const onlyReport = changed.length === 1 && changed[0] === "report";
      const summary = eventChanged ? "Vínculo com evento alterado" : onlyReport ? "Relatório atualizado" : "Projeto editado";
      next.updatedAt = ctx.now;
      next.history = addHistory(
        current,
        actor,
        ctx,
        ["updated", summary],
        ...(accessChanged ? [["shared", "Visibilidade do projeto alterada"] as [HistoryAction, string]] : []),
      );

      // Escritas. A lista de presença só é regravada quando muda quem a organiza (editors).
      writeProject(tx, loaded, next, { attendance: responsibleChanged || !loaded.hasAttendanceDoc });
      indexRecord(tx, searchEntryFor.project(next));
      audit(tx, actor, ctx, "update", projectId, `Projeto ${next.code} editado: ${changed.join(", ")}`, {
        fields: changed.join(","),
        accessChanged,
        responsibleChanged,
        eventLinked: !!next.eventId,
      });
      return { id: projectId };
    },
    present: presentResult,
  }),

  setStatus: mutation({
    module: "extension",
    schema: statusSchema,
    async run(tx, actor, { id: projectId, status }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const current = loaded.project;
      requireVisible(actor, current);
      // Concluir/cancelar exige criador ou extension.archive; demais mudanças, quem edita o projeto.
      if (status === "done" || status === "cancelled") {
        if (!canCloseProject(actor.ctx, current)) fail("forbidden", "Seu perfil não pode concluir ou cancelar projetos.");
      } else if (!canEditProject(actor.ctx, current)) {
        fail("forbidden", "Seu perfil não pode alterar a situação deste projeto.");
      }
      if (current.status === status) return { id: projectId };
      const needed = STATUS_TRANSITIONS[current.status][status];
      if (!needed) fail("conflict", `Não é possível mudar a situação de “${STATUS_LABEL[current.status]}” para “${STATUS_LABEL[status]}”.`);
      if (needed === "close" && !canCloseProject(actor.ctx, current)) fail("forbidden", "Seu perfil não pode reabrir projetos realizados ou cancelados.");

      const next: ExtensionProject = {
        ...current,
        status,
        updatedAt: ctx.now,
        history: addHistory(current, actor, ctx, ["status", `Situação alterada para ${STATUS_LABEL[status]}`]),
      };
      tx.update(loaded.ref, { status, updatedAt: ctx.now, history: next.history });
      indexRecord(tx, searchEntryFor.project(next));
      audit(tx, actor, ctx, "setStatus", projectId, `Projeto ${current.code}: ${STATUS_LABEL[current.status]} → ${STATUS_LABEL[status]}`, { from: current.status, to: status });
      return { id: projectId };
    },
    present: presentResult,
  }),

  addSpeaker: mutation({
    module: "extension",
    schema: addSpeakerSchema,
    async run(tx, actor, { id: projectId, speaker: input }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const p = loaded.project;
      requireEditable(actor, p);
      if (p.speakers.length >= MAX_SPEAKERS) fail("conflict", `Este projeto já tem ${MAX_SPEAKERS} palestrantes ou parceiros, o limite por projeto.`);
      const speaker: Speaker = { id: itemId("spk"), name: input.name, affiliation: input.affiliation ?? "", topic: input.topic || undefined };
      const history = addHistory(p, actor, ctx, ["updated", `Palestrante/parceiro adicionado: ${speaker.name}`]);
      tx.update(loaded.ref, { speakers: [...p.speakers, speaker], updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "addSpeaker", projectId, `Palestrante/parceiro adicionado ao projeto ${p.code}`, { speakerId: speaker.id, speakers: p.speakers.length + 1 });
      return { id: projectId };
    },
    present: presentResult,
  }),

  removeSpeaker: mutation({
    module: "extension",
    schema: removeSpeakerSchema,
    async run(tx, actor, { id: projectId, speakerId }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const p = loaded.project;
      requireEditable(actor, p);
      const speaker = p.speakers.find((s) => s.id === speakerId);
      if (!speaker) fail("not_found", "Palestrante não encontrado. Ele pode ter sido removido.");
      const history = addHistory(p, actor, ctx, ["updated", `Palestrante/parceiro removido: ${speaker.name}`]);
      tx.update(loaded.ref, { speakers: p.speakers.filter((s) => s.id !== speakerId), updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "removeSpeaker", projectId, `Palestrante/parceiro removido do projeto ${p.code}`, { speakerId });
      return { id: projectId };
    },
    present: presentResult,
  }),

  addScheduleItem: mutation({
    module: "extension",
    schema: addScheduleSchema,
    async run(tx, actor, { id: projectId, item: input }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const p = loaded.project;
      requireEditable(actor, p);
      if (p.schedule.length >= MAX_SCHEDULE) fail("conflict", `A programação já tem ${MAX_SCHEDULE} itens, o limite por projeto. Remova itens antes de adicionar outros.`);
      const item: ScheduleItem = { id: itemId("sch"), time: input.time, title: input.title, description: input.description || undefined };
      const schedule = [...p.schedule, item].sort((a, b) => a.time.localeCompare(b.time));
      const history = addHistory(p, actor, ctx, ["updated", `Programação: “${item.title}” às ${item.time}`]);
      tx.update(loaded.ref, { schedule, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "addScheduleItem", projectId, `Item adicionado à programação do projeto ${p.code}`, { itemId: item.id, time: item.time });
      return { id: projectId };
    },
    present: presentResult,
  }),

  removeScheduleItem: mutation({
    module: "extension",
    schema: removeScheduleSchema,
    async run(tx, actor, { id: projectId, itemId: scheduleId }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const p = loaded.project;
      requireEditable(actor, p);
      const item = p.schedule.find((s) => s.id === scheduleId);
      if (!item) fail("not_found", "Item da programação não encontrado. Ele pode ter sido removido.");
      const history = addHistory(p, actor, ctx, ["updated", `Programação: “${item.title}” removido`]);
      tx.update(loaded.ref, { schedule: p.schedule.filter((s) => s.id !== scheduleId), updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "removeScheduleItem", projectId, `Item removido da programação do projeto ${p.code}`, { itemId: scheduleId });
      return { id: projectId };
    },
    present: presentResult,
  }),

  addAttendee: mutation({
    module: "extension",
    schema: addAttendeeSchema,
    async run(tx, actor, { id: projectId, name }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const p = loaded.project;
      requireEditable(actor, p);
      if (p.attendees.length >= MAX_ATTENDEES) fail("conflict", `A lista de presença já tem ${MAX_ATTENDEES} participantes, o limite por projeto.`);
      const key = nameKey(name);
      if (p.attendees.some((a) => nameKey(a.name) === key)) fail("conflict", "Este nome já está na lista de presença.");

      const attendee: Attendee = { id: itemId("att"), name, present: false };
      const attendees = [...p.attendees, attendee];
      // O nome fica SOMENTE na lista de presença (documento privado); histórico e auditoria não o registram.
      const history = addHistory(p, actor, ctx, ["updated", "Participante adicionado à lista de presença"]);
      tx.set(loaded.attRef, projectDocs({ ...p, attendees }).attendance);
      tx.update(loaded.ref, { attendeeCount: attendees.length, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "addAttendee", projectId, `Participante adicionado à lista de presença do projeto ${p.code}`, { attendeeId: attendee.id, attendees: attendees.length });
      return { id: projectId };
    },
    present: presentResult,
  }),

  /** Alta frequência (marcação na hora da atividade): transação pequena, sem histórico. */
  setAttendance: mutation({
    module: "extension",
    schema: attendanceSchema,
    async run(tx, actor, { id: projectId, attendeeId, present }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const p = loaded.project;
      requireEditable(actor, p);
      const attendee = p.attendees.find((a) => a.id === attendeeId);
      if (!attendee) fail("not_found", "Participante não encontrado. Ele pode ter sido removido da lista.");
      if (attendee.present === present) return { id: projectId };
      const attendees = p.attendees.map((a) => (a.id === attendeeId ? { ...a, present } : a));
      tx.update(loaded.attRef, { attendees });
      tx.update(loaded.ref, { updatedAt: ctx.now });
      audit(tx, actor, ctx, "setAttendance", projectId, `Presença ${present ? "marcada" : "desmarcada"} no projeto ${p.code}`, {
        attendeeId,
        present,
        presentCount: attendees.filter((a) => a.present).length,
      });
      return { id: projectId };
    },
    present: presentResult,
  }),

  setCertificateStatus: mutation({
    module: "extension",
    schema: certificateSchema,
    async run(tx, actor, { id: projectId, status }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const p = loaded.project;
      requireEditable(actor, p);
      if (status === "issued") requirePermission(actor, "extension.approve", "Seu perfil não pode marcar certificados como emitidos.");
      // Desfazer a emissão também exige extension.approve.
      if (p.certificateStatus === "issued" && status !== "issued") {
        requirePermission(actor, "extension.approve", "Somente quem aprova certificados pode alterar certificados já emitidos.");
      }
      if (status === "issued" && !p.attendees.some((a) => a.present)) {
        fail("invalid", "Marque a presença de pelo menos um participante antes de emitir certificados.");
      }
      if (p.certificateStatus === status) return { id: projectId };
      const history = addHistory(p, actor, ctx, ["status", `Certificados: ${CERTIFICATE_LABEL[status]}`]);
      tx.update(loaded.ref, { certificateStatus: status, updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "setCertificateStatus", projectId, `Certificados do projeto ${p.code}: ${CERTIFICATE_LABEL[p.certificateStatus]} → ${CERTIFICATE_LABEL[status]}`, {
        from: p.certificateStatus,
        to: status,
        presentCount: p.attendees.filter((a) => a.present).length,
      });
      return { id: projectId };
    },
    present: presentResult,
  }),

  linkDocument: mutation({
    module: "extension",
    schema: linkDocumentSchema,
    async run(tx, actor, { id: projectId, documentId }, ctx): Promise<ProjectRef> {
      actor = actor!;
      await requireModuleEnabled(tx, "extension");
      const loaded = await loadProject(tx, projectId);
      const docSnap = await tx.get(db.doc(`documents/${documentId}`));
      const p = loaded.project;
      requireEditable(actor, p);
      // Documento inexistente ou fora do alcance de quem vincula: mesma resposta (não revela a existência).
      const notFound = "Documento não encontrado. Ele pode ter sido removido ou não estar disponível para o seu perfil.";
      if (!docSnap.exists) fail("not_found", notFound);
      const document = toDTO<InstitutionalDocument>(docSnap);
      if (!canSeeDocument(actor.ctx, document)) fail("not_found", notFound);
      if (p.documentIds.includes(documentId)) return { id: projectId };
      if (p.documentIds.length >= MAX_DOCUMENTS) fail("conflict", `Este projeto já tem ${MAX_DOCUMENTS} documentos vinculados, o limite por projeto.`);
      // O nome do documento não entra no histórico: o público do projeto pode ser maior que o do documento.
      const history = addHistory(p, actor, ctx, ["updated", "Documento vinculado ao projeto"]);
      tx.update(loaded.ref, { documentIds: [...p.documentIds, documentId], updatedAt: ctx.now, history });
      audit(tx, actor, ctx, "linkDocument", projectId, `Documento vinculado ao projeto ${p.code}`, { documentId });
      return { id: projectId };
    },
    present: presentResult,
  }),
};

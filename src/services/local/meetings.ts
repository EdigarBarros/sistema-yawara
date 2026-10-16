import type { MeetingInput, MeetingService } from "../contracts";
import type { Meeting } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import type { AccessContext } from "@/lib/permissions";
import { MEETING_STATUS } from "@/lib/labels";
import { newId } from "@/lib/utils";
import { commit, getDB } from "./db";
import {
  accessContext,
  clone,
  findOrThrow,
  historyEntry,
  latency,
  nextCode,
  now,
  pushNotification,
  requireModuleEnabled,
  requirePermission,
  sanitizeAudience,
  ServiceError,
  validateAudience,
} from "./context";
import { allowedMeetingTransitions, canEditMeeting, canSeeEvent, canSeeMeeting, MEETING_TRANSITIONS } from "@/lib/policies";

/** Limites (os mesmos do servidor). */
const MAX_GUESTS = 50;

function visibleMeeting(db: DemoDB, ctx: AccessContext, id: string) {
  const m = findOrThrow(db.meetings, id, "Reunião");
  if (!canSeeMeeting(ctx, m)) throw new ServiceError("forbidden", "Esta reunião não está disponível para o seu perfil.");
  return m;
}

/** Convidados externos: apenas nomes (2 a 80 caracteres), sem repetição — mesma regra do servidor. */
function cleanGuests(items?: string[]) {
  const seen = new Set<string>();
  const guests = (items ?? [])
    .map((g) => g.trim().replace(/\s+/g, " "))
    .filter((g) => {
      const key = g.toLocaleLowerCase("pt-BR");
      if (!g || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if ((items ?? []).length > MAX_GUESTS) throw new ServiceError("invalid", `Informe no máximo ${MAX_GUESTS} convidados externos.`);
  if (guests.some((g) => g.length > 80)) throw new ServiceError("invalid", "O nome de cada convidado pode ter no máximo 80 caracteres.");
  if (guests.some((g) => g.length < 2)) throw new ServiceError("invalid", "Informe o nome de cada convidado externo (mínimo de 2 caracteres).");
  return guests;
}

/** Evento relacionado: precisa existir e estar visível para quem vincula (mesma regra do servidor). */
function validateEvent(db: DemoDB, ctx: AccessContext, eventId: string | undefined) {
  if (!eventId) return;
  const ev = db.events.find((e) => e.id === eventId);
  if (!ev || !canSeeEvent(ctx, ev)) throw new ServiceError("invalid", "O evento relacionado não existe ou não está disponível para o seu perfil.");
}

function validate(input: Partial<MeetingInput>, creating: boolean) {
  if (creating || input.title !== undefined) {
    if (!input.title || input.title.trim().length < 3) throw new ServiceError("invalid", "Informe o título da reunião.");
  }
  if (creating && !input.date) throw new ServiceError("invalid", "Informe a data.");
  if (creating && !input.startTime) throw new ServiceError("invalid", "Informe o horário de início.");
  if (input.startTime && input.endTime && input.endTime <= input.startTime) {
    throw new ServiceError("invalid", "O horário de término deve ser depois do início.");
  }
  if (creating && (!input.participantIds || input.participantIds.length === 0)) {
    throw new ServiceError("invalid", "Selecione pelo menos um participante.");
  }
  if (input.access) validateAudience(input.access, "Visibilidade");
}

function cleanList(items?: string[]) {
  return (items ?? []).map((i) => i.trim()).filter(Boolean);
}

export const localMeetings: MeetingService = {
  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "meetings");
    const ctx = accessContext(db);
    return clone(db.meetings.filter((m) => canSeeMeeting(ctx, m)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "meetings");
    return clone(visibleMeeting(db, accessContext(db), id));
  },

  async create(input) {
    await latency(300, 550);
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "meetings.create", "Seu perfil não pode registrar reuniões.");
      validate(input, true);
      const guests = cleanGuests(input.guests);
      validateEvent(db, ctx, input.eventId || undefined);
      const at = now();
      const meeting: Meeting = {
        id: newId("mtg"),
        code: nextCode(db, "REU"),
        title: input.title.trim(),
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime || undefined,
        mode: input.mode,
        location: input.location.trim(),
        participantIds: [...new Set(input.participantIds)],
        guests,
        eventId: input.eventId || undefined,
        agenda: cleanList(input.agenda),
        summary: input.summary.trim(),
        decisions: cleanList(input.decisions),
        actions: input.actions.filter((a) => a.description.trim()).map((a) => ({ ...a, description: a.description.trim(), id: newId("act") })),
        documentIds: input.documentIds,
        access: sanitizeAudience(input.access),
        status: "draft",
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", "Reunião registrada como rascunho")],
      };
      db.meetings.unshift(meeting);
      pushNotification(db, {
        kind: "meeting_registered",
        title: "Reunião registrada",
        body: `${ctx.user.name} registrou “${meeting.title}”.`,
        href: `/secretaria/${meeting.id}`,
        audience: meeting.access,
        actorId: ctx.user.id,
      });
      return clone(meeting);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const meeting = visibleMeeting(db, ctx, id);
      if (!canEditMeeting(ctx, meeting)) {
        throw new ServiceError(
          meeting.status === "approved" || meeting.status === "archived" ? "conflict" : "forbidden",
          meeting.status === "approved" || meeting.status === "archived"
            ? "Atas aprovadas ou arquivadas não podem ser editadas. Devolva para rascunho antes, se necessário."
            : "Seu perfil não pode editar esta reunião.",
        );
      }
      validate(input, false);
      // Regras sobre o registro resultante (as mesmas do servidor).
      const nextEnd = "endTime" in input ? input.endTime || undefined : meeting.endTime;
      if (nextEnd && nextEnd <= (input.startTime ?? meeting.startTime)) {
        throw new ServiceError("invalid", "O horário de término deve ser depois do início.");
      }
      if (meeting.status === "pending_approval" && !(input.summary ?? meeting.summary).trim()) {
        throw new ServiceError("invalid", "O resumo das discussões é obrigatório enquanto a ata aguarda aprovação. Devolva para rascunho se precisar apagá-lo.");
      }
      const patch: Partial<Meeting> = { ...input, actions: undefined } as Partial<Meeting>;
      if ("guests" in input) patch.guests = cleanGuests(input.guests);
      if ("eventId" in input) {
        patch.eventId = input.eventId || undefined;
        if (patch.eventId !== meeting.eventId) validateEvent(db, ctx, patch.eventId);
      }
      if (input.agenda) patch.agenda = cleanList(input.agenda);
      if (input.decisions) patch.decisions = cleanList(input.decisions);
      if (input.access) patch.access = sanitizeAudience(input.access);
      if (input.actions) {
        patch.actions = input.actions
          .filter((a) => a.description.trim())
          .map((a) => ({ ...a, description: a.description.trim(), id: a.id ?? newId("act") }));
      } else {
        delete patch.actions;
      }
      Object.assign(meeting, patch, { updatedAt: now() });
      meeting.history.push(historyEntry(ctx.user.id, "updated", "Registro da reunião editado"));
      return clone(meeting);
    });
  },

  async setStatus(id, status) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const meeting = visibleMeeting(db, ctx, id);
      if (!allowedMeetingTransitions(ctx, meeting).includes(status)) {
        const possible = MEETING_TRANSITIONS[meeting.status][status];
        throw new ServiceError(
          possible ? "forbidden" : "conflict",
          possible
            ? "Seu perfil não pode fazer esta alteração de situação."
            : `Não é possível passar de “${MEETING_STATUS[meeting.status].label}” para “${MEETING_STATUS[status].label}”.`,
        );
      }
      if (status === "pending_approval" && !meeting.summary.trim()) {
        throw new ServiceError("invalid", "Preencha o resumo das discussões antes de enviar a ata para aprovação.");
      }
      const from = meeting.status;
      meeting.status = status;
      meeting.updatedAt = now();
      const summary =
        status === "pending_approval"
          ? "Enviada para aprovação"
          : status === "approved"
            ? from === "archived"
              ? "Ata desarquivada"
              : "Ata aprovada"
            : status === "draft"
              ? "Ata devolvida para rascunho"
              : "Ata arquivada";
      meeting.history.push(historyEntry(ctx.user.id, status === "archived" ? "archived" : "status", summary));
      if (status === "pending_approval") {
        pushNotification(db, {
          kind: "meeting_registered",
          title: "Ata aguardando aprovação",
          body: `“${meeting.title}” foi enviada para aprovação.`,
          href: `/secretaria/${meeting.id}`,
          audience: { scope: "board", roleIds: [], userIds: [] },
          actorId: ctx.user.id,
        });
      }
      return clone(meeting);
    });
  },
};

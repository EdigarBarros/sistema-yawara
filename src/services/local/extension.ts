import type { ExtensionService, ProjectInput } from "../contracts";
import type { ExtensionProject } from "@/types";
import type { DemoDB } from "@/data/demo/seed";
import type { AccessContext } from "@/lib/permissions";
import { CERTIFICATE_STATUS, PROJECT_STATUS } from "@/lib/labels";
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
  requireModuleEnabled,
  requirePermission,
  sanitizeAudience,
  ServiceError,
} from "./context";
import { canEditProject, canSeeProject } from "@/lib/policies";

function visible(db: DemoDB, ctx: AccessContext, id: string) {
  const p = findOrThrow(db.projects, id, "Projeto");
  if (!canSeeProject(ctx, p)) throw new ServiceError("forbidden", "Este projeto não está disponível para o seu perfil.");
  return p;
}

function editable(db: DemoDB, ctx: AccessContext, id: string) {
  const p = visible(db, ctx, id);
  if (!canEditProject(ctx, p)) throw new ServiceError("forbidden", "Seu perfil não pode editar este projeto.");
  return p;
}

function validate(db: DemoDB, input: Partial<ProjectInput>, creating: boolean) {
  if (creating || input.name !== undefined) {
    if (!input.name || input.name.trim().length < 3) throw new ServiceError("invalid", "Informe o nome do projeto.");
  }
  if (creating && !input.date) throw new ServiceError("invalid", "Informe a data.");
  if (creating && !input.location?.trim()) throw new ServiceError("invalid", "Informe o local.");
  if (input.certificateHours !== undefined && (input.certificateHours < 0 || input.certificateHours > 400)) {
    throw new ServiceError("invalid", "A carga horária deve estar entre 0 e 400 horas.");
  }
  if (input.eventId) findOrThrow(db.events, input.eventId, "Evento vinculado");
}

function touch(p: ExtensionProject, actorId: string, summary: string, action: "updated" | "status" = "updated") {
  p.updatedAt = now();
  p.history.push(historyEntry(actorId, action, summary));
}

export const localExtension: ExtensionService = {
  async list() {
    await latency();
    const db = getDB();
    requireModuleEnabled(db, "extension");
    const ctx = accessContext(db);
    return clone(db.projects.filter((p) => canSeeProject(ctx, p)));
  },

  async get(id) {
    await latency(120, 260);
    const db = getDB();
    requireModuleEnabled(db, "extension");
    return clone(visible(db, accessContext(db), id));
  },

  async create(input) {
    await latency(300, 550);
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "extension.create", "Seu perfil não pode criar projetos.");
      validate(db, input, true);
      const at = now();
      const event = input.eventId ? db.events.find((e) => e.id === input.eventId) : undefined;
      const project: ExtensionProject = {
        id: newId("prj"),
        code: nextCode(db, "ENS"),
        name: input.name.trim(),
        description: input.description.trim(),
        objective: input.objective.trim(),
        activityType: input.activityType,
        responsibleId: input.responsibleId,
        date: input.date,
        time: input.time || undefined,
        location: input.location.trim(),
        speakers: [],
        schedule: [],
        attendees: [],
        certificateStatus: "not_started",
        certificateHours: input.certificateHours,
        documentIds: [],
        eventId: input.eventId || undefined,
        status: "planning",
        access: sanitizeAudience(input.access),
        createdBy: ctx.user.id,
        createdAt: at,
        updatedAt: at,
        history: [historyEntry(ctx.user.id, "created", event ? `Projeto criado e vinculado ao evento “${event.name}”` : "Projeto criado")],
      };
      db.projects.unshift(project);
      return clone(project);
    });
  },

  async update(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      validate(db, input, false);
      const linkChanged = input.eventId !== undefined && input.eventId !== p.eventId;
      Object.assign(p, input, input.access ? { access: sanitizeAudience(input.access) } : {});
      if (input.eventId === "") p.eventId = undefined;
      touch(p, ctx.user.id, linkChanged ? "Vínculo com evento alterado" : input.report !== undefined ? "Relatório atualizado" : "Projeto editado");
      return clone(p);
    });
  },

  async setStatus(id, status) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const p = visible(db, ctx, id);
      if (status === "done" || status === "cancelled") {
        if (p.createdBy !== ctx.user.id) requirePermission(ctx, "extension.archive", "Seu perfil não pode concluir ou cancelar projetos.");
      } else if (!canEditProject(ctx, p)) {
        throw new ServiceError("forbidden", "Seu perfil não pode alterar a situação deste projeto.");
      }
      p.status = status;
      touch(p, ctx.user.id, `Situação alterada para ${PROJECT_STATUS[status].label}`, "status");
      return clone(p);
    });
  },

  async addSpeaker(id, speaker) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      if (!speaker.name?.trim()) throw new ServiceError("invalid", "Informe o nome do palestrante ou parceiro.");
      p.speakers.push({ ...speaker, name: speaker.name.trim(), id: newId("spk") });
      touch(p, ctx.user.id, `Palestrante/parceiro adicionado: ${speaker.name.trim()}`);
      return clone(p);
    });
  },

  async removeSpeaker(id, speakerId) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      const s = findOrThrow(p.speakers, speakerId, "Palestrante");
      p.speakers = p.speakers.filter((x) => x.id !== speakerId);
      touch(p, ctx.user.id, `Palestrante/parceiro removido: ${s.name}`);
      return clone(p);
    });
  },

  async addScheduleItem(id, item) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      if (!item.title?.trim() || !item.time) throw new ServiceError("invalid", "Informe horário e atividade.");
      p.schedule.push({ ...item, title: item.title.trim(), id: newId("sch") });
      p.schedule.sort((a, b) => a.time.localeCompare(b.time));
      touch(p, ctx.user.id, `Programação: “${item.title.trim()}” às ${item.time}`);
      return clone(p);
    });
  },

  async removeScheduleItem(id, itemId) {
    await latency(120, 260);
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      const item = findOrThrow(p.schedule, itemId, "Item da programação");
      p.schedule = p.schedule.filter((x) => x.id !== itemId);
      touch(p, ctx.user.id, `Programação: “${item.title}” removido`);
      return clone(p);
    });
  },

  async addAttendee(id, name) {
    await latency(100, 200);
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      if (!name.trim() || name.trim().length < 2) throw new ServiceError("invalid", "Informe o nome do participante.");
      if (p.attendees.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())) {
        throw new ServiceError("conflict", "Este nome já está na lista de presença.");
      }
      p.attendees.push({ id: newId("att"), name: name.trim(), present: false });
      touch(p, ctx.user.id, `Participante adicionado à lista: ${name.trim()}`);
      return clone(p);
    });
  },

  async setAttendance(id, attendeeId, present) {
    await latency(60, 140);
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      const a = findOrThrow(p.attendees, attendeeId, "Participante");
      a.present = present;
      p.updatedAt = now();
      return clone(p);
    });
  },

  async setCertificateStatus(id, status) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      if (status === "issued") {
        requirePermission(ctx, "extension.approve", "Seu perfil não pode marcar certificados como emitidos.");
        if (!p.attendees.some((a) => a.present)) throw new ServiceError("invalid", "Marque a presença de pelo menos um participante antes de emitir certificados.");
      }
      p.certificateStatus = status;
      touch(p, ctx.user.id, `Certificados: ${CERTIFICATE_STATUS[status].label}`, "status");
      return clone(p);
    });
  },

  async linkDocument(id, documentId) {
    await latency(100, 200);
    return commit((db) => {
      const ctx = accessContext(db);
      const p = editable(db, ctx, id);
      const doc = findOrThrow(db.documents, documentId, "Documento");
      if (!p.documentIds.includes(documentId)) p.documentIds.push(documentId);
      touch(p, ctx.user.id, `Documento vinculado: ${doc.name}`);
      return clone(p);
    });
  },
};

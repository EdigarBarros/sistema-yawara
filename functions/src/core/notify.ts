/**
 * NOTIFICAÇÕES INTERNAS
 * ---------------------------------------------------------------------------
 * Uma notificação por destinatário (`notifications/{eventKey}__{uid}`), criada
 * pelo servidor depois que a operação foi confirmada. O identificador é
 * determinístico: repetir a mesma operação não duplica notificações.
 *
 * Destinatários = integrantes ATIVOS que pertencem ao público do registro
 * (`readers`) e têm permissão de ver o módulo — ninguém é avisado sobre um
 * registro que não pode abrir. Quem fez a operação não recebe aviso.
 *
 * Nenhum e-mail ou push é enviado: notificações externas, se forem
 * implementadas no futuro, serão uma funcionalidade separada.
 */
import { logger } from "firebase-functions";
import { computeAccess, intersects } from "@/lib/access-tokens";
import type { ModuleKey, NotificationKind, Permission } from "@/types";
import { db, nowISO, timestampInDays } from "./admin";
import { memberFromDoc, roleFromDoc } from "./actor";

export const NOTIFICATION_TTL_DAYS = 180;
const MAX_RECIPIENTS = 1000;

export interface NotifyInput {
  /** Chave única da ocorrência (ex.: `campaign_closed__cmp123`). */
  eventKey: string;
  kind: NotificationKind;
  title: string;
  /** Texto curto, sem dados pessoais de terceiros. */
  body: string;
  href: string;
  module: ModuleKey;
  /** Marcadores de público do registro. */
  readers: string[];
  /** Quem tem `<módulo>.admin` também recebe? (padrão: não — só o público). */
  includeModuleAdmins?: boolean;
  /** Exige uma permissão adicional do destinatário (ex.: meetings.approve). */
  permission?: Permission;
  actorId: string | null;
}

export async function resolveRecipients(input: Pick<NotifyInput, "readers" | "module" | "permission" | "actorId" | "includeModuleAdmins">) {
  const [members, roles] = await Promise.all([db.collection("members").where("status", "==", "active").get(), db.collection("roles").get()]);
  const roleMap = new Map(roles.docs.map((d) => [d.id, roleFromDoc(d.id, d.data())]));
  const recipients: string[] = [];
  for (const doc of members.docs) {
    if (doc.id === input.actorId) continue;
    const member = memberFromDoc(doc.id, doc.data());
    const access = computeAccess(member, roleMap.get(member.roleId));
    if (!access.permissions.includes(`${input.module}.view` as Permission)) continue;
    if (input.permission && !access.permissions.includes(input.permission)) continue;
    const isAdmin = access.permissions.includes(`${input.module}.admin` as Permission);
    if (!intersects(access.tokens, input.readers) && !(input.includeModuleAdmins && isAdmin)) continue;
    recipients.push(doc.id);
    if (recipients.length >= MAX_RECIPIENTS) break;
  }
  return recipients;
}

export async function notify(input: NotifyInput) {
  const recipients = await resolveRecipients(input);
  if (recipients.length === 0) return 0;
  const createdAt = nowISO();
  const writer = db.bulkWriter();
  writer.onWriteError((error) => {
    // Já existe (mesma ocorrência): não é erro — garante que não haja duplicatas.
    if (error.code === 6 /* ALREADY_EXISTS */) return false;
    return error.failedAttempts < 3;
  });
  for (const uid of recipients) {
    const ref = db.doc(`notifications/${safeKey(input.eventKey)}__${uid}`);
    writer
      .create(ref, {
        recipientId: uid,
        kind: input.kind,
        title: input.title.slice(0, 140),
        body: input.body.slice(0, 400),
        href: input.href,
        actorId: input.actorId,
        createdAt,
        readAt: null,
        expireAt: timestampInDays(NOTIFICATION_TTL_DAYS),
      })
      .catch(() => undefined);
  }
  try {
    await writer.close();
  } catch (error) {
    logger.error("Falha ao gravar notificações", { eventKey: input.eventKey, error: (error as Error).message });
  }
  return recipients.length;
}

function safeKey(key: string) {
  return key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 300);
}

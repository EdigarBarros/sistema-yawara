import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { AppNotification, NotificationKind } from "@/types";
import type { NotificationService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { fromSnap, mapFirestoreError } from "./convert";
import { whenAccess } from "./session";

/** Notificações mais recentes exibidas (as antigas expiram em 180 dias). */
const LIST_LIMIT = 50;

interface NotificationDoc {
  id: string;
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  actorId?: string | null;
  createdAt: string;
  readAt?: string | null;
}

/**
 * Notificações internas: uma por destinatário (`notifications/{evento}__{uid}`),
 * criadas pelo servidor. O navegador só lê as próprias e grava `readAt`
 * (uma única vez, com o horário do servidor — regra do Firestore).
 */
async function currentUid() {
  const access = await whenAccess();
  if (access.status !== "active") throw new ServiceError("forbidden", "Sua conta não está ativa.");
  return access.uid;
}

function mineQuery(uid: string) {
  const { db } = firebase();
  return query(collection(db, "notifications"), where("recipientId", "==", uid), orderBy("createdAt", "desc"), limit(LIST_LIMIT));
}

function toNotification(snap: QueryDocumentSnapshot, uid: string): AppNotification {
  const n = fromSnap<NotificationDoc>(snap);
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    createdAt: n.createdAt,
    audience: { scope: "people", roleIds: [], userIds: [uid] },
    actorId: n.actorId ?? undefined,
    readBy: n.readAt ? [uid] : [],
  };
}

/** Assinatura do estado da lista (ids + lidas) — evita recarregar quando nada mudou. */
function signature(docs: QueryDocumentSnapshot[]) {
  return docs.map((d) => `${d.id}:${d.get("readAt") ? 1 : 0}`).join("|");
}
let knownSignature: string | null = null;

export const firebaseNotifications: NotificationService = {
  async list() {
    const uid = await currentUid();
    try {
      const snap = await getDocs(mineQuery(uid));
      knownSignature = signature(snap.docs);
      return snap.docs.map((d) => toNotification(d, uid));
    } catch (error) {
      throw mapFirestoreError(error, "Não foi possível carregar as suas notificações.");
    }
  },

  async markRead(id) {
    const uid = await currentUid();
    const { db } = firebase();
    try {
      const ref = doc(db, "notifications", id);
      const snap = await getDoc(ref);
      if (!snap.exists() || snap.get("recipientId") !== uid) throw new ServiceError("not_found", "Notificação não encontrada.");
      if (snap.get("readAt")) return;
      await updateDoc(ref, { readAt: serverTimestamp() });
    } catch (error) {
      throw mapFirestoreError(error, "Não foi possível marcar a notificação como lida.");
    }
  },

  async markAllRead() {
    const uid = await currentUid();
    const { db } = firebase();
    try {
      const snap = await getDocs(mineQuery(uid));
      const unread = snap.docs.filter((d) => !d.get("readAt"));
      if (unread.length === 0) return;
      const batch = writeBatch(db);
      for (const d of unread) batch.update(d.ref, { readAt: serverTimestamp() });
      await batch.commit();
    } catch (error) {
      throw mapFirestoreError(error, "Não foi possível marcar as notificações como lidas.");
    }
  },

  /** Tempo real: avisa quando chega notificação nova ou quando uma é lida em outro aparelho. */
  subscribe(onChange) {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    currentUid()
      .then((uid) => {
        if (cancelled) return;
        unsubscribe = onSnapshot(
          mineQuery(uid),
          (snap) => {
            // Escritas locais ainda não confirmadas: a própria ação já atualiza a lista.
            if (snap.metadata.hasPendingWrites) return;
            const sig = signature(snap.docs);
            if (sig === knownSignature) return;
            knownSignature = sig;
            onChange();
          },
          (error) => {
            // Sessão encerrada ou permissão revogada: a assinatura termina sem quebrar a tela.
            console.warn("[Notificações] Atualização em tempo real interrompida.", error.code);
          },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  },
};

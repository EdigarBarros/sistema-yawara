import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type QueryConstraint } from "firebase/firestore";
import type { AuditLogEntry } from "@/types";
import type { AuditService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { fromSnap, mapFirestoreError } from "./convert";
import { hasPerm, whenAccess } from "./session";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NO_ACCESS = "Seu perfil não pode consultar a auditoria.";

/**
 * Auditoria oficial (`auditLogs`), gravada somente pelo servidor.
 *
 * Leitura direta no Firestore (as regras exigem `audit.view`), mais recentes
 * primeiro, com UM filtro de igualdade por vez (módulo, autor, recurso ou
 * resultado — cada um tem o seu índice composto com `at`) e paginação por
 * cursor (id do último registro da página anterior).
 */
export const firebaseAudit: AuditService = {
  async list(q) {
    const access = await whenAccess();
    if (!hasPerm(access, "audit.view")) throw new ServiceError("forbidden", NO_ACCESS);

    const filters: [string, string][] = [];
    if (q.module) filters.push(["module", q.module]);
    if (q.actorId) filters.push(["actorId", q.actorId]);
    if (q.resourceId) filters.push(["resourceId", q.resourceId]);
    if (q.outcome) filters.push(["outcome", q.outcome]);
    if (filters.length > 1) throw new ServiceError("invalid", "Use um filtro por vez na auditoria (módulo, autor, registro ou resultado).");
    if (q.after && !SAFE_ID.test(q.after)) throw new ServiceError("invalid", "Posição da lista inválida. Recarregue a página.");

    const size = Math.min(Math.max(1, Math.floor(q.pageSize ?? DEFAULT_PAGE)), MAX_PAGE);
    const { db } = firebase();
    try {
      const constraints: QueryConstraint[] = filters.map(([field, value]) => where(field, "==", value));
      constraints.push(orderBy("at", "desc"));
      if (q.after) {
        const cursor = await getDoc(doc(db, "auditLogs", q.after));
        if (!cursor.exists()) throw new ServiceError("not_found", "A lista mudou desde a última consulta. Recarregue a página.");
        constraints.push(startAfter(cursor));
      }
      // Um registro a mais indica se existe próxima página.
      constraints.push(limit(size + 1));
      const snap = await getDocs(query(collection(db, "auditLogs"), ...constraints));
      const entries = snap.docs.slice(0, size).map((d) => fromSnap<AuditLogEntry>(d));
      return { entries, nextCursor: snap.docs.length > size ? (entries[entries.length - 1]?.id ?? null) : null };
    } catch (error) {
      throw mapFirestoreError(error, NO_ACCESS);
    }
  },

  /** Melhor esforço: a exportação já aconteceu no navegador; uma falha aqui não a desfaz. */
  async recordExport(input) {
    const rid = takeRequestId();
    try {
      await callApi("system", "recordExport", { ...input, summary: input.summary.trim().slice(0, 300) }, rid);
    } catch (error) {
      console.warn("[Auditoria] Não foi possível registrar a exportação.", error instanceof ServiceError ? error.message : error);
    }
  },
};

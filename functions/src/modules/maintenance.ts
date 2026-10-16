/**
 * ROTINAS DE MANUTENÇÃO (agendadas)
 *  - Remove envios abandonados na área temporária `staging/` (mais de 24 h).
 *  - Remove arquivos definitivos que ficaram órfãos porque a operação que os
 *    anexaria falhou e a compensação não foi concluída (tíquetes em
 *    `finalized` há mais de 2 h, contadas da conferência, ou presos em
 *    `finalizing` há mais de 2 h, contadas da reserva).
 *
 * Segurança da limpeza: o tíquete é descartado numa transação (só se continuar
 * no mesmo estado) ANTES de o arquivo ser apagado. Como `finalizeUpload` recusa
 * tíquetes vencidos (validade + 30 min), nenhuma operação em andamento ainda
 * pode anexar um arquivo que a limpeza considera órfão.
 *
 * Exige Cloud Scheduler (plano Blaze). Ver docs/backend/custos.md.
 */
import type { DocumentReference } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/scheduler";
import { logger } from "firebase-functions";
import { bucket, db, nowISO, REGION } from "../core/admin";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Tempo sem anexo depois da conferência (ou da reserva) para considerar o arquivo órfão. */
const ORPHAN_AFTER = 2 * HOUR;

interface OrphanTarget {
  path: string | null;
  destDir: string | null;
  staged: string | null;
}

/** Descarta o tíquete se ainda estiver parado no mesmo estado desde antes do corte. */
async function discardIfStale(ref: DocumentReference, cutoff: number): Promise<OrphanTarget | null> {
  return db.runTransaction(async (tx) => {
    const ticket = (await tx.get(ref)).data();
    if (!ticket) return null;
    const since = ticket.status === "finalized" ? (ticket.finalizedAt ?? ticket.createdAt) : ticket.status === "finalizing" ? (ticket.claimedAt ?? ticket.createdAt) : null;
    if (typeof since !== "string" || !(Date.parse(since) < cutoff)) return null;
    tx.update(ref, { status: "discarded", discardedAt: nowISO() });
    return {
      path: typeof ticket.file?.path === "string" ? ticket.file.path : null,
      destDir: typeof ticket.destDir === "string" && ticket.destDir ? ticket.destDir : null,
      staged: typeof ticket.path === "string" ? ticket.path : null,
    };
  });
}

export async function cleanupUploadsOnce(now = Date.now()) {
  let staging = 0;
  let orphans = 0;
  const [files] = await bucket().getFiles({ prefix: "staging/" });
  for (const file of files) {
    const created = Date.parse(String(file.metadata.timeCreated ?? ""));
    if (Number.isFinite(created) && now - created > DAY) {
      await file.delete({ ignoreNotFound: true });
      staging++;
    }
  }

  const cutoff = now - ORPHAN_AFTER;
  // Pré-filtro pelo índice (status, createdAt): quem foi reservado ou conferido
  // antes do corte também foi criado antes dele. O corte real é conferido abaixo.
  const candidates = await db
    .collection("uploads")
    .where("status", "in", ["finalized", "finalizing"])
    .where("createdAt", "<", new Date(cutoff).toISOString())
    .limit(500)
    .get();
  for (const doc of candidates.docs) {
    try {
      const target = await discardIfStale(doc.ref, cutoff);
      if (!target) continue;
      // O tíquete já está descartado: nenhuma operação anexa mais este arquivo.
      if (target.path) await bucket().file(target.path).delete({ ignoreNotFound: true });
      if (target.destDir) {
        // Reserva interrompida no meio da cópia: o caminho exato não foi gravado.
        const [left] = await bucket().getFiles({ prefix: `${target.destDir}/${doc.id}-` });
        await Promise.all(left.map((f) => f.delete({ ignoreNotFound: true })));
      }
      if (target.staged) await bucket().file(target.staged).delete({ ignoreNotFound: true });
      orphans++;
    } catch (error) {
      logger.warn("Limpeza de um envio falhou; nova tentativa na próxima execução", { uploadId: doc.id, error: (error as Error).message });
    }
  }
  return { staging, orphans };
}

export const cleanupUploads = onSchedule({ schedule: "every day 04:00", timeZone: "America/Sao_Paulo", region: REGION }, async () => {
  const result = await cleanupUploadsOnce();
  logger.info("Limpeza de envios concluída", result);
});

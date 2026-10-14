/**
 * ROTINAS DE MANUTENÇÃO (agendadas)
 *  - Remove envios abandonados na área temporária `staging/` (mais de 24 h).
 *  - Remove arquivos definitivos que ficaram órfãos porque a operação que os
 *    anexaria falhou e a compensação não foi concluída.
 *
 * Exige Cloud Scheduler (plano Blaze). Ver docs/backend/custos.md.
 */
import { onSchedule } from "firebase-functions/scheduler";
import { logger } from "firebase-functions";
import { bucket, db, nowISO, REGION } from "../core/admin";

const DAY = 24 * 60 * 60 * 1000;

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
  const stale = await db
    .collection("uploads")
    .where("status", "==", "finalized")
    .where("createdAt", "<", new Date(now - 2 * 60 * 60 * 1000).toISOString())
    .limit(500)
    .get();
  for (const doc of stale.docs) {
    const path = doc.data().file?.path as string | undefined;
    if (path) await bucket().file(path).delete({ ignoreNotFound: true });
    await doc.ref.update({ status: "discarded", discardedAt: nowISO() });
    orphans++;
  }
  return { staging, orphans };
}

export const cleanupUploads = onSchedule({ schedule: "every day 04:00", timeZone: "America/Sao_Paulo", region: REGION }, async () => {
  const result = await cleanupUploadsOnce();
  logger.info("Limpeza de envios concluída", result);
});

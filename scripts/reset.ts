/**
 * RESET DOS DADOS DE UM AMBIENTE REAL (começar do zero mantendo o administrador)
 * ---------------------------------------------------------------------------
 * Apaga TUDO o que foi registrado na Central e mantém apenas:
 *  - a conta (Authentication) e o cadastro (members, memberPrivate, userAccess)
 *    do administrador indicado em --manter;
 *  - a estrutura institucional: settings/system, departamentos, cargos e
 *    categorias de documentos e do financeiro.
 *
 * O que é apagado:
 *  - todas as outras contas de acesso (Authentication) e seus cadastros;
 *  - convites, auditoria, notificações;
 *  - campanhas/rifas (com vendas e compradores), eventos (com tarefas e
 *    programação — é o que alimenta a agenda), documentos, reuniões e atas,
 *    lançamentos financeiros, conteúdos de marketing, projetos de extensão
 *    (com listas de presença) e os arquivos guardados no próprio banco;
 *  - dados internos do servidor: índice de busca, tíquetes de envio,
 *    idempotência e contadores de códigos (os códigos recomeçam do 001).
 *
 * Segurança:
 *  - Sem --apagar, é só um ENSAIO: mostra o que seria apagado e não toca em nada.
 *  - Com --apagar, pede para digitar "APAGAR <id-do-projeto>" antes de começar.
 *  - Recusa rodar se o e-mail de --manter não tiver conta e cadastro ativos
 *    (para você nunca ficar trancado do lado de fora).
 *  - Coleções que este script não conhece são listadas e NÃO são apagadas.
 *  - Usa as credenciais do ambiente (no Cloud Shell, a sua própria conta
 *    Google). Nenhuma chave é lida do repositório.
 *  - Ao final grava UM registro de auditoria dizendo que o reset foi feito,
 *    por quem e quando — a auditoria nova começa a partir dele.
 *
 * Uso (no Cloud Shell, dentro da pasta do projeto):
 *   npm run reset -- --project <id-do-projeto> --manter <email-do-admin>            # ensaio
 *   npm run reset -- --project <id-do-projeto> --manter <email-do-admin> --apagar   # apaga de verdade
 */
import { createInterface } from "node:readline/promises";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type CollectionReference } from "firebase-admin/firestore";

/** Apagadas por inteiro (com subcoleções). */
const WIPE = [
  "auditLogs",
  "invitations",
  "notifications",
  "campaigns",
  "events",
  "documents",
  "meetings",
  "financeEntries",
  "contents",
  "projects",
  "searchIndex",
  "uploads",
  "fileChunks",
  "idempotency",
  "counters",
] as const;

/** Um documento por integrante: apaga todos menos o do administrador mantido. */
const PER_MEMBER = ["members", "memberPrivate", "userAccess"] as const;

/** Estrutura institucional: nunca é apagada por este script. */
const KEEP = ["settings", "departments", "roles", "documentCategories", "financeCategories"] as const;

/** Subcoleções contadas no ensaio (campanhas e projetos). */
const SUBCOLLECTIONS = ["sales", "buyers", "private"] as const;

const AUDIT_RETENTION_DAYS = 1825;

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function count(ref: FirebaseFirestore.Query) {
  return (await ref.count().get()).data().count;
}

async function main() {
  const project = arg("project");
  const keepEmail = arg("manter")?.trim().toLowerCase();
  const apply = process.argv.includes("--apagar");
  if (!project) throw new Error("Informe --project <id-do-projeto>.");
  if (!keepEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(keepEmail)) throw new Error("Informe --manter <email-do-administrador>.");

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  const auth = getAuth();

  console.log(`\nProjeto: ${project}${emulator ? " (EMULADOR)" : ""}`);
  console.log(`Conta mantida: ${keepEmail}`);
  console.log(apply ? "Modo: APAGAR DE VERDADE\n" : "Modo: ENSAIO (nada será apagado; use --apagar para executar)\n");

  // 1. A conta mantida precisa existir e estar ativa — senão o reset deixaria a Central sem administrador.
  const admin = await auth.getUserByEmail(keepEmail).catch(() => null);
  if (!admin) throw new Error(`Não existe conta de acesso com o e-mail ${keepEmail}. Nada foi feito.`);
  if (admin.disabled) throw new Error(`A conta ${keepEmail} está desativada. Nada foi feito.`);
  const adminMember = await db.doc(`members/${admin.uid}`).get();
  if (!adminMember.exists || adminMember.get("status") !== "active") {
    throw new Error(`A conta ${keepEmail} não tem cadastro ativo na Central (members/${admin.uid}). Nada foi feito.`);
  }
  const adminName = String(adminMember.get("name") ?? keepEmail);
  console.log(`Administrador encontrado: ${adminName} (uid ${admin.uid})\n`);

  // 2. Levantamento.
  const plan: { label: string; n: number }[] = [];
  for (const name of WIPE) plan.push({ label: name, n: await count(db.collection(name)) });
  for (const name of SUBCOLLECTIONS) plan.push({ label: `  └ ${name} (subcoleção)`, n: await count(db.collectionGroup(name)) });
  for (const name of PER_MEMBER) {
    const total = await count(db.collection(name));
    const hasAdmin = (await db.doc(`${name}/${admin.uid}`).get()).exists ? 1 : 0;
    plan.push({ label: `${name} (menos o administrador)`, n: total - hasAdmin });
  }
  const otherUids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) if (u.uid !== admin.uid) otherUids.push(u.uid);
    pageToken = page.pageToken;
  } while (pageToken);
  plan.push({ label: "contas de acesso (Authentication)", n: otherUids.length });

  const known = new Set<string>([...WIPE, ...PER_MEMBER, ...KEEP]);
  const unknown = (await db.listCollections()).map((c) => c.id).filter((id) => !known.has(id));

  console.log("Será apagado:");
  for (const p of plan) console.log(`  ${p.label.padEnd(42)} ${p.n}`);
  console.log(`\nMantido: conta e cadastro de ${keepEmail}; ${KEEP.join(", ")}.`);
  if (unknown.length) console.log(`Coleções desconhecidas, NÃO serão mexidas: ${unknown.join(", ")}`);

  if (!apply) {
    console.log("\nEnsaio concluído. Nada foi apagado. Para executar, rode de novo com --apagar.");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nIsso NÃO pode ser desfeito. Digite  APAGAR ${project}  para confirmar: `);
  rl.close();
  if (answer.trim() !== `APAGAR ${project}`) throw new Error("Confirmação não confere. Nada foi apagado.");

  // 3. Firestore: coleções inteiras (recursiveDelete leva junto as subcoleções).
  for (const name of WIPE) {
    process.stdout.write(`Apagando ${name}… `);
    await db.recursiveDelete(db.collection(name));
    console.log("ok");
  }
  // 4. Cadastros por integrante, menos o administrador.
  for (const name of PER_MEMBER) {
    process.stdout.write(`Apagando ${name} (menos o administrador)… `);
    const col: CollectionReference = db.collection(name);
    const refs = (await col.listDocuments()).filter((ref) => ref.id !== admin.uid);
    const writer = db.bulkWriter();
    for (const ref of refs) void writer.delete(ref);
    await writer.close();
    console.log(`ok (${refs.length})`);
  }
  // 5. Contas de acesso, menos a do administrador.
  process.stdout.write("Apagando contas de acesso… ");
  let failed = 0;
  for (let i = 0; i < otherUids.length; i += 1000) {
    const res = await auth.deleteUsers(otherUids.slice(i, i + 1000));
    failed += res.failureCount;
    for (const e of res.errors) console.error(`\n  falhou ${otherUids[i + e.index]}: ${e.error.message}`);
  }
  console.log(failed ? `concluído com ${failed} falha(s)` : `ok (${otherUids.length})`);

  // 6. Primeiro registro da auditoria nova.
  const now = new Date();
  await db.collection("auditLogs").add({
    at: now.toISOString(),
    actorId: admin.uid,
    actorName: adminName,
    action: "settings.resetData",
    module: "settings",
    resourceType: "settings",
    resourceId: null,
    outcome: "success",
    summary: "Dados da Central reiniciados pelo script de reset (Cloud Shell). Mantidos: conta do administrador e estrutura institucional.",
    details: { accountsRemoved: otherUids.length - failed },
    expireAt: Timestamp.fromMillis(now.getTime() + AUDIT_RETENTION_DAYS * 86_400_000),
  });

  console.log(`\nPronto. A Central foi reiniciada. Entre com ${keepEmail} e convide a equipe de novo.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nErro: ${(e as Error).message}`);
  process.exit(1);
});

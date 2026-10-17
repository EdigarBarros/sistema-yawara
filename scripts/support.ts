/**
 * SUPORTE DO SISTEMA: cria o cargo e move uma conta para ele
 * ---------------------------------------------------------------------------
 * - Cria o cargo "Suporte do sistema" (src/lib/support.ts) se ainda não existir.
 * - Move a conta de --email para esse cargo (acima da Presidência).
 * - Opcional: --remover <email> apaga outra conta de acesso e o cadastro dela
 *   (Authentication + members, memberPrivate, userAccess). Os registros que
 *   essa pessoa criou continuam, com o autor mostrado como "Integrante removido".
 *
 * Segurança:
 *  - Sem --aplicar, é só um ENSAIO: mostra o que seria feito.
 *  - Com --aplicar, pede para digitar o id do projeto.
 *  - A conta promovida precisa existir e estar ativa; a conta removida não
 *    pode ser a mesma.
 *  - Grava o que foi feito na auditoria.
 *
 * Uso (no Cloud Shell, dentro da pasta do projeto):
 *   npm run suporte -- --project <id> --email <email-do-suporte> [--remover <email>]            # ensaio
 *   npm run suporte -- --project <id> --email <email-do-suporte> [--remover <email>] --aplicar  # de verdade
 */
import { createInterface } from "node:readline/promises";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { computeAccess } from "../src/lib/access-tokens";
import { SUPPORT_ROLE_ID, supportRoleDefinition } from "../src/lib/support";
import type { Member, Role } from "../src/types";

const AUDIT_RETENTION_DAYS = 1825;

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]?.trim().toLowerCase() : undefined;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function main() {
  const project = process.argv[process.argv.indexOf("--project") + 1];
  const email = arg("email");
  const removeEmail = arg("remover");
  const apply = process.argv.includes("--aplicar");
  if (!process.argv.includes("--project") || !project) throw new Error("Informe --project <id-do-projeto>.");
  if (!email || !EMAIL.test(email)) throw new Error("Informe --email <email-da-conta-de-suporte>.");
  if (removeEmail !== undefined && !EMAIL.test(removeEmail)) throw new Error("--remover precisa de um e-mail válido.");
  if (removeEmail === email) throw new Error("A conta removida não pode ser a mesma que vai para o suporte.");

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  const auth = getAuth();
  const now = new Date().toISOString();

  console.log(`\nProjeto: ${project}${emulator ? " (EMULADOR)" : ""}`);
  console.log(apply ? "Modo: APLICAR\n" : "Modo: ENSAIO (nada será alterado; use --aplicar para executar)\n");

  // Conta que vai para o suporte.
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user || user.disabled) throw new Error(`Não existe conta ativa com o e-mail ${email}. Nada foi feito.`);
  const memberSnap = await db.doc(`members/${user.uid}`).get();
  if (!memberSnap.exists || memberSnap.get("status") !== "active") throw new Error(`A conta ${email} não tem cadastro ativo na Central. Nada foi feito.`);
  const name = String(memberSnap.get("name"));

  // Conta a remover (opcional).
  const removeUser = removeEmail ? await auth.getUserByEmail(removeEmail).catch(() => null) : null;
  if (removeEmail && !removeUser) throw new Error(`Não existe conta com o e-mail ${removeEmail}. Nada foi feito.`);
  const removeName = removeUser ? String((await db.doc(`members/${removeUser.uid}`).get()).get("name") ?? removeEmail) : "";

  const roleRef = db.doc(`roles/${SUPPORT_ROLE_ID}`);
  const roleExists = (await roleRef.get()).exists;

  console.log(`- Cargo "Suporte do sistema": ${roleExists ? "já existe (mantido)" : "será criado"}`);
  console.log(`- ${name} <${email}>: ${memberSnap.get("roleId") === SUPPORT_ROLE_ID ? "já está no suporte" : `sai de "${memberSnap.get("roleId")}" e vai para o suporte`}`);
  if (removeUser) console.log(`- ${removeName} <${removeEmail}>: conta de acesso e cadastro serão APAGADOS`);

  if (!apply) {
    console.log("\nEnsaio concluído. Nada foi alterado. Para executar, rode de novo com --aplicar.");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nDigite o id do projeto (${project}) para confirmar: `);
  rl.close();
  if (answer.trim() !== project) throw new Error("Confirmação não confere. Nada foi alterado.");

  // O suporte fica no mesmo departamento do cargo atual da pessoa (na estrutura padrão, a Presidência).
  const currentRole = await db.doc(`roles/${memberSnap.get("roleId")}`).get();
  const def = { ...supportRoleDefinition(), departmentId: String(currentRole.get("departmentId") ?? supportRoleDefinition().departmentId) };
  const role: Role = { ...def, id: SUPPORT_ROLE_ID, createdAt: now, updatedAt: now };
  const audit = (action: string, resourceType: string, resourceId: string, summary: string) =>
    db.collection("auditLogs").add({
      at: now,
      actorId: user.uid,
      actorName: name,
      action,
      module: "organization",
      resourceType,
      resourceId,
      outcome: "success",
      summary,
      expireAt: Timestamp.fromMillis(Date.now() + AUDIT_RETENTION_DAYS * 86_400_000),
    });

  await db.runTransaction(async (tx) => {
    const roleSnap = await tx.get(roleRef);
    const accessSnap = await tx.get(db.doc(`userAccess/${user.uid}`));
    const current = roleSnap.exists ? ({ id: SUPPORT_ROLE_ID, ...roleSnap.data() } as Role) : role;
    if (!roleSnap.exists) tx.create(roleRef, { ...def, createdAt: now, updatedAt: now, createdBy: user.uid, updatedBy: user.uid });
    const member: Member = {
      id: user.uid,
      name,
      email: "",
      roleId: SUPPORT_ROLE_ID,
      status: "active",
      joinedAt: String(memberSnap.get("joinedAt") ?? now),
      departmentIds: (memberSnap.get("departmentIds") as string[] | undefined) ?? [],
    };
    tx.update(db.doc(`members/${user.uid}`), { roleId: SUPPORT_ROLE_ID, updatedAt: now, updatedBy: user.uid });
    tx.set(db.doc(`userAccess/${user.uid}`), computeAccess(member, current, Number(accessSnap.get("version") ?? 0), now));
  });
  await auth.revokeRefreshTokens(user.uid);
  if (!roleExists) await audit("organization.createRole", "role", SUPPORT_ROLE_ID, "Cargo criado: Suporte do sistema (script de suporte)");
  await audit("organization.updateMember", "member", user.uid, `Integrante ${name}: cargo → Suporte do sistema (script de suporte)`);
  console.log(`ok: ${name} agora é Suporte do sistema`);

  if (removeUser) {
    const batch = db.batch();
    for (const col of ["members", "memberPrivate", "userAccess"]) batch.delete(db.doc(`${col}/${removeUser.uid}`));
    await batch.commit();
    await auth.deleteUser(removeUser.uid);
    await audit("organization.removeMember", "member", removeUser.uid, `Conta removida: ${removeName} (script de suporte)`);
    console.log(`ok: conta ${removeEmail} removida`);
  }

  console.log(`\nPronto. Saia e entre de novo com ${email} para a mudança valer na sessão.`);
}

main().catch((e) => {
  console.error(`\nErro: ${(e as Error).message}`);
  process.exit(1);
});

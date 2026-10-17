/**
 * IMPLANTAÇÃO INICIAL DE UM AMBIENTE REAL (desenvolvimento, homologação ou produção)
 * ---------------------------------------------------------------------------
 * Cria a estrutura institucional mínima e o convite do primeiro administrador.
 *
 * Garantias:
 *  - NUNCA apaga nem sobrescreve dados: cada documento só é criado se ainda
 *    não existir (operações "create"); o que já existe é mantido e listado.
 *  - NUNCA grava dados fictícios: usa apenas a estrutura de
 *    src/data/structure/default-structure.ts (departamentos, cargos,
 *    categorias e configurações), que pode ser editada depois na própria Central.
 *  - Exige o id do projeto explícito e confirmação.
 *  - Usa as credenciais do ambiente (Application Default Credentials, ex.:
 *    `gcloud auth application-default login`). Nenhuma chave é lida do
 *    repositório.
 *
 * Uso:
 *   npm run bootstrap -- --project <id-do-projeto> --admin-email <email> --admin-name "<nome>" [--app-url https://...] [--yes]
 *   npm run bootstrap -- --project <id-do-projeto> --admin-email <email> --admin-name "<nome>" --senha
 *
 * Com --senha, o script pede a senha do primeiro administrador no terminal
 * (sem mostrá-la na tela) e já cria a conta, sem link de convite: depois é só
 * entrar em /login. Por dentro, usa exatamente o mesmo aceite de convite da
 * Central (mesmas regras de senha, mesma auditoria). A senha não é gravada nem
 * registrada em log.
 *
 * O que acontece:
 *   1. Cria settings/system, departamentos, cargos e categorias (se ausentes).
 *   2. Se ainda não houver nenhum integrante com `organization.admin`, cria um
 *      convite de uso único (7 dias) para o primeiro administrador, no cargo
 *      "presidente", e mostra o link UMA vez no terminal.
 */
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_DOCUMENT_CATEGORIES,
  DEFAULT_FINANCE_CATEGORIES,
  DEFAULT_ROLES,
  defaultSystemSettings,
} from "../src/data/structure/default-structure";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const project = arg("project");
  const adminEmail = arg("admin-email")?.trim().toLowerCase();
  const adminName = arg("admin-name")?.trim();
  const appUrl = (arg("app-url") ?? "http://localhost:3000").replace(/\/+$/, "");
  if (!project) throw new Error("Informe --project <id-do-projeto>.");
  if (adminEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new Error("--admin-email inválido.");
  if (adminEmail && (!adminName || adminName.length < 2)) throw new Error('Informe --admin-name "Nome completo".');
  const withPassword = process.argv.includes("--senha");
  if (withPassword && !adminEmail) throw new Error("--senha precisa de --admin-email e --admin-name.");

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`Projeto: ${project}${emulator ? " (EMULADOR)" : ""}`);
  console.log("Este script só CRIA o que estiver faltando. Nada existente será alterado ou apagado.");
  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Digite o id do projeto (${project}) para confirmar: `);
    rl.close();
    if (answer.trim() !== project) throw new Error("Confirmação não confere. Nada foi feito.");
  }

  // Pede a senha antes de gravar qualquer coisa: se ela não servir, nada é criado.
  const password = withPassword ? await askNewPassword() : undefined;

  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  // Mesma configuração do servidor (functions/src/core/admin.ts), que é reaproveitado no modo --senha.
  db.settings({ ignoreUndefinedProperties: true });
  const now = new Date().toISOString();
  const created: string[] = [];
  const kept: string[] = [];

  async function createIfMissing(path: string, data: object) {
    try {
      await db.doc(path).create(data);
      created.push(path);
    } catch (error) {
      if ((error as { code?: number }).code === 6) kept.push(path);
      else throw error;
    }
  }

  await createIfMissing("settings/system", defaultSystemSettings());
  for (const d of DEFAULT_DEPARTMENTS) {
    const { id, ...rest } = d;
    await createIfMissing(`departments/${id}`, { ...rest, createdAt: now, createdBy: "bootstrap" });
  }
  for (const r of DEFAULT_ROLES) {
    const { id, ...rest } = r;
    await createIfMissing(`roles/${id}`, { ...rest, createdAt: now, updatedAt: now, createdBy: "bootstrap" });
  }
  for (const c of DEFAULT_DOCUMENT_CATEGORIES) await createIfMissing(`documentCategories/${c.id}`, { name: c.name, createdAt: now });
  for (const c of DEFAULT_FINANCE_CATEGORIES) await createIfMissing(`financeCategories/${c.id}`, { name: c.name, type: c.type, createdAt: now });

  console.log(`Criados: ${created.length} documento(s). Já existentes (mantidos): ${kept.length}.`);

  if (!adminEmail) {
    console.log("Sem --admin-email: nenhum convite foi criado.");
    return;
  }

  // Primeiro administrador: só se ainda não houver nenhum ativo com organization.admin.
  const [members, roles] = await Promise.all([db.collection("members").where("status", "==", "active").get(), db.collection("roles").get()]);
  const adminRoles = new Set(roles.docs.filter((r) => r.data().active && (r.data().permissions as string[]).includes("organization.admin")).map((r) => r.id));
  if (members.docs.some((m) => adminRoles.has(m.data().roleId))) {
    console.log("Já existe administrador ativo. Novos integrantes devem ser convidados pela própria Central.");
    return;
  }
  const pending = await db.collection("invitations").where("email", "==", adminEmail).where("status", "==", "pending").get();
  // No modo --senha o aceite revoga sozinho os convites ainda pendentes deste e-mail (link perdido não atrapalha).
  if (!pending.empty && !password) {
    console.log("Já existe um convite pendente para esse e-mail. Revogue-o pela Central ou aguarde a expiração.");
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const ref = db.collection("invitations").doc();
  await ref.create({
    name: adminName,
    email: adminEmail,
    roleId: "presidente",
    departmentIds: [],
    tokenHash: createHash("sha256").update(token).digest("hex"),
    status: "pending",
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdBy: "bootstrap",
    createdAt: now,
  });
  await db.collection("auditLogs").add({
    at: now,
    actorId: null,
    actorName: "Implantação inicial",
    action: "organization.bootstrapInvite",
    module: "organization",
    resourceType: "invitation",
    resourceId: ref.id,
    outcome: "success",
    summary: "Convite do primeiro administrador criado pelo script de implantação",
    expireAt: Timestamp.fromMillis(Date.now() + 1825 * 24 * 60 * 60 * 1000),
  });
  if (password) {
    process.env.GCLOUD_PROJECT ??= project;
    const [{ authActions }, { executeAction }] = await Promise.all([
      import("../functions/src/modules/organization"),
      import("../functions/src/core/dispatch"),
    ]);
    try {
      await executeAction(authActions.acceptInvitation, undefined, { token, password });
    } catch (error) {
      // O convite criado agora não fica sobrando.
      await ref.update({ status: "revoked", revokedAt: new Date().toISOString() }).catch(() => undefined);
      throw new Error(`a conta não foi criada. ${(error as Error).message}`);
    }
    console.log(`\nConta de administrador criada para ${adminEmail}.`);
    console.log(`Entre em ${appUrl}/login com esse e-mail e a senha que você digitou.`);
    return;
  }
  console.log("\nConvite do primeiro administrador (válido por 7 dias, uso único). Envie por um canal confiável:");
  console.log(`  ${appUrl}/convite?token=${token}\n`);
  console.log("Este link não será mostrado novamente.");
}

const PASSWORD_RULE = "A senha precisa ter de 8 a 128 caracteres, com pelo menos uma letra e um número.";

/** Lê uma linha do terminal sem mostrar o que é digitado. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("--senha precisa ser usado num terminal interativo."));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelado. Nada foi feito.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function askNewPassword() {
  console.log(`\nCrie a senha do primeiro administrador. ${PASSWORD_RULE} Ela não aparece enquanto você digita.`);
  const first = await askHidden("Senha: ");
  if (first.length < 8 || first.length > 128 || !/[A-Za-zÀ-ÿ]/.test(first) || !/\d/.test(first)) throw new Error(`${PASSWORD_RULE} Nada foi feito.`);
  const second = await askHidden("Repita a senha: ");
  if (first !== second) throw new Error("As senhas não conferem. Nada foi feito.");
  return first;
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`Erro: ${(error as Error).message}`);
    process.exit(1);
  },
);

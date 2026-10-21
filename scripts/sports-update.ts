/**
 * ATUALIZAÇÃO: ÁREA DE ESPORTES EM UMA INSTALAÇÃO JÁ EXISTENTE
 * ---------------------------------------------------------------------------
 * Os cargos ficam gravados no banco com as permissões que existiam quando
 * foram criados. Este script prepara uma Central que já está em uso para o
 * módulo Esportes:
 *  1. Liga o módulo em settings/system (se ainda não houver a chave).
 *  2. Cria o departamento Esportes (ESP) e os cargos Diretor(a) e Assessor(a)
 *     de Esportes, se ainda não existirem (pelo id ou pelo nome).
 *  3. Dá as permissões de Esportes ao cargo Suporte do sistema (todas as
 *     permissões do sistema) e aos cargos que administram permissões
 *     (presidência e vice).
 *  4. Recalcula o acesso (`userAccess`) de quem está nos cargos alterados.
 *
 * Segurança:
 *  - NUNCA apaga nada nem retira permissões; só cria o que falta e soma
 *    permissões de Esportes.
 *  - Sem --aplicar, é só um ENSAIO: mostra o que seria feito.
 *  - Com --aplicar, pede para digitar o id do projeto.
 *  - Grava o que foi feito na auditoria.
 *
 * Uso (no Cloud Shell, dentro da pasta do projeto):
 *   npm run esportes -- --project <id>             # ensaio
 *   npm run esportes -- --project <id> --aplicar   # de verdade
 */
import { createInterface } from "node:readline/promises";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { computeAccess } from "../src/lib/access-tokens";
import { allPermissions, permissionsFor } from "../src/lib/modules";
import { isSupportRole } from "../src/lib/support";
import { DEFAULT_DEPARTMENTS, DEFAULT_ROLES } from "../src/data/structure/default-structure";
import type { Member, Permission, Role } from "../src/types";

const AUDIT_RETENTION_DAYS = 1825;
const SPORTS_ALL = permissionsFor("sports", ["view", "create", "edit", "archive", "export", "admin"]);

async function main() {
  const i = process.argv.indexOf("--project");
  const project = i >= 0 ? process.argv[i + 1] : undefined;
  const apply = process.argv.includes("--aplicar");
  if (!project) throw new Error("Informe --project <id-do-projeto>.");

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  const now = new Date().toISOString();

  console.log(`\nProjeto: ${project}${emulator ? " (EMULADOR)" : ""}`);
  console.log(apply ? "Modo: APLICAR\n" : "Modo: ENSAIO (nada será alterado; use --aplicar para executar)\n");

  const [settingsSnap, depsSnap, rolesSnap, membersSnap] = await Promise.all([
    db.doc("settings/system").get(),
    db.collection("departments").get(),
    db.collection("roles").get(),
    db.collection("members").get(),
  ]);
  const roles = rolesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Role, "id">) }));
  const lower = (s: string) => s.trim().toLowerCase();

  // 1. Módulo
  const modules = (settingsSnap.get("modules") ?? {}) as Record<string, boolean>;
  const enableModule = settingsSnap.exists && modules.sports === undefined;
  console.log(`- Módulo Esportes: ${!settingsSnap.exists ? "sem configurações (já conta como ligado)" : enableModule ? "será ligado" : modules.sports ? "já ligado" : "DESLIGADO nas configurações (mantido; ligue em Configurações se quiser)"}`);

  // 2. Departamento e cargos
  const depSeed = DEFAULT_DEPARTMENTS.find((d) => d.id === "esportes")!;
  const existingDep = depsSnap.docs.find((d) => d.id === depSeed.id || lower(String(d.get("name"))) === "esportes" || String(d.get("shortName")).toUpperCase() === "ESP");
  const depId = existingDep?.id ?? depSeed.id;
  console.log(`- Departamento Esportes: ${existingDep ? `já existe (“${existingDep.get("name")}”)` : "será criado"}`);

  const roleSeeds = DEFAULT_ROLES.filter((r) => r.id === "diretor-esportes" || r.id === "assessor-esportes");
  const newRoles = roleSeeds.filter((seed) => !roles.some((r) => r.id === seed.id || lower(r.name) === lower(seed.name)));
  for (const seed of roleSeeds) console.log(`- Cargo ${seed.name}: ${newRoles.includes(seed) ? "será criado" : "já existe (mantido)"}`);

  // 3. Permissões
  const grants = new Map<string, Permission[]>();
  for (const r of roles) {
    const wanted = isSupportRole(r.id) ? allPermissions() : r.permissions?.includes("organization.admin") ? SPORTS_ALL : [];
    const missing = wanted.filter((p) => !r.permissions?.includes(p));
    if (missing.length) grants.set(r.id, missing);
  }
  for (const [roleId, missing] of grants) console.log(`- Cargo ${roles.find((r) => r.id === roleId)?.name}: ganha ${missing.length} permissão(ões) (${missing.join(", ")})`);
  if (grants.size === 0) console.log("- Permissões: nada a acrescentar");

  const affected = membersSnap.docs.filter((m) => grants.has(String(m.get("roleId"))));
  console.log(`- Acesso recalculado de ${affected.length} integrante(s)`);

  if (!apply) {
    console.log("\nEnsaio concluído. Nada foi alterado. Para executar, rode de novo com --aplicar.");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nDigite o id do projeto (${project}) para confirmar: `);
  rl.close();
  if (answer.trim() !== project) throw new Error("Confirmação não confere. Nada foi alterado.");

  const batch = db.batch();
  if (enableModule) batch.set(db.doc("settings/system"), { modules: { sports: true } }, { merge: true });
  if (!existingDep) batch.create(db.doc(`departments/${depSeed.id}`), { ...depSeed, id: undefined, createdAt: now });
  for (const seed of newRoles) batch.create(db.doc(`roles/${seed.id}`), { ...seed, id: undefined, departmentId: depId, createdAt: now, updatedAt: now });
  const updatedRoles = new Map<string, Role>();
  for (const [roleId, missing] of grants) {
    const role = roles.find((r) => r.id === roleId)!;
    const permissions = [...new Set([...(role.permissions ?? []), ...missing])].sort() as Permission[];
    updatedRoles.set(roleId, { ...role, permissions });
    batch.update(db.doc(`roles/${roleId}`), { permissions, updatedAt: now });
  }
  for (const m of affected) {
    const role = updatedRoles.get(String(m.get("roleId")))!;
    const member: Member = { id: m.id, name: m.get("name"), email: "", roleId: role.id, status: m.get("status"), joinedAt: m.get("joinedAt"), departmentIds: m.get("departmentIds") ?? [] };
    const accessSnap = await db.doc(`userAccess/${m.id}`).get();
    batch.set(db.doc(`userAccess/${m.id}`), computeAccess(member, role, Number(accessSnap.get("version") ?? 0), now));
  }
  batch.create(db.collection("auditLogs").doc(), {
    at: now,
    actorId: null,
    actorName: "Script de atualização",
    action: "organization.sportsUpdate",
    module: "organization",
    resourceType: "system",
    resourceId: null,
    outcome: "success",
    summary: `Área de Esportes preparada: ${newRoles.length} cargo(s) criado(s), ${grants.size} cargo(s) com permissões de Esportes`,
    expireAt: Timestamp.fromMillis(Date.now() + AUDIT_RETENTION_DAYS * 86_400_000),
  });
  await batch.commit();
  console.log("\nPronto. As permissões chegam sozinhas para quem está logado; quem está com a Central aberta desde antes da atualização do site só precisa recarregar a página.");
}

main().catch((e) => {
  console.error(`\nErro: ${(e as Error).message}`);
  process.exit(1);
});

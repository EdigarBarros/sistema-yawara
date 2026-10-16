/**
 * Utilitários dos testes das Cloud Functions (emuladores).
 * Nenhum dado aqui é real: integrantes e registros são criados só para o teste.
 */
import { randomUUID } from "node:crypto";
import { computeAccess } from "@/lib/access-tokens";
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_DOCUMENT_CATEGORIES,
  DEFAULT_FINANCE_CATEGORIES,
  DEFAULT_ROLES,
  defaultSystemSettings,
} from "@/data/structure/default-structure";
import type { Member, Role } from "@/types";
import { adminAuth, bucket, db } from "../src/core/admin";
import { executeAction, registerActionsForTests, type AnyAction } from "../src/core/dispatch";
import { AppError, normalizeError } from "../src/core/errors";

const PROJECT = "demo-yawara";

export async function resetEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${fsHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  try {
    const [files] = await bucket().getFiles();
    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
  } catch {
    // Storage emulador indisponível neste teste.
  }
}

const NOW = "2026-10-14T12:00:00.000Z";

/** Cria a estrutura institucional padrão (departamentos, cargos, categorias, configurações). */
export async function seedStructure() {
  const batch = db.batch();
  for (const d of DEFAULT_DEPARTMENTS) batch.set(db.doc(`departments/${d.id}`), { ...d, createdAt: NOW });
  for (const r of DEFAULT_ROLES) batch.set(db.doc(`roles/${r.id}`), { ...r, createdAt: NOW, updatedAt: NOW });
  for (const c of DEFAULT_DOCUMENT_CATEGORIES) batch.set(db.doc(`documentCategories/${c.id}`), c);
  for (const c of DEFAULT_FINANCE_CATEGORIES) batch.set(db.doc(`financeCategories/${c.id}`), c);
  batch.set(db.doc("settings/system"), defaultSystemSettings());
  await batch.commit();
}

export function role(id: string): Role {
  const r = DEFAULT_ROLES.find((x) => x.id === id);
  if (!r) throw new Error(`cargo ${id}`);
  return { ...r, createdAt: NOW, updatedAt: NOW };
}

/** Cria um integrante ativo (com conta no emulador de Auth) e o retrato de acesso. */
export async function createMember(uid: string, name: string, roleId: string, extra: Partial<Member> = {}) {
  const member: Member = { id: uid, name, email: `${uid}@example.org`, roleId, status: "active", joinedAt: NOW, departmentIds: [], ...extra };
  const roleSnap = await db.doc(`roles/${roleId}`).get();
  const r = { id: roleSnap.id, ...(roleSnap.data() as Omit<Role, "id">) };
  await adminAuth.createUser({ uid, email: member.email, password: "Senha-teste-123" }).catch(() => undefined);
  await db.doc(`members/${uid}`).set({ name, roleId, departmentIds: member.departmentIds, status: member.status, joinedAt: NOW, updatedAt: NOW });
  await db.doc(`memberPrivate/${uid}`).set({ email: member.email, createdAt: NOW });
  await db.doc(`userAccess/${uid}`).set(computeAccess(member, r, 0, NOW));
  return member;
}

/** Perfis usados nos testes (nomes fictícios). */
export async function seedPeople() {
  await createMember("pres", "Presidente Teste", "presidente");
  await createMember("vice", "Vice Teste", "vice-presidente");
  await createMember("sec", "Secretária Teste", "secretario");
  await createMember("fin", "Financeiro Teste", "diretor-financeiro");
  await createMember("mkt", "Marketing Teste", "diretor-marketing");
  await createMember("evt", "Eventos Teste", "diretor-eventos");
  await createMember("ext", "Extensão Teste", "diretor-extensao");
  await createMember("ass", "Assessor Teste", "assessor-eventos");
  await createMember("assmkt", "Assessora Marketing Teste", "assessor-marketing");
}

/** Chama uma ação como faria a função chamável (sem HTTP), com identidade simulada. */
export function caller<T extends Record<string, AnyAction>>(api: string, actions: T) {
  registerActionsForTests(api, actions);
  return async function call<R = unknown>(action: keyof T & string, uid: string | undefined, payload?: unknown, requestId: string = randomUUID()): Promise<R> {
    try {
      return (await executeAction(actions[action], uid, payload, requestId)) as R;
    } catch (error) {
      throw normalizeError(error);
    }
  };
}

/** Espera que a promessa falhe com o código informado. */
export async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  try {
    await promise;
  } catch (error) {
    const e = normalizeError(error);
    if (e.code !== code) throw new Error(`Esperava erro "${code}", recebeu "${e.code}": ${e.message}`);
    return e;
  }
  throw new Error(`Esperava erro "${code}", mas a operação foi concluída.`);
}

export async function auditFor(resourceId: string) {
  const snap = await db.collection("auditLogs").where("resourceId", "==", resourceId).get();
  return snap.docs.map((d) => d.data());
}

export { db, adminAuth, bucket };

/**
 * Ambiente dos testes de regras: emuladores do Firestore e do Storage com as
 * regras reais do repositório. Os dados são criados com as regras desativadas
 * (como faria o servidor) e lidos/gravados como usuários comuns.
 */
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { computeAccess } from "@/lib/access-tokens";
import { DEFAULT_ROLES } from "@/data/structure/default-structure";
import type { Member, Role } from "@/types";

export const PROJECT = "demo-yawara";
const NOW = "2026-10-14T12:00:00.000Z";

/** Endereço do emulador (definido pelo `firebase emulators:exec`), com as portas padrão como alternativa. */
function emulator(envVar: string, fallbackPort: number) {
  const [host, port] = (process.env[envVar] ?? "").split(":");
  return { host: host || "127.0.0.1", port: Number(port) || fallbackPort };
}

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync("firestore.rules", "utf8"), ...emulator("FIRESTORE_EMULATOR_HOST", 8080) },
    storage: { rules: readFileSync("storage.rules", "utf8"), ...emulator("FIREBASE_STORAGE_EMULATOR_HOST", 9199) },
  });
}

export function roleById(id: string): Role {
  const r = DEFAULT_ROLES.find((x) => x.id === id)!;
  return { ...r, createdAt: NOW, updatedAt: NOW };
}

export function access(uid: string, roleId: string, status: "active" | "inactive" = "active", extra: Partial<Member> = {}) {
  const member: Member = { id: uid, name: uid, email: "", roleId, status, joinedAt: NOW, ...extra };
  return computeAccess(member, roleById(roleId), 0, NOW);
}

/** Integrantes usados nos testes de regras. */
export const PEOPLE: Record<string, { roleId: string; status?: "active" | "inactive" }> = {
  pres: { roleId: "presidente" },
  fin: { roleId: "diretor-financeiro" },
  evt: { roleId: "diretor-eventos" },
  mkt: { roleId: "diretor-marketing" },
  ext: { roleId: "diretor-extensao" },
  sec: { roleId: "secretario" },
  ass: { roleId: "assessor-eventos" },
  assext: { roleId: "assessor-extensao" },
  off: { roleId: "diretor-eventos", status: "inactive" },
};

export async function seedAccess(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, p] of Object.entries(PEOPLE)) {
      await setDoc(doc(db, `userAccess/${uid}`), access(uid, p.roleId, p.status ?? "active"));
      await setDoc(doc(db, `members/${uid}`), { name: uid, roleId: p.roleId, status: p.status ?? "active", departmentIds: [], joinedAt: NOW });
      await setDoc(doc(db, `memberPrivate/${uid}`), { email: `${uid}@example.org` });
    }
  });
}

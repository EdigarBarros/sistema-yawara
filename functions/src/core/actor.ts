/**
 * Identidade e autorização de quem chama uma função.
 *
 * O UID vem do token verificado pelo Firebase (request.auth) — nunca do corpo
 * da requisição. Cargo, permissões e situação são lidos do Firestore DENTRO
 * da mesma transação da operação: se a permissão mudar no meio, a transação é
 * repetida com os dados novos. Assim, uma permissão revogada deixa de valer
 * imediatamente, sem depender de informações antigas guardadas no token.
 */
import type { Transaction } from "firebase-admin/firestore";
import type { AccessContext } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import { userTokens } from "@/lib/access-tokens";
import type { Member, ModuleKey, Permission, Role, SystemSettings } from "@/types";
import { db } from "./admin";
import { AppError, fail } from "./errors";

export interface Actor {
  uid: string;
  name: string;
  member: Member;
  role: Role;
  ctx: AccessContext;
  tokens: string[];
  can(permission: Permission): boolean;
}

export function memberFromDoc(id: string, data: FirebaseFirestore.DocumentData): Member {
  return {
    id,
    name: data.name,
    email: "",
    roleId: data.roleId,
    departmentIds: data.departmentIds ?? [],
    status: data.status,
    joinedAt: data.joinedAt,
    ...(typeof data.photo === "string" ? { photo: data.photo } : {}),
  };
}

export function roleFromDoc(id: string, data: FirebaseFirestore.DocumentData): Role {
  return {
    id,
    name: data.name,
    description: data.description ?? "",
    departmentId: data.departmentId,
    level: data.level,
    isBoard: !!data.isBoard,
    active: !!data.active,
    permissions: data.permissions ?? [],
    homePreset: data.homePreset,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function buildActor(member: Member, role: Role): Actor {
  const ctx: AccessContext = { user: member, role, department: undefined };
  return {
    uid: member.id,
    name: member.name,
    member,
    role,
    ctx,
    tokens: userTokens(member, role),
    can: (permission) => hasPermission(ctx, permission),
  };
}

/**
 * Carrega o integrante autenticado e o cargo dele, exigindo conta e cargo
 * ativos. Use sempre dentro da transação da operação.
 */
export async function loadActor(tx: Transaction, uid: string | undefined): Promise<Actor> {
  if (!uid) fail("unauthenticated", "Sua sessão expirou. Entre novamente.");
  const memberSnap = await tx.get(db.doc(`members/${uid}`));
  if (!memberSnap.exists) fail("forbidden", "Sua conta ainda não foi habilitada na Central. Procure a presidência.");
  const member = memberFromDoc(memberSnap.id, memberSnap.data()!);
  if (member.status !== "active") fail("forbidden", "Sua conta está desativada. Procure a presidência para reativá-la.");
  const roleSnap = await tx.get(db.doc(`roles/${member.roleId}`));
  if (!roleSnap.exists) fail("forbidden", "O seu cargo não foi encontrado. Procure a presidência.");
  const role = roleFromDoc(roleSnap.id, roleSnap.data()!);
  if (!role.active) fail("forbidden", "O seu cargo está desativado. Procure a presidência.");
  return buildActor(member, role);
}

export function requirePermission(actor: Actor, permission: Permission, message: string) {
  if (!actor.can(permission)) fail("forbidden", message);
}

/** Configurações do sistema (lidas na transação). */
export async function loadSettings(tx: Transaction): Promise<SystemSettings | null> {
  const snap = await tx.get(db.doc("settings/system"));
  return snap.exists ? (snap.data() as SystemSettings) : null;
}

/** Recusa operações em módulos desativados nas configurações. */
export async function requireModuleEnabled(tx: Transaction, module: ModuleKey) {
  const settings = await loadSettings(tx);
  if (settings && settings.modules?.[module] === false) {
    throw new AppError("unavailable", "Este módulo está desativado nas configurações.");
  }
}

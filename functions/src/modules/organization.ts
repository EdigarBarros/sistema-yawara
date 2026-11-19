/**
 * ORGANIZAÇÃO: integrantes, convites, cargos, departamentos e permissões.
 * ---------------------------------------------------------------------------
 * Proteções contra elevação de privilégios (todas verificadas no servidor):
 *  - Ninguém concede, retira ou atribui permissões que não possui
 *    (a mudança precisa estar contida nas permissões de quem a faz).
 *  - Permissões administrativas (PRIVILEGED_PERMISSIONS) e campos que mudam o
 *    alcance de acesso de um cargo (nível, diretoria, departamento, situação)
 *    exigem `organization.admin`.
 *  - Atribuir um cargo (convite, renovação, troca de cargo, reativação) cujo
 *    alcance (diretoria, nível, departamentos) quem atribui não tem também
 *    exige `organization.admin`.
 *  - Ninguém altera o próprio cargo, os próprios departamentos ou a própria
 *    situação; ninguém altera integrantes cujo cargo tem permissões que a
 *    pessoa não possui (ex.: vice alterando a presidência).
 *  - Sempre resta pelo menos um integrante ativo com `organization.admin`.
 *  - O cargo "Suporte do sistema" (src/lib/support.ts) fica acima da
 *    Presidência: só quem está nele altera esse cargo, os integrantes dele ou
 *    o atribui a alguém. Só o suporte troca nome, foto, e-mail de acesso e
 *    senha de qualquer integrante (supportUpdateAccount) e recupera o link de
 *    um convite pendente (invitationLink), para ajudar quem precisar.
 *  - Toda mudança recalcula o retrato de acesso (`userAccess`) dos afetados na
 *    mesma transação; contas desativadas são bloqueadas no Auth e têm as
 *    sessões revogadas.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { z } from "zod";
import { computeAccess, MAX_EXTRA_DEPARTMENTS, TOKEN, userTokens } from "@/lib/access-tokens";
import { allPermissions } from "@/lib/modules";
import { isPrivileged } from "@/lib/permissions";
import { isSupportRole, LOCK_SUPPORT } from "@/lib/support";
import type { Department, Invitation, Member, Permission, Role } from "@/types";
import { adminAuth, db, FieldValue, nowISO, Timestamp, timestampInDays } from "../core/admin";
import { memberFromDoc, requirePermission, requireSupport, roleFromDoc, type Actor } from "../core/actor";
import { auditDirect, auditInTx } from "../core/audit";
import { alreadyCompleted, mutation, query, type RunContext } from "../core/dispatch";
import { AppError, ensure, fail } from "../core/errors";
import { APP_BASE_URL, INVITE_TTL_DAYS, intParam, stringParam } from "../core/params";
import { requireDoc, toDTO } from "../core/records";

/* ------------------------------- esquemas ------------------------------- */

const ALL_PERMISSIONS = allPermissions() as [Permission, ...Permission[]];
const id = z.string().trim().min(1, "Identificador inválido.").max(128, "Identificador inválido.");
const description = z.string().trim().max(400, "A descrição pode ter no máximo 400 caracteres.").default("");
const name = (label: string) => z.string().trim().min(2, `${label} precisa ter pelo menos 2 caracteres.`).max(100, `${label} pode ter no máximo 100 caracteres.`);

const roleInput = z.object({
  name: name("O nome do cargo"),
  description,
  departmentId: id,
  level: z.enum(["presidency", "director", "advisor", "member"]),
  isBoard: z.boolean(),
  active: z.boolean(),
  homePreset: z.enum(["presidency", "secretary", "finance", "marketing", "events", "extension", "sports", "advisor"]),
  permissions: z.array(z.enum(ALL_PERMISSIONS)).max(200, "Permissões demais para um cargo."),
}).strict();

/** Foto de perfil: imagem pequena (o navegador reduz para 192 px) gravada como data URL. */
export const MAX_PHOTO_CHARS = 120_000;
const photoSchema = z
  .string()
  .max(MAX_PHOTO_CHARS, "A foto ficou grande demais. Tente outra imagem.")
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Formato de foto inválido. Use JPG, PNG ou WebP.");

const departmentInput = z.object({
  name: name("O nome do departamento"),
  shortName: z
    .string()
    .trim()
    .min(2, "A sigla precisa ter de 2 a 6 letras.")
    .max(6, "A sigla precisa ter de 2 a 6 letras.")
    .transform((s) => s.toUpperCase()),
  description,
  active: z.boolean(),
}).strict();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, "O e-mail pode ter no máximo 200 caracteres.")
  .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Informe um e-mail válido.");

const inviteInput = z.object({
  name: name("O nome"),
  email,
  roleId: id,
  departmentIds: z.array(id).max(MAX_EXTRA_DEPARTMENTS, `Escolha no máximo ${MAX_EXTRA_DEPARTMENTS} departamentos adicionais.`).default([]),
}).strict();

const PASSWORD_RULE = "A senha precisa ter de 8 a 128 caracteres, com pelo menos uma letra e um número.";
const password = z
  .string()
  .min(8, PASSWORD_RULE)
  .max(128, PASSWORD_RULE)
  .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /\d/.test(v), PASSWORD_RULE);

/** Correção de conta feita pelo suporte: só os campos enviados mudam; `photo: null` remove a foto. */
const supportAccountUpdate = z.object({
  id,
  input: z
    .object({
      name: name("O nome").optional(),
      email: email.optional(),
      password: password.optional(),
      photo: photoSchema.nullable().optional(),
    })
    .strict(),
});

const memberUpdate = z.object({
  id,
  input: z
    .object({
      name: name("O nome").optional(),
      email: email.optional(),
      roleId: id.optional(),
      departmentIds: z.array(id).max(MAX_EXTRA_DEPARTMENTS, `Escolha no máximo ${MAX_EXTRA_DEPARTMENTS} departamentos adicionais.`).optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })
    .strict(),
});

/* ------------------------------- auxiliares ------------------------------ */

interface OrgState {
  members: Member[];
  roles: Map<string, Role>;
  departments: Map<string, Department>;
}

/** Lê toda a estrutura (dezenas de documentos) dentro da transação. */
async function loadOrg(tx: Transaction): Promise<OrgState> {
  const [members, roles, departments] = await Promise.all([
    tx.get(db.collection("members")),
    tx.get(db.collection("roles")),
    tx.get(db.collection("departments")),
  ]);
  return {
    members: members.docs.map((d) => memberFromDoc(d.id, d.data())),
    roles: new Map(roles.docs.map((d) => [d.id, roleFromDoc(d.id, d.data())])),
    departments: new Map(departments.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<Department, "id">) }])),
  };
}

export function adminCount(members: Member[], roles: Map<string, Role>) {
  return members.filter((m) => {
    const role = roles.get(m.roleId);
    return m.status === "active" && role?.active && role.permissions.includes("organization.admin");
  }).length;
}

export function assertAdminsRemain(members: Member[], roles: Map<string, Role>) {
  if (adminCount(members, roles) === 0) {
    fail("conflict", "Esta alteração deixaria a Central sem nenhum integrante ativo com permissão de administrar cargos e permissões. Defina outro administrador antes.");
  }
}

/** A mudança de permissões precisa estar contida nas permissões de quem a faz. */
function assertWithinOwn(actor: Actor, permissions: Iterable<Permission>, message: string) {
  const missing = [...permissions].filter((p) => !actor.can(p));
  if (missing.length > 0) fail("forbidden", message, { missing });
}

/**
 * Alcance que um cargo dá (mais os departamentos adicionais): os marcadores de
 * público (diretoria, nível, departamentos), sem os da conta e do cargo. O
 * cargo é avaliado como ativo: o alcance vale assim que ele for reativado.
 */
function reachTokens(role: Role, departmentIds: string[] = []) {
  const own = new Set([TOKEN.user("_"), TOKEN.role(role.id)]);
  return userTokens({ id: "_", status: "active", departmentIds }, { ...role, active: true }).filter((t) => !own.has(t));
}

/** Ordem dos níveis: um cargo não dá a quem o recebe um nível acima do de quem o atribui. */
const LEVEL_RANK: Record<Role["level"], number> = { member: 0, advisor: 1, director: 2, presidency: 3 };

/**
 * O nível do cargo dá algo que o nível `own` não dá. Além dos marcadores
 * (reachTokens), as políticas usam o nível: a presidência vê o financeiro de
 * todos os eventos (canSeeEventFinance) e a assessoria é o único nível em que
 * `events.edit` não edita os dados do evento (canEditEvent).
 * Espelhado em src/features/organization/org-rules.ts (levelBeyond).
 */
function levelBeyond(role: Role, own: Role) {
  if (LEVEL_RANK[role.level] > LEVEL_RANK[own.level]) return true;
  return own.level === "advisor" && role.level !== "advisor" && role.permissions.includes("events.edit");
}

/**
 * O cargo (com os departamentos adicionais) dá alcance que o de quem atribui
 * não tem: marcadores de público, nível ou departamento principal (as
 * políticas usam o departamento do cargo — ex.: editar documentos e ver o
 * financeiro dos eventos —, não os departamentos adicionais).
 */
function beyondOwnReach(actor: Actor, role: Role, departmentIds: string[]) {
  if (role.departmentId !== actor.role.departmentId || levelBeyond(role, actor.role)) return true;
  return reachTokens(role, departmentIds).some((t) => !actor.tokens.includes(t));
}

/**
 * O cargo de destino não pode ter permissões que quem atribui não possui, e
 * só quem administra permissões atribui cargos com permissões administrativas
 * ou com alcance (diretoria, nível, departamentos) que o próprio cargo não tem.
 * `departmentIds`: departamentos adicionais concedidos junto com o cargo.
 */
function assertCanAssignRole(actor: Actor, role: Role, departmentIds: string[] = []) {
  if (isSupportRole(role.id) && !isSupportRole(actor.role.id)) fail("forbidden", LOCK_SUPPORT);
  assertWithinOwn(actor, role.permissions, "Você não pode atribuir um cargo com permissões que o seu próprio cargo não tem.");
  if (role.permissions.some(isPrivileged)) {
    requirePermission(actor, "organization.admin", "Somente quem administra permissões pode atribuir cargos com permissões administrativas.");
  }
  if (beyondOwnReach(actor, role, departmentIds)) {
    requirePermission(
      actor,
      "organization.admin",
      "Somente quem administra permissões pode atribuir um cargo de diretoria, de nível com mais acesso que o seu ou de outro departamento.",
    );
  }
}

/** Ninguém altera integrantes com mais poderes do que si (protege a presidência). */
function assertCanManageMember(actor: Actor, target: Member, roles: Map<string, Role>) {
  const role = roles.get(target.roleId);
  if (isSupportRole(target.roleId) && !isSupportRole(actor.role.id)) fail("forbidden", LOCK_SUPPORT);
  if (role) assertWithinOwn(actor, role.permissions, "Você não pode alterar um integrante cujo cargo tem permissões que o seu não tem.");
}

function writeAccess(tx: Transaction, member: Member, role: Role | undefined, now: string) {
  const access = computeAccess(member, role, 0, now);
  // merge: o contador de versão incrementa sobre o valor atual (todos os demais campos são regravados).
  tx.set(db.doc(`userAccess/${member.id}`), { ...access, version: FieldValue.increment(1) }, { merge: true });
}

function validateDepartments(ids: string[], state: OrgState) {
  for (const depId of ids) {
    const dep = state.departments.get(depId);
    if (!dep || !dep.active) fail("invalid", "Um dos departamentos escolhidos não existe ou está desativado.");
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Token dos convites pendentes, guardado à parte (`invitationLinks/{id}`,
 * fechado pelas regras: só o servidor lê) para que o suporte recupere o link.
 * Some quando o convite é aceito, revogado ou substituído.
 */
function linkRef(invitationId: string) {
  return db.doc(`invitationLinks/${invitationId}`);
}

function inviteLink(token: string) {
  const base = stringParam(APP_BASE_URL, "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/convite?token=${encodeURIComponent(token)}`;
}

/**
 * Reserva de aceite: enquanto a conta é criada, o convite fica "accepting"
 * (estado interno). Uma reserva abandonada (processo interrompido) perde a
 * validade depois deste prazo e o convite volta a valer como pendente.
 */
const CLAIM_TTL_MS = 10 * 60 * 1000;

/** Máximo de convites antigos do mesmo e-mail limpos no aceite (uma pessoa raramente tem mais de um ou dois). */
const SUPERSEDE_LIMIT = 200;

function hasActiveClaim(data: FirebaseFirestore.DocumentData) {
  return data.status === "accepting" && Date.now() - Date.parse(data.claimedAt ?? "") < CLAIM_TTL_MS;
}

/** Situação para as regras e para a tela: a reserva de aceite é transitória e aparece como "pendente". */
function openStatus(data: FirebaseFirestore.DocumentData): string {
  return data.status === "accepting" ? "pending" : data.status;
}

const CLEAR_CLAIM = { claimId: FieldValue.delete(), claimedAt: FieldValue.delete() };

const OPEN_STATUSES = ["pending", "accepting"] as const;

/**
 * Convites ainda abertos (pendentes, inclusive expirados, ou em aceite) para o
 * e-mail, lidos na transação. Ler todos eles faz com que duas transações que
 * mexem em convites diferentes do mesmo e-mail entrem em conflito (uma é
 * repetida e vê o que a outra gravou).
 */
async function openInvitationsFor(tx: Transaction, email: string) {
  const snaps = await Promise.all(OPEN_STATUSES.map((status) => tx.get(db.collection("invitations").where("email", "==", email).where("status", "==", status))));
  return snaps.flatMap((s) => s.docs);
}

/** Convite que ainda pode ser aceito (ou está sendo): pendente e válido, ou com reserva de aceite ativa. */
function blocksNewInvitation(data: FirebaseFirestore.DocumentData) {
  return hasActiveClaim(data) || (data.expiresAt as Timestamp).toMillis() > Date.now();
}

function invitationDTO(id: string, data: FirebaseFirestore.DocumentData): Invitation {
  const status = openStatus(data);
  const expired = status === "pending" && (data.expiresAt as Timestamp).toMillis() < Date.now();
  return {
    id,
    name: data.name,
    // Convites aceitos não guardam o e-mail (a fonte é memberPrivate).
    email: data.email ?? "",
    roleId: data.roleId,
    departmentIds: data.departmentIds ?? [],
    status: (expired ? "expired" : status) as Invitation["status"],
    expiresAt: (data.expiresAt as Timestamp).toDate().toISOString(),
    createdBy: data.createdBy,
    createdAt: data.createdAt,
    acceptedAt: data.acceptedAt,
    acceptedUserId: data.acceptedUserId,
    revokedAt: data.revokedAt,
    revokedBy: data.revokedBy,
  };
}

/** Repassa dados que só existem nesta chamada (ex.: link do convite) — nunca são guardados. */
const ephemeral = new Map<string, Record<string, unknown>>();

/**
 * Resposta das ações de convite. Também é montada no reenvio da mesma
 * requisição: confere de novo se quem chama ainda pode ver convites.
 */
async function presentInvitation(result: { id: string; requestId?: string }, actor: Actor | null) {
  const extra = result.requestId ? ephemeral.get(result.requestId) : undefined;
  if (result.requestId) ephemeral.delete(result.requestId);
  if (!actor || (!actor.can("organization.create") && !actor.can("organization.edit"))) fail("forbidden", "Seu perfil não pode ver convites.");
  const snap = await db.doc(`invitations/${result.id}`).get();
  return { invitation: invitationDTO(snap.id, snap.data()!), link: (extra?.link as string | undefined) ?? null };
}

function audit(tx: Transaction, actor: Actor, ctx: RunContext, action: string, resourceType: string, resourceId: string, summary: string, details?: Record<string, string | number | boolean | null>) {
  auditInTx(tx, { uid: actor.uid, name: actor.name }, { action: `organization.${action}`, module: "organization", resourceType, resourceId, summary, details }, ctx.requestId, ctx.now);
}

/* -------------------------------- ações --------------------------------- */

export const organizationActions = {
  createDepartment: mutation({
    module: "organization",
    schema: departmentInput,
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.create", "Seu perfil não pode criar departamentos.");
      const state = await loadOrg(tx);
      if ([...state.departments.values()].some((d) => d.name.trim().toLowerCase() === input.name.toLowerCase())) {
        fail("conflict", "Já existe um departamento com esse nome.");
      }
      const ref = db.collection("departments").doc();
      tx.create(ref, { ...input, createdAt: ctx.now, createdBy: actor.uid, updatedAt: ctx.now });
      audit(tx, actor, ctx, "createDepartment", "department", ref.id, `Departamento criado: ${input.name}`);
      return { id: ref.id };
    },
    async present(result) {
      return toDTO<Department>(await db.doc(`departments/${result.id}`).get());
    },
  }),

  updateDepartment: mutation({
    module: "organization",
    schema: z.object({ id, input: departmentInput.partial() }),
    async run(tx, actor, { id: depId, input }, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.edit", "Seu perfil não pode editar departamentos.");
      const state = await loadOrg(tx);
      const current = state.departments.get(depId);
      ensure(current, "not_found", "Departamento não encontrado.");
      if (input.name && [...state.departments.values()].some((d) => d.id !== depId && d.name.trim().toLowerCase() === input.name!.toLowerCase())) {
        fail("conflict", "Já existe um departamento com esse nome.");
      }
      if (input.active === false && current.active) {
        // Desativar um departamento muda o acesso de quem pertence a ele.
        requirePermission(actor, "organization.admin", "Somente quem administra permissões pode desativar departamentos.");
        if ([...state.roles.values()].some((r) => r.active && r.departmentId === depId)) {
          fail("conflict", "Há cargos ativos neste departamento. Mova ou desative os cargos antes.");
        }
      }
      tx.update(db.doc(`departments/${depId}`), { ...input, updatedAt: ctx.now, updatedBy: actor.uid });
      audit(tx, actor, ctx, "updateDepartment", "department", depId, `Departamento editado: ${input.name ?? current.name}`);
      return { id: depId };
    },
    async present(result) {
      return toDTO<Department>(await db.doc(`departments/${result.id}`).get());
    },
  }),

  createRole: mutation({
    module: "organization",
    schema: roleInput,
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.create", "Seu perfil não pode criar cargos.");
      if (input.permissions.length > 0 || input.isBoard || input.level === "presidency" || input.level === "director") {
        requirePermission(actor, "organization.admin", "Somente quem administra permissões pode criar cargos com permissões, de diretoria ou de presidência.");
      }
      assertWithinOwn(actor, input.permissions, "Você não pode conceder permissões que o seu próprio cargo não tem.");
      const state = await loadOrg(tx);
      if ([...state.roles.values()].some((r) => r.name.trim().toLowerCase() === input.name.toLowerCase())) fail("conflict", "Já existe um cargo com esse nome.");
      validateDepartments([input.departmentId], state);
      const ref = db.collection("roles").doc();
      const permissions = [...new Set(input.permissions)].sort();
      tx.create(ref, { ...input, permissions, createdAt: ctx.now, updatedAt: ctx.now, createdBy: actor.uid, updatedBy: actor.uid });
      audit(tx, actor, ctx, "createRole", "role", ref.id, `Cargo criado: ${input.name} (${permissions.length} permissões)`, { permissions: permissions.join(",") });
      return { id: ref.id };
    },
    async present(result) {
      return toDTO<Role>(await db.doc(`roles/${result.id}`).get());
    },
  }),

  updateRole: mutation({
    module: "organization",
    schema: z.object({ id, input: roleInput.partial() }),
    async run(tx, actor, { id: roleId, input }, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.edit", "Seu perfil não pode editar cargos.");
      const state = await loadOrg(tx);
      const current = state.roles.get(roleId);
      ensure(current, "not_found", "Cargo não encontrado.");
      if (isSupportRole(roleId) && !isSupportRole(actor.role.id)) fail("forbidden", LOCK_SUPPORT);

      const next: Role = { ...current, ...input, permissions: input.permissions ? ([...new Set(input.permissions)].sort() as Permission[]) : current.permissions };
      const added = next.permissions.filter((p) => !current.permissions.includes(p));
      const removed = current.permissions.filter((p) => !next.permissions.includes(p));
      const accessChanged =
        added.length > 0 ||
        removed.length > 0 ||
        next.level !== current.level ||
        next.isBoard !== current.isBoard ||
        next.departmentId !== current.departmentId ||
        next.active !== current.active;

      if (accessChanged) {
        requirePermission(actor, "organization.admin", "Somente quem administra permissões pode alterar permissões, nível, departamento ou situação de um cargo.");
        assertWithinOwn(actor, [...added, ...removed], "Você não pode conceder nem retirar permissões que o seu próprio cargo não tem.");
        assertWithinOwn(actor, current.permissions, "Você não pode alterar um cargo que tem permissões que o seu não tem.");
      }
      if (roleId === actor.role.id) {
        if (next.active === false) fail("invalid", "Você não pode desativar o seu próprio cargo.");
        if (removed.includes("organization.admin")) fail("invalid", "Você não pode retirar do seu próprio cargo a permissão de administrar permissões.");
      }
      if (input.name && [...state.roles.values()].some((r) => r.id !== roleId && r.name.trim().toLowerCase() === input.name!.toLowerCase())) {
        fail("conflict", "Já existe um cargo com esse nome.");
      }
      if (input.departmentId) validateDepartments([input.departmentId], state);

      const roles = new Map(state.roles);
      roles.set(roleId, next);
      assertAdminsRemain(state.members, roles);

      tx.update(db.doc(`roles/${roleId}`), { ...input, permissions: next.permissions, updatedAt: ctx.now, updatedBy: actor.uid });
      if (accessChanged) for (const m of state.members.filter((m) => m.roleId === roleId)) writeAccess(tx, m, next, ctx.now);
      audit(
        tx,
        actor,
        ctx,
        "updateRole",
        "role",
        roleId,
        accessChanged ? `Cargo ${next.name}: acesso alterado` : `Cargo ${next.name} editado`,
        accessChanged ? { added: added.join(","), removed: removed.join(","), active: next.active, isBoard: next.isBoard, level: next.level } : undefined,
      );
      return { id: roleId };
    },
    async present(result) {
      return toDTO<Role>(await db.doc(`roles/${result.id}`).get());
    },
  }),

  inviteMember: mutation({
    module: "organization",
    schema: inviteInput,
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.create", "Seu perfil não pode convidar integrantes.");
      const state = await loadOrg(tx);
      const role = state.roles.get(input.roleId);
      ensure(role && role.active, "invalid", "Escolha um cargo ativo.");
      assertCanAssignRole(actor, role, input.departmentIds);
      if (input.departmentIds.length > 0) {
        // Departamentos adicionais ampliam o acesso: mesma exigência de updateMember.
        requirePermission(actor, "organization.admin", "Somente quem administra permissões pode definir departamentos adicionais.");
      }
      validateDepartments(input.departmentIds, state);
      const [existing, open] = await Promise.all([
        tx.get(db.collection("memberPrivate").where("email", "==", input.email).limit(1)),
        openInvitationsFor(tx, input.email),
      ]);
      if (!existing.empty) fail("conflict", "Já existe um integrante com esse e-mail.");
      if (open.some((d) => blocksNewInvitation(d.data()))) {
        fail("conflict", "Já existe um convite pendente para esse e-mail. Renove ou revogue o convite existente.");
      }
      const token = randomBytes(32).toString("base64url");
      const ref = db.collection("invitations").doc();
      tx.create(ref, {
        name: input.name,
        email: input.email,
        roleId: input.roleId,
        departmentIds: [...new Set(input.departmentIds.filter((d) => d !== role.departmentId))],
        tokenHash: hashToken(token),
        status: "pending",
        expiresAt: timestampInDays(intParam(INVITE_TTL_DAYS, 7)),
        createdBy: actor.uid,
        createdAt: ctx.now,
      });
      tx.set(linkRef(ref.id), { token, createdAt: ctx.now });
      audit(tx, actor, ctx, "inviteMember", "invitation", ref.id, `Convite criado para ${input.name} (cargo ${role.name})`);
      ephemeral.set(ctx.requestId, { link: inviteLink(token) });
      return { id: ref.id, requestId: ctx.requestId };
    },
    async present(result, actor) {
      return presentInvitation(result, actor);
    },
  }),

  renewInvitation: mutation({
    module: "organization",
    schema: z.object({ id }),
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.create", "Seu perfil não pode renovar convites.");
      const snap = requireDoc(await tx.get(db.doc(`invitations/${input.id}`)), "Convite");
      const data = snap.data()!;
      if (hasActiveClaim(data)) fail("conflict", "Este convite está sendo aceito neste momento. Aguarde alguns instantes e atualize a lista.");
      if (openStatus(data) !== "pending") fail("conflict", "Somente convites pendentes podem ser renovados.");
      const [state, existing, open] = await Promise.all([
        loadOrg(tx),
        tx.get(db.collection("memberPrivate").where("email", "==", data.email).limit(1)),
        openInvitationsFor(tx, data.email),
      ]);
      const role = state.roles.get(data.roleId);
      ensure(role && role.active, "conflict", "O cargo deste convite está desativado. Revogue e crie um novo convite.");
      assertCanAssignRole(actor, role, data.departmentIds ?? []);
      // Nunca há dois convites aceitáveis para o mesmo e-mail (mesma regra da criação).
      if (!existing.empty) fail("conflict", "Já existe um integrante com esse e-mail. Revogue este convite.");
      if (open.some((d) => d.id !== snap.id && blocksNewInvitation(d.data()))) {
        fail("conflict", "Já existe outro convite pendente para esse e-mail. Use aquele convite ou revogue-o antes.");
      }
      const token = randomBytes(32).toString("base64url");
      // Uma reserva de aceite abandonada é descartada junto com o link anterior.
      tx.update(snap.ref, {
        tokenHash: hashToken(token),
        status: "pending",
        ...CLEAR_CLAIM,
        expiresAt: timestampInDays(intParam(INVITE_TTL_DAYS, 7)),
        renewedAt: ctx.now,
        renewedBy: actor.uid,
      });
      tx.set(linkRef(snap.id), { token, createdAt: ctx.now });
      audit(tx, actor, ctx, "renewInvitation", "invitation", snap.id, "Convite renovado (link anterior invalidado)");
      ephemeral.set(ctx.requestId, { link: inviteLink(token) });
      return { id: snap.id, requestId: ctx.requestId };
    },
    async present(result, actor) {
      return presentInvitation(result, actor);
    },
  }),

  revokeInvitation: mutation({
    module: "organization",
    schema: z.object({ id }),
    async run(tx, actor, input, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.create", "Seu perfil não pode revogar convites.");
      const snap = requireDoc(await tx.get(db.doc(`invitations/${input.id}`)), "Convite");
      // Também revoga durante uma reserva de aceite: o aceite em andamento é recusado e desfeito.
      if (openStatus(snap.data()!) !== "pending") fail("conflict", "Este convite não está mais pendente.");
      // O hash continua gravado: o link antigo passa a mostrar "convite cancelado" (a situação impede o uso).
      tx.update(snap.ref, { status: "revoked", revokedAt: ctx.now, revokedBy: actor.uid, ...CLEAR_CLAIM });
      tx.delete(linkRef(snap.id));
      audit(tx, actor, ctx, "revokeInvitation", "invitation", snap.id, "Convite revogado");
      return { id: snap.id };
    },
    async present(result, actor) {
      return (await presentInvitation(result, actor)).invitation;
    },
  }),

  updateMember: mutation({
    module: "organization",
    schema: memberUpdate,
    async run(tx, actor, { id: memberId, input }, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.edit", "Seu perfil não pode editar integrantes.");
      const state = await loadOrg(tx);
      const privateSnap = await tx.get(db.doc(`memberPrivate/${memberId}`));
      const current = state.members.find((m) => m.id === memberId);
      ensure(current, "not_found", "Integrante não encontrado.");
      assertCanManageMember(actor, current, state.roles);

      const self = memberId === actor.uid;
      if (self && input.status === "inactive") fail("invalid", "Você não pode desativar a sua própria conta.");
      if (self && input.roleId && input.roleId !== current.roleId) fail("invalid", "Você não pode alterar o seu próprio cargo. Peça a outra pessoa da presidência.");
      if (self && input.departmentIds) fail("invalid", "Você não pode alterar os seus próprios departamentos.");
      if (input.email && input.email !== privateSnap.data()?.email) {
        fail("invalid", "A troca do e-mail de acesso não é feita por aqui. Desative a conta e envie um convite para o novo e-mail.");
      }

      const next: Member = { ...current, ...input, email: "", departmentIds: input.departmentIds ?? current.departmentIds };
      const role = state.roles.get(next.roleId);
      ensure(role, "invalid", "Cargo não encontrado.");
      if (input.roleId && input.roleId !== current.roleId) {
        ensure(role.active, "invalid", "Escolha um cargo ativo.");
        assertCanAssignRole(actor, role);
      }
      if (input.departmentIds) {
        requirePermission(actor, "organization.admin", "Somente quem administra permissões pode alterar departamentos adicionais.");
        validateDepartments(input.departmentIds, state);
        next.departmentIds = [...new Set(input.departmentIds.filter((d) => d !== role.departmentId))];
      }
      const statusChanged = input.status !== undefined && input.status !== current.status;
      if (statusChanged && input.status === "active") {
        // Reativar devolve o acesso do cargo e dos departamentos adicionais: exige poder atribuí-los.
        assertCanAssignRole(actor, role, next.departmentIds ?? []);
      }

      const members = state.members.map((m) => (m.id === memberId ? next : m));
      assertAdminsRemain(members, state.roles);

      tx.update(db.doc(`members/${memberId}`), {
        name: next.name,
        roleId: next.roleId,
        departmentIds: next.departmentIds ?? [],
        status: next.status,
        updatedAt: ctx.now,
        updatedBy: actor.uid,
      });
      if (statusChanged) {
        tx.set(
          db.doc(`memberPrivate/${memberId}`),
          next.status === "inactive" ? { disabledAt: ctx.now, disabledBy: actor.uid } : { reactivatedAt: ctx.now, reactivatedBy: actor.uid },
          { merge: true },
        );
      }
      writeAccess(tx, next, role, ctx.now);

      const changes = [
        input.name && input.name !== current.name ? "nome" : null,
        input.roleId && input.roleId !== current.roleId ? `cargo → ${role.name}` : null,
        input.departmentIds ? "departamentos adicionais" : null,
        statusChanged ? (next.status === "inactive" ? "conta desativada" : "conta reativada") : null,
      ].filter(Boolean);
      audit(tx, actor, ctx, "updateMember", "member", memberId, `Integrante ${next.name}: ${changes.join(", ") || "sem alterações"}`, {
        roleId: next.roleId,
        status: next.status,
      });

      if (statusChanged) {
        ctx.after(async () => {
          await adminAuth.updateUser(memberId, { disabled: next.status === "inactive" });
          if (next.status === "inactive") await adminAuth.revokeRefreshTokens(memberId);
        });
      } else if (input.roleId && input.roleId !== current.roleId) {
        // Mudança de cargo: força a renovação das sessões abertas.
        ctx.after(async () => {
          await adminAuth.revokeRefreshTokens(memberId);
        });
      }
      return { id: memberId };
    },
    async present(result, actor) {
      return presentMember(result.id, actor!);
    },
  }),

  /** Foto de perfil da própria conta (qualquer integrante ativo). `null` remove a foto. */
  updateMyPhoto: mutation({
    module: "organization",
    schema: z.object({ photo: photoSchema.nullable() }).strict(),
    async run(tx, actor, { photo }, ctx) {
      actor = actor!;
      const ref = db.doc(`members/${actor.uid}`);
      ensure((await tx.get(ref)).exists, "not_found", "Cadastro não encontrado.");
      tx.update(ref, { photo: photo ?? FieldValue.delete(), updatedAt: ctx.now });
      audit(tx, actor, ctx, "updateMyPhoto", "member", actor.uid, photo ? "Foto de perfil atualizada" : "Foto de perfil removida");
      return { id: actor.uid };
    },
    async present(result, actor) {
      return presentMember(result.id, actor!);
    },
  }),

  /**
   * Exclui o perfil de um integrante: conta de acesso (Auth) e cadastro
   * (members, memberPrivate, userAccess). O que a pessoa registrou continua,
   * com o autor exibido como "Integrante removido". Exige `organization.admin`
   * (presidência e vice) e as mesmas proteções da edição de integrantes.
   */
  deleteMember: mutation({
    module: "organization",
    schema: z.object({ id }).strict(),
    async run(tx, actor, { id: memberId }, ctx) {
      actor = actor!;
      requirePermission(actor, "organization.admin", "Somente a presidência pode excluir perfis.");
      if (memberId === actor.uid) fail("invalid", "Você não pode excluir o seu próprio perfil.");
      const state = await loadOrg(tx);
      const current = state.members.find((m) => m.id === memberId);
      ensure(current, "not_found", "Integrante não encontrado.");
      assertCanManageMember(actor, current, state.roles);
      assertAdminsRemain(
        state.members.filter((m) => m.id !== memberId),
        state.roles,
      );
      for (const col of ["members", "memberPrivate", "userAccess"]) tx.delete(db.doc(`${col}/${memberId}`));
      audit(tx, actor, ctx, "deleteMember", "member", memberId, `Perfil excluído: ${current.name}`, { roleId: current.roleId });
      ctx.after(async () => {
        await adminAuth.deleteUser(memberId).catch((error: { code?: string }) => {
          if (error?.code !== "auth/user-not-found") throw error;
        });
      });
      return { id: memberId };
    },
  }),

  /**
   * SUPORTE: corrige a conta de qualquer integrante — nome, foto, e-mail de
   * acesso e senha. E-mail e senha mudam primeiro no Authentication (etapa
   * `prepare`; se a transação falhar, o e-mail volta ao anterior) e depois no
   * cadastro. A senha nunca é gravada nem registrada; a auditoria só diz
   * quais campos mudaram. Com e-mail ou senha novos, as sessões abertas da
   * pessoa são encerradas (exceto quando o suporte altera a própria conta).
   */
  supportUpdateAccount: mutation({
    module: "organization",
    schema: supportAccountUpdate,
    async prepare(actor, { id: memberId, input }, ctx) {
      // Reenvio da mesma requisição: o Authentication já foi alterado.
      if (await alreadyCompleted(actor.uid, ctx.requestId)) return;
      requireSupport(actor);
      if (input.email === undefined && input.password === undefined && input.name === undefined) return;
      const user = await adminAuth.getUser(memberId).catch(() => null);
      ensure(user, "not_found", "Conta de acesso não encontrada.");
      const emailChanged = input.email !== undefined && input.email !== user.email?.toLowerCase();
      if (emailChanged) {
        const taken = await db.collection("memberPrivate").where("email", "==", input.email).limit(1).get();
        if (taken.docs.some((d) => d.id !== memberId)) fail("conflict", "Já existe um integrante com esse e-mail.");
      }
      try {
        await adminAuth.updateUser(memberId, {
          ...(emailChanged ? { email: input.email, emailVerified: false } : {}),
          ...(input.password !== undefined ? { password: input.password } : {}),
          ...(input.name !== undefined ? { displayName: input.name } : {}),
        });
      } catch (error) {
        if ((error as { code?: string }).code === "auth/email-already-exists") fail("conflict", "Esse e-mail já é usado por outra conta de acesso.");
        throw error;
      }
      if (emailChanged && user.email) {
        const previous = user.email;
        ctx.onAbort(async () => {
          await adminAuth.updateUser(memberId, { email: previous });
        });
      }
    },
    async run(tx, actor, { id: memberId, input }, ctx) {
      actor = actor!;
      requireSupport(actor);
      const ref = db.doc(`members/${memberId}`);
      const snap = await tx.get(ref);
      ensure(snap.exists, "not_found", "Integrante não encontrado.");
      const privateSnap = await tx.get(db.doc(`memberPrivate/${memberId}`));
      const current = memberFromDoc(snap.id, snap.data()!);
      const emailChanged = input.email !== undefined && input.email !== privateSnap.data()?.email;

      const update: Record<string, unknown> = { updatedAt: ctx.now, updatedBy: actor.uid };
      if (input.name !== undefined) update.name = input.name;
      if (input.photo !== undefined) update.photo = input.photo ?? FieldValue.delete();
      tx.update(ref, update);
      if (emailChanged) tx.set(db.doc(`memberPrivate/${memberId}`), { email: input.email, emailChangedAt: ctx.now, emailChangedBy: actor.uid }, { merge: true });

      const changes = [
        input.name !== undefined && input.name !== current.name ? "nome" : null,
        input.photo !== undefined ? (input.photo ? "foto" : "foto removida") : null,
        emailChanged ? "e-mail de acesso" : null,
        input.password !== undefined ? "senha" : null,
      ].filter(Boolean);
      audit(tx, actor, ctx, "supportUpdateAccount", "member", memberId, `Suporte: conta de ${input.name ?? current.name} — ${changes.join(", ") || "sem alterações"}`);

      if ((emailChanged || input.password !== undefined) && memberId !== actor.uid) {
        ctx.after(async () => {
          await adminAuth.revokeRefreshTokens(memberId);
        });
      }
      return { id: memberId };
    },
    async present(result, actor) {
      return presentMember(result.id, actor!);
    },
  }),

  /** SUPORTE: link de um convite pendente, para reenviar a quem perdeu a mensagem. */
  invitationLink: query({
    module: "organization",
    schema: z.object({ id }).strict(),
    async run(actor, { id: invitationId }) {
      actor = actor!;
      requireSupport(actor, "Somente o Suporte do sistema pode ver links de convites já enviados.");
      const [inv, link] = await Promise.all([db.doc(`invitations/${invitationId}`).get(), linkRef(invitationId).get()]);
      ensure(inv.exists, "not_found", "Convite não encontrado.");
      const status = invitationDTO(inv.id, inv.data()!).status;
      if (status !== "pending") fail("conflict", "Só convites pendentes têm link válido. Para um convite expirado, use Renovar.");
      const token = link.data()?.token as string | undefined;
      if (!token) fail("not_found", "Este convite foi criado antes de os links serem guardados. Use Renovar para gerar um link novo.");
      await auditDirect({ uid: actor.uid, name: actor.name }, { action: "organization.invitationLink", module: "organization", resourceType: "invitation", resourceId: invitationId, summary: "Suporte consultou o link de um convite" });
      return { link: inviteLink(token) };
    },
  }),

  /** Cadastro direto existe apenas no modo demonstração; com o Firebase, use convites. */
  createMember: mutation({
    module: "organization",
    schema: z.unknown(),
    async run() {
      throw new AppError("unavailable", "Para adicionar integrantes, envie um convite.");
    },
  }),
};

async function presentMember(memberId: string, actor: Actor) {
  const snap = await db.doc(`members/${memberId}`).get();
  const member = { ...memberFromDoc(snap.id, snap.data()!) };
  if (actor.can("organization.edit") || actor.uid === memberId) {
    const priv = await db.doc(`memberPrivate/${memberId}`).get();
    member.email = priv.data()?.email ?? "";
  }
  return member;
}

/* --------------------------- convites (público) ------------------------- */

const INVALID_INVITE = "Convite inválido. Peça um novo link a quem convidou você.";
const tokenSchema = z.string({ error: INVALID_INVITE }).trim().min(20, INVALID_INVITE).max(200, INVALID_INVITE);

/**
 * Confere se o convite pode ser usado. Nos estados finais (usado, cancelado,
 * expirado) só a mensagem é devolvida — nunca nome, e-mail ou cargo. O hash
 * continua gravado nos convites usados/revogados justamente para que o link
 * antigo receba a mensagem certa; a renovação troca o hash (link anterior =
 * "convite inválido").
 */
function assertUsable(doc: FirebaseFirestore.QueryDocumentSnapshot | undefined): FirebaseFirestore.DocumentData {
  if (!doc) fail("not_found", INVALID_INVITE);
  const data = doc.data();
  if (data.status === "accepted") fail("conflict", "Este convite já foi usado. Entre com o seu e-mail e senha.");
  if (openStatus(data) !== "pending") fail("conflict", "Este convite foi cancelado. Peça um novo link.");
  if ((data.expiresAt as Timestamp).toMillis() < Date.now()) fail("conflict", "Este convite expirou. Peça um novo link a quem convidou você.");
  return data;
}

function invitationsByToken(token: string) {
  return db.collection("invitations").where("tokenHash", "==", hashToken(token)).limit(1);
}

interface InvitationClaim {
  ref: DocumentReference;
  claimId: string;
  email: string;
  name: string;
}

const CLAIM_BUSY = "Este convite está sendo usado neste momento. Aguarde alguns instantes e tente novamente.";

/**
 * Reserva o convite (pendente → "accepting") ANTES de qualquer efeito no
 * Auth: um segundo aceite simultâneo, ou um que falhe, não cria nem altera
 * nenhuma conta. Uma reserva abandonada há mais de CLAIM_TTL_MS pode ser
 * assumida. Os aceites também são um por vez POR E-MAIL: com outro convite do
 * mesmo e-mail em aceite, a reserva é recusada (a conta que o outro aceite
 * acabou de criar nunca é confundida com uma conta criada por fora).
 */
async function claimInvitation(token: string): Promise<InvitationClaim> {
  const claimId = randomUUID();
  return db.runTransaction(async (tx) => {
    const doc = (await tx.get(invitationsByToken(token))).docs[0];
    const data = assertUsable(doc);
    const open = await openInvitationsFor(tx, data.email as string);
    if (hasActiveClaim(data) || open.some((d) => d.id !== doc!.id && hasActiveClaim(d.data()))) fail("conflict", CLAIM_BUSY);
    tx.update(doc!.ref, { status: "accepting", claimId, claimedAt: nowISO() });
    return { ref: doc!.ref, claimId, email: data.email as string, name: data.name as string };
  });
}

/** Outro convite do mesmo e-mail com reserva de aceite ativa (fora de transação). */
async function otherActiveClaim(claim: InvitationClaim) {
  const snap = await db.collection("invitations").where("email", "==", claim.email).where("status", "==", "accepting").get();
  return snap.docs.some((d) => d.id !== claim.ref.id && hasActiveClaim(d.data()));
}

/** Desfaz a reserva (o convite volta a pendente), se ela ainda for desta tentativa. */
async function releaseClaim(claim: InvitationClaim) {
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(claim.ref)).data();
    if (data?.status === "accepting" && data.claimId === claim.claimId) tx.update(claim.ref, { status: "pending", ...CLEAR_CLAIM });
  });
}

/**
 * Cria a conta do convite no Auth. Uma conta que já existe com o e-mail NUNCA
 * é reaproveitada: quem a criou por fora (antes do convite) ainda teria o uid
 * e sessões válidas. Se ela pertence a um integrante, o aceite é recusado; se
 * não, é apagada (com registro na auditoria) e a conta nasce de novo com
 * outro uid — tokens emitidos antes do aceite não correspondem a nenhum
 * integrante.
 */
async function createInvitedAccount(claim: InvitationClaim, pass: string): Promise<string> {
  const { email } = claim;
  const existing = await adminAuth.getUserByEmail(email).catch((error: { code?: string }) => {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  });
  if (existing) {
    // Nesta ordem: um aceite do mesmo e-mail ou ainda tem a reserva ativa ou já gravou o integrante.
    if (await otherActiveClaim(claim)) fail("conflict", CLAIM_BUSY);
    const member = await db.doc(`members/${existing.uid}`).get();
    if (member.exists) fail("conflict", "Já existe uma conta com este e-mail. Entre com o seu e-mail e senha.");
    await adminAuth.deleteUser(existing.uid);
    // Uma conta criada por fora com o e-mail de um convite é sinal de tentativa de antecipação.
    logger.warn("Conta sem cadastro na Central removida no aceite de convite", { invitationId: claim.ref.id, removedUid: existing.uid });
    await auditDirect(
      { uid: null, name: "" },
      {
        action: "auth.removeUnlinkedAccount",
        module: "auth",
        resourceType: "invitation",
        resourceId: claim.ref.id,
        summary: "Conta de acesso criada fora do convite, com o mesmo e-mail, foi removida antes do aceite",
        details: { removedUid: existing.uid, accountCreatedAt: existing.metadata.creationTime ?? null },
      },
    );
  }
  try {
    const user = await adminAuth.createUser({ email, password: pass, displayName: claim.name, emailVerified: false, disabled: false });
    return user.uid;
  } catch (error) {
    if ((error as { code?: string }).code === "auth/email-already-exists") fail("conflict", "Não foi possível criar a conta agora. Tente novamente em instantes.");
    throw error;
  }
}

export const authActions = {
  /** Dados exibidos na página do convite (sem exigir login). */
  previewInvitation: query({
    module: "auth",
    public: true,
    schema: z.object({ token: tokenSchema }),
    async run(_actor, { token }) {
      const data = assertUsable((await invitationsByToken(token).get()).docs[0]);
      const role = await db.doc(`roles/${data.roleId}`).get();
      return {
        name: data.name as string,
        email: data.email as string,
        roleName: (role.data()?.name as string | undefined) ?? "",
        expiresAt: (data.expiresAt as Timestamp).toDate().toISOString(),
      };
    },
  }),

  /**
   * Aceita o convite: reserva o convite, cria uma conta NOVA no Firebase
   * Authentication com a senha escolhida (a senha não é gravada nem
   * registrada em log) e habilita o integrante na Central. O convite só pode
   * ser usado uma vez; se algo falhar depois da reserva, a conta criada é
   * apagada e o convite volta a pendente.
   */
  acceptInvitation: query({
    module: "auth",
    public: true,
    schema: z.object({ token: tokenSchema, password }),
    async run(_actor, { token, password: pass }) {
      const claim = await claimInvitation(token);
      let uid: string | undefined;
      try {
        uid = await createInvitedAccount(claim, pass);
        const accountId = uid;
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(claim.ref);
          const inv = fresh.data();
          // A reserva precisa continuar sendo desta tentativa (revogado, renovado ou assumido por outro aceite = recusa).
          if (!inv || inv.status !== "accepting" || inv.claimId !== claim.claimId || inv.tokenHash !== hashToken(token)) {
            fail("conflict", "Este convite já foi usado ou cancelado.");
          }
          const roleSnap = await tx.get(db.doc(`roles/${inv.roleId}`));
          ensure(roleSnap.exists, "conflict", "O cargo deste convite não existe mais. Peça um novo convite.");
          const [sameEmail, others] = await Promise.all([
            tx.get(db.collection("memberPrivate").where("email", "==", claim.email).limit(1)),
            tx.get(db.collection("invitations").where("email", "==", claim.email).limit(SUPERSEDE_LIMIT)),
          ]);
          if (!sameEmail.empty) fail("conflict", "Já existe uma conta com este e-mail. Entre com o seu e-mail e senha.");
          const role = roleFromDoc(roleSnap.id, roleSnap.data()!);
          const now = nowISO();
          const member: Member = { id: accountId, name: inv.name, email: "", roleId: inv.roleId, departmentIds: inv.departmentIds ?? [], status: "active", joinedAt: now };
          tx.create(db.doc(`members/${accountId}`), {
            name: member.name,
            roleId: member.roleId,
            departmentIds: member.departmentIds,
            status: "active",
            joinedAt: now,
            createdBy: inv.createdBy,
            updatedAt: now,
          });
          tx.set(db.doc(`memberPrivate/${accountId}`), { email: claim.email, invitationId: claim.ref.id, createdBy: inv.createdBy, createdAt: now });
          writeAccess(tx, member, role, now);
          // O e-mail sai do convite (a fonte é memberPrivate); o hash fica para o link usado mostrar a mensagem certa.
          tx.update(claim.ref, { status: "accepted", acceptedAt: now, acceptedUserId: accountId, email: FieldValue.delete(), ...CLEAR_CLAIM });
          tx.delete(linkRef(claim.ref.id));
          // Os outros convites deste e-mail (revogados ou expirados) também deixam de guardá-lo; os ainda abertos são revogados.
          const superseded = others.docs.filter((d) => d.id !== claim.ref.id);
          for (const d of superseded) {
            const open = (OPEN_STATUSES as readonly string[]).includes(d.data().status);
            tx.update(d.ref, open ? { status: "revoked", revokedAt: now, email: FieldValue.delete(), ...CLEAR_CLAIM } : { email: FieldValue.delete() });
            if (open) tx.delete(linkRef(d.id));
          }
          auditInTx(
            tx,
            { uid: accountId, name: inv.name },
            {
              action: "auth.acceptInvitation",
              module: "auth",
              resourceType: "member",
              resourceId: accountId,
              summary: `Convite aceito; conta criada com o cargo ${role.name}`,
              details: { invitationId: claim.ref.id, otherInvitationsCleared: superseded.length },
            },
            undefined,
            now,
          );
        });
      } catch (error) {
        // A conta criada nesta tentativa é apagada antes de liberar o convite para outra tentativa.
        if (uid) await adminAuth.deleteUser(uid).catch(() => undefined);
        await releaseClaim(claim).catch(() => undefined);
        throw error;
      }
      return { email: claim.email };
    },
  }),

  /** Registra o início de sessão na auditoria (no máximo uma vez a cada 10 minutos). */
  sessionStarted: query({
    module: "auth",
    schema: z.object({}).passthrough(),
    async run(actor) {
      actor = actor!;
      const ref = db.doc(`memberPrivate/${actor.uid}`);
      const snap = await ref.get();
      const last = snap.data()?.lastSessionAuditAt as string | undefined;
      if (last && Date.now() - Date.parse(last) < 10 * 60 * 1000) return { recorded: false };
      const now = nowISO();
      await ref.set({ lastSessionAuditAt: now }, { merge: true });
      await auditDirect({ uid: actor.uid, name: actor.name }, { action: "auth.signIn", module: "auth", resourceType: "session", resourceId: actor.uid, summary: "Sessão iniciada" });
      return { recorded: true };
    },
  }),
};

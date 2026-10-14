import type { OrganizationService } from "../contracts";
import { commit, getDB } from "./db";
import { accessContext, clone, findOrThrow, latency, now, requirePermission, ServiceError } from "./context";
import { newId } from "@/lib/utils";

function assertName(value: string | undefined, label: string) {
  if (value !== undefined && value.trim().length < 2) throw new ServiceError("invalid", `${label} precisa ter pelo menos 2 caracteres.`);
}

export const localOrganization: OrganizationService = {
  async snapshot() {
    await latency(60, 160);
    const db = getDB();
    accessContext(db); // exige um perfil ativo
    return clone({ departments: db.departments, roles: db.roles, members: db.members });
  },

  async createRole(input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "organization.create", "Seu perfil não pode criar cargos.");
      if (input.permissions.length > 0) requirePermission(ctx, "organization.admin", "Seu perfil não pode atribuir permissões.");
      assertName(input.name, "O nome do cargo");
      if (db.roles.some((r) => r.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
        throw new ServiceError("conflict", "Já existe um cargo com esse nome.");
      }
      findOrThrow(db.departments, input.departmentId, "Departamento");
      const at = now();
      const role = { ...input, id: newId("role"), name: input.name.trim(), createdAt: at, updatedAt: at };
      db.roles.push(role);
      return clone(role);
    });
  },

  async updateRole(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "organization.edit", "Seu perfil não pode editar cargos.");
      const role = findOrThrow(db.roles, id, "Cargo");
      if (input.permissions) {
        requirePermission(ctx, "organization.admin", "Seu perfil não pode alterar permissões.");
        if (role.id === ctx.role.id && !input.permissions.includes("organization.admin")) {
          throw new ServiceError("invalid", "Você não pode remover do seu próprio cargo a permissão de administrar a organização — perderia acesso a esta tela.");
        }
      }
      if (input.active === false && role.id === ctx.role.id) {
        throw new ServiceError("invalid", "Você não pode desativar o seu próprio cargo.");
      }
      assertName(input.name, "O nome do cargo");
      Object.assign(role, input, { updatedAt: now() });
      return clone(role);
    });
  },

  async createDepartment(input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "organization.create", "Seu perfil não pode criar departamentos.");
      assertName(input.name, "O nome do departamento");
      if (db.departments.some((d) => d.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
        throw new ServiceError("conflict", "Já existe um departamento com esse nome.");
      }
      const dep = { ...input, id: newId("dep"), name: input.name.trim(), shortName: input.shortName.trim().toUpperCase(), createdAt: now() };
      db.departments.push(dep);
      return clone(dep);
    });
  },

  async updateDepartment(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "organization.edit", "Seu perfil não pode editar departamentos.");
      const dep = findOrThrow(db.departments, id, "Departamento");
      assertName(input.name, "O nome do departamento");
      Object.assign(dep, input, input.shortName ? { shortName: input.shortName.toUpperCase() } : {});
      return clone(dep);
    });
  },

  async createMember(input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "organization.create", "Seu perfil não pode adicionar integrantes.");
      assertName(input.name, "O nome");
      if (db.members.some((m) => m.email.toLowerCase() === input.email.trim().toLowerCase())) {
        throw new ServiceError("conflict", "Já existe um integrante com esse e-mail.");
      }
      findOrThrow(db.roles, input.roleId, "Cargo");
      const member = { ...input, id: newId("usr"), name: input.name.trim(), email: input.email.trim().toLowerCase(), joinedAt: now() };
      db.members.push(member);
      return clone(member);
    });
  },

  async updateMember(id, input) {
    await latency();
    return commit((db) => {
      const ctx = accessContext(db);
      requirePermission(ctx, "organization.edit", "Seu perfil não pode editar integrantes.");
      const member = findOrThrow(db.members, id, "Integrante");
      if (member.id === ctx.user.id) {
        if (input.status === "inactive") throw new ServiceError("invalid", "Você não pode desativar o seu próprio perfil.");
        if (input.roleId && input.roleId !== member.roleId) {
          throw new ServiceError("invalid", "Você não pode alterar o seu próprio cargo. Peça a outra pessoa da presidência.");
        }
      }
      if (input.roleId) findOrThrow(db.roles, input.roleId, "Cargo");
      Object.assign(member, input);
      return clone(member);
    });
  },

  async listInvitations() {
    await latency(60, 140);
    return [];
  },

  async inviteMember() {
    throw new ServiceError("unavailable", "Convites dependem do Firebase. Na demonstração, use “Adicionar integrante”.");
  },

  async renewInvitation() {
    throw new ServiceError("unavailable", "Convites dependem do Firebase.");
  },

  async revokeInvitation() {
    throw new ServiceError("unavailable", "Convites dependem do Firebase.");
  },
};

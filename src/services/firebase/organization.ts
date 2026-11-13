import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import type { Department, Invitation, Member, Role } from "@/types";
import type { InvitationResult, OrganizationService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { fromSnap, mapFirestoreError } from "./convert";
import { hasPerm, whenAccess } from "./session";

export const firebaseOrganization: OrganizationService = {
  async snapshot() {
    const access = await whenAccess();
    const { db } = firebase();
    try {
      const [deps, roles, members] = await Promise.all([getDocs(collection(db, "departments")), getDocs(collection(db, "roles")), getDocs(collection(db, "members"))]);
      const emails = new Map<string, string>();
      if (hasPerm(access, "organization.edit")) {
        const priv = await getDocs(collection(db, "memberPrivate"));
        for (const d of priv.docs) emails.set(d.id, (d.data().email as string) ?? "");
      }
      return {
        departments: deps.docs.map((d) => fromSnap<Department>(d)),
        roles: roles.docs.map((d) => fromSnap<Role>(d)),
        members: members.docs.map((d) => ({ ...fromSnap<Member>(d), email: emails.get(d.id) ?? "" })),
      };
    } catch (error) {
      throw mapFirestoreError(error);
    }
  },

  async createRole(input) {
    const rid = takeRequestId();
    return callApi<Role>("organization", "createRole", input, rid);
  },
  async updateRole(id, input) {
    const rid = takeRequestId();
    return callApi<Role>("organization", "updateRole", { id, input }, rid);
  },
  async createDepartment(input) {
    const rid = takeRequestId();
    return callApi<Department>("organization", "createDepartment", input, rid);
  },
  async updateDepartment(id, input) {
    const rid = takeRequestId();
    return callApi<Department>("organization", "updateDepartment", { id, input }, rid);
  },
  async createMember() {
    throw new ServiceError("unavailable", "Para adicionar integrantes, envie um convite.");
  },
  async updateMember(id, input) {
    const rid = takeRequestId();
    return callApi<Member>("organization", "updateMember", { id, input }, rid);
  },

  async updateMyPhoto(photo) {
    const rid = takeRequestId();
    return callApi<Member>("organization", "updateMyPhoto", { photo }, rid);
  },
  async deleteMember(id) {
    const rid = takeRequestId();
    await callApi("organization", "deleteMember", { id }, rid);
  },

  async listInvitations() {
    const access = await whenAccess();
    if (!hasPerm(access, "organization.create") && !hasPerm(access, "organization.edit")) return [];
    const { db } = firebase();
    try {
      const snap = await getDocs(query(collection(db, "invitations"), orderBy("createdAt", "desc"), limit(200)));
      return snap.docs.map((d) => {
        const inv = fromSnap<Invitation & { tokenHash?: string; claimId?: string; claimedAt?: string }>(d);
        delete inv.tokenHash;
        delete inv.claimId;
        delete inv.claimedAt;
        // "accepting" é a reserva transitória do aceite no servidor: aparece como pendente.
        const status = (inv.status as string) === "accepting" ? "pending" : inv.status;
        const expired = status === "pending" && Date.parse(inv.expiresAt) < Date.now();
        // Convites aceitos não guardam o e-mail (a fonte é memberPrivate).
        return { ...inv, email: inv.email ?? "", status: expired ? "expired" : status };
      });
    } catch (error) {
      throw mapFirestoreError(error);
    }
  },
  async inviteMember(input) {
    const rid = takeRequestId();
    return callApi<InvitationResult>("organization", "inviteMember", input, rid);
  },
  async renewInvitation(id) {
    const rid = takeRequestId();
    return callApi<InvitationResult>("organization", "renewInvitation", { id }, rid);
  },
  async revokeInvitation(id) {
    const rid = takeRequestId();
    return callApi<Invitation>("organization", "revokeInvitation", { id }, rid);
  },

  async supportUpdateAccount(id, input) {
    const rid = takeRequestId();
    return callApi<Member>("organization", "supportUpdateAccount", { id, input }, rid);
  },
  async invitationLink(id) {
    const rid = takeRequestId();
    return (await callApi<{ link: string }>("organization", "invitationLink", { id }, rid)).link;
  },
};

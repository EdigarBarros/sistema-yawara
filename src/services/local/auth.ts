import type { AuthService, DemoProfile } from "../contracts";
import { getDB } from "./db";
import { clone, latency, ServiceError } from "./context";
import type { DemoDB } from "@/data/demo/seed";
import type { Member } from "@/types";

function toProfile(db: DemoDB, member: Member): DemoProfile {
  const role = db.roles.find((r) => r.id === member.roleId)!;
  return clone({ member, role, department: db.departments.find((d) => d.id === role.departmentId) });
}

export const localAuth: AuthService = {
  async listDemoProfiles() {
    await latency(80, 200);
    const db = getDB();
    return db.members
      .filter((m) => m.demoProfile && m.status === "active")
      .sort((a, b) => (a.demoProfile!.order ?? 0) - (b.demoProfile!.order ?? 0))
      .map((m) => toProfile(db, m));
  },

  async signInWithPassword(email) {
    await latency(500, 900);
    const db = getDB();
    const member = db.members.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
    if (!member || !member.demoProfile) {
      throw new ServiceError(
        "unavailable",
        "O login real será ativado com o backend. Nesta demonstração, use um dos e-mails de perfil fictício ou a aba “Modo demonstração”.",
      );
    }
    if (member.status !== "active") {
      throw new ServiceError("forbidden", "Este perfil de demonstração está inativo.");
    }
    return toProfile(db, member);
  },

  async requestPasswordReset() {
    await latency(300, 600);
    return { available: false };
  },
};

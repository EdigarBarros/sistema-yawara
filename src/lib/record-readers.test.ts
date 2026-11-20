/**
 * Garante que os marcadores `readers` gravados pelo servidor (usados pelas
 * regras do Firestore/Storage) dão exatamente o mesmo resultado que as
 * políticas da interface, para todos os registros e perfis da demonstração.
 */
import { describe, expect, it } from "vitest";
import { buildSeed } from "@/data/demo/seed";
import { intersects, userTokens } from "./access-tokens";
import { hasPermission, type AccessContext } from "./permissions";
import { canEditProject, canSeeBuyer, canSeeCampaign, canSeeContent, canSeeDocument, canSeeEvent, canSeeMeeting, canSeeProject } from "./policies";
import { buyerReaders, campaignReaders, contentReaders, documentReaders, eventReaders, meetingReaders, projectEditors, projectReaders } from "./record-readers";
import type { ModuleKey } from "@/types";

const db = buildSeed();
const contexts: AccessContext[] = db.members.map((user) => {
  const role = db.roles.find((r) => r.id === user.roleId)!;
  return { user, role, department: db.departments.find((d) => d.id === role.departmentId) };
});

/** O que as regras de segurança decidem para um registro com `readers`. */
function rulesAllow(ctx: AccessContext, module: ModuleKey, readers: string[]) {
  return hasPermission(ctx, `${module}.view`) && (hasPermission(ctx, `${module}.admin`) || intersects(userTokens(ctx.user, ctx.role), readers));
}

describe("readers ≡ políticas de visualização", () => {
  it("campanhas", () => {
    for (const ctx of contexts) for (const c of db.campaigns) expect(rulesAllow(ctx, "campaigns", campaignReaders(c)), `${ctx.user.id} × ${c.id}`).toBe(canSeeCampaign(ctx, c));
  });
  it("dados de compradores (para quem vê a campanha)", () => {
    for (const ctx of contexts)
      for (const sale of db.sales) {
        const c = db.campaigns.find((x) => x.id === sale.campaignId)!;
        if (!canSeeCampaign(ctx, c)) continue;
        expect(rulesAllow(ctx, "campaigns", buyerReaders(c, sale)), `${ctx.user.id} × ${sale.id}`).toBe(canSeeBuyer(ctx, c, sale));
      }
  });
  it("eventos", () => {
    for (const ctx of contexts) for (const e of db.events) expect(rulesAllow(ctx, "events", eventReaders(e)), `${ctx.user.id} × ${e.id}`).toBe(canSeeEvent(ctx, e));
  });
  it("documentos", () => {
    for (const ctx of contexts) for (const d of db.documents) expect(rulesAllow(ctx, "documents", documentReaders(d)), `${ctx.user.id} × ${d.id}`).toBe(canSeeDocument(ctx, d));
  });
  it("reuniões", () => {
    for (const ctx of contexts) for (const m of db.meetings) expect(rulesAllow(ctx, "meetings", meetingReaders(m)), `${ctx.user.id} × ${m.id}`).toBe(canSeeMeeting(ctx, m));
  });
  it("conteúdos de marketing", () => {
    for (const ctx of contexts) for (const c of db.contents) expect(rulesAllow(ctx, "marketing", contentReaders(c)), `${ctx.user.id} × ${c.id}`).toBe(canSeeContent(ctx, c));
  });
  it("projetos e lista de presença", () => {
    for (const ctx of contexts)
      for (const p of db.projects) {
        expect(rulesAllow(ctx, "extension", projectReaders(p)), `${ctx.user.id} × ${p.id}`).toBe(canSeeProject(ctx, p));
        if (!canSeeProject(ctx, p)) continue;
        const rulesAttendance =
          hasPermission(ctx, "extension.view") &&
          (hasPermission(ctx, "extension.admin") || hasPermission(ctx, "extension.edit") || intersects(userTokens(ctx.user, ctx.role), projectEditors(p)));
        expect(rulesAttendance, `${ctx.user.id} × presença ${p.id}`).toBe(canEditProject(ctx, p) || hasPermission(ctx, "extension.admin"));
      }
  });
  it("conta desativada não pertence a nenhum público", () => {
    const inactive = contexts.find((c) => c.user.status === "inactive")!;
    expect(userTokens(inactive.user, inactive.role)).toEqual([]);
  });
});

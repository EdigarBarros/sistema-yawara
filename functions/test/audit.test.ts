import { beforeEach, describe, expect, it } from "vitest";
import type { Audience } from "@/types";
import { auditActions } from "../src/modules/audit";
import { auditFor, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const system = caller("system", auditActions);
const NOW = "2026-10-14T12:00:00.000Z";

function audience(scope: Audience["scope"], extra: Partial<Audience> = {}): Audience {
  return { scope, roleIds: [], userIds: [], ...extra };
}

async function exportsOf(resourceId: string) {
  return (await auditFor(resourceId)).filter((a) => String(a.action).endsWith(".export"));
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
  await createMember("assext", "Assessor Extensão Teste", "assessor-extensao");

  // Registros mínimos (somente os campos usados pelas políticas de visualização).
  await db.doc("meetings/reu1").set({
    title: "Reunião de teste",
    access: audience("board"),
    createdBy: "sec",
    participantIds: ["sec"],
    status: "approved",
    readers: ["board", "u:sec"],
    updatedAt: NOW,
  });
  await db.doc("campaigns/cmp1").set({
    name: "Rifa de teste",
    code: "RIFA-2026-001",
    departmentId: "eventos",
    createdBy: "evt",
    access: { view: audience("all"), sell: audience("all"), buyerData: audience("people", { userIds: ["evt"] }) },
    readers: ["all", "u:evt"],
    updatedAt: NOW,
  });
  await db.doc("projects/prj1").set({
    name: "Palestra de teste",
    createdBy: "ext",
    responsibleId: "assext",
    access: audience("all"),
    readers: ["all", "u:ext", "u:assext"],
    updatedAt: NOW,
  });
});

describe("recordExport: registro de exportações na auditoria", () => {
  it("PDF da ata (Secretaria, com meetings.export) é registrado com autor verificado e sem dados pessoais", async () => {
    const res = await system<{ recorded: boolean }>("recordExport", "sec", { module: "meetings", resourceType: "meeting", resourceId: "reu1", summary: "PDF da ata", personalData: false });
    expect(res).toEqual({ recorded: true });
    const [entry, ...more] = await exportsOf("reu1");
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      action: "meetings.export",
      module: "meetings",
      actorId: "sec",
      actorName: "Secretária Teste",
      resourceType: "meeting",
      resourceId: "reu1",
      outcome: "success",
      summary: "PDF da ata",
      details: { personalData: false },
    });
    expect(typeof entry.at).toBe("string");
    expect(entry.expireAt).toBeDefined();
  });

  it("Secretaria e Extensão exigem sempre a permissão de exportar", async () => {
    // Financeiro vê reuniões (meetings.view), mas não tem meetings.export.
    await db.doc("meetings/reu1").update({ participantIds: ["sec", "fin"] });
    await expectCode(system("recordExport", "fin", { module: "meetings", resourceType: "meeting", resourceId: "reu1", summary: "PDF da ata", personalData: false }), "forbidden");
    // Assessor(a) de Extensão edita o projeto, mas não tem extension.export.
    await expectCode(system("recordExport", "assext", { module: "extension", resourceType: "project", resourceId: "prj1", summary: "Certificados (3 participantes)", personalData: true }), "forbidden");
    await expectCode(system("recordExport", "assext", { module: "extension", resourceType: "project", resourceId: "prj1", summary: "Programação", personalData: false }), "forbidden");
    expect(await exportsOf("reu1")).toHaveLength(0);
    expect(await exportsOf("prj1")).toHaveLength(0);
  });

  it("Extensão: com extension.export e acesso à lista de presença, a exportação é registrada", async () => {
    await system("recordExport", "ext", { module: "extension", resourceType: "project", resourceId: "prj1", summary: "Lista de presença em CSV (3 participantes)", personalData: true });
    const entries = await exportsOf("prj1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "extension.export", actorId: "ext", details: { personalData: true } });
  });

  it("dados pessoais exigem <módulo>.export e acesso aos dados de todos os compradores", async () => {
    const input = { module: "campaigns", resourceType: "campaign", resourceId: "cmp1", summary: "PDF interno com dados dos compradores (todos os números)", personalData: true };
    // Assessor(a): vê a campanha, mas não tem campaigns.export.
    await expectCode(system("recordExport", "ass", input), "forbidden");
    // Financeiro: tem campaigns.export, mas não está no público "dados dos compradores".
    await expectCode(system("recordExport", "fin", input), "forbidden");
    // Criador(a) da campanha com campaigns.export: registrado.
    await system("recordExport", "evt", input);
    // Presidência (campaigns.admin): registrado.
    await system("recordExport", "pres", input);
    const entries = await exportsOf("cmp1");
    expect(entries.map((e) => e.actorId).sort()).toEqual(["evt", "pres"]);
    expect(entries.every((e) => e.action === "campaigns.export" && e.details.personalData === true)).toBe(true);
  });

  it("sem dados pessoais basta ver o módulo e o registro", async () => {
    await system("recordExport", "ass", { module: "campaigns", resourceType: "campaign", resourceId: "cmp1", summary: "Grade pública de números (PNG)", personalData: false });
    expect(await exportsOf("cmp1")).toHaveLength(1);
    // Relatório financeiro (sem registro específico): exige finance.view.
    await system("recordExport", "fin", { module: "finance", resourceType: "financeReport", resourceId: "relatorio", summary: "CSV do relatório financeiro: 12 lançamento(s).", personalData: false });
    await expectCode(system("recordExport", "evt", { module: "finance", resourceType: "financeReport", resourceId: "relatorio", summary: "CSV do relatório financeiro", personalData: false }), "forbidden");
    const finance = await exportsOf("relatorio");
    expect(finance).toHaveLength(1);
    expect(finance[0]).toMatchObject({ action: "finance.export", actorId: "fin", module: "finance" });
  });

  it("registro que a pessoa não vê, inexistente ou de outro módulo é recusado", async () => {
    await db.doc("campaigns/cmp1").update({ "access.view": audience("department", { departmentId: "eventos" }), readers: ["d:eventos", "u:evt"] });
    // Marketing vê campanhas, mas não esta.
    await expectCode(system("recordExport", "mkt", { module: "campaigns", resourceType: "campaign", resourceId: "cmp1", summary: "Grade pública", personalData: false }), "forbidden");
    await expectCode(system("recordExport", "evt", { module: "campaigns", resourceType: "campaign", resourceId: "nao-existe", summary: "Grade pública", personalData: false }), "not_found");
    await expectCode(system("recordExport", "evt", { module: "finance", resourceType: "campaign", resourceId: "cmp1", summary: "Grade pública", personalData: false }), "invalid");
    expect(await exportsOf("cmp1")).toHaveLength(0);
  });

  it("módulo desativado não registra exportações", async () => {
    await db.doc("settings/system").update({ "modules.meetings": false });
    await expectCode(system("recordExport", "sec", { module: "meetings", resourceType: "meeting", resourceId: "reu1", summary: "PDF da ata", personalData: false }), "unavailable");
  });

  it("valida a entrada: resumo curto, campos conhecidos, identificadores seguros", async () => {
    const base = { module: "meetings", resourceType: "meeting", resourceId: "reu1", summary: "PDF da ata", personalData: false };
    await expectCode(system("recordExport", "sec", { ...base, summary: "x".repeat(301) }), "invalid");
    await expectCode(system("recordExport", "sec", { ...base, actorId: "pres" }), "invalid");
    await expectCode(system("recordExport", "sec", { ...base, resourceId: "../members/pres" }), "invalid");
    await expectCode(system("recordExport", "sec", { ...base, module: "inexistente" }), "invalid");
    await expectCode(system("recordExport", "sec", { ...base, personalData: "sim" }), "invalid");
    await expectCode(system("recordExport", undefined, base), "unauthenticated");
    expect(await exportsOf("reu1")).toHaveLength(0);
  });
});

/**
 * Regras de "Vigente" que o modo demonstração e a interface aplicam como o
 * servidor (functions/src/modules/documents.ts): uma nova versão enviada por
 * quem não valida documentos faz um documento vigente voltar para "Em
 * elaboração"; restaurar só devolve como vigente para quem pode validar.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Audience } from "@/types";
import { buildSeed } from "@/data/demo/seed";
import { DEP, ROLE, USR } from "@/data/demo/organization";
import { DOC, DOC_CAT } from "@/data/demo/documents";
import { canMarkDocumentCurrent } from "@/lib/policies";
import { getDB, setDBForTests } from "@/services/local/db";
import { accessContext, disableLatencyForTests, setActorForTests } from "@/services/local/context";
import { localDocuments as documents } from "@/services/local/documents";

disableLatencyForTests();

const DEPARTMENT: Audience = { scope: "department", roleIds: [], userIds: [] };

function pdf(name = "relatorio.pdf") {
  return new File(["%PDF-1.4\n%%EOF\n"], name, { type: "application/pdf" });
}

async function financeDocBy(userId: string, status: "current" | "draft" = "current") {
  setActorForTests(userId);
  return documents.create(
    { name: "Relatório de teste", description: "", categoryId: DOC_CAT.financeiros, departmentId: DEP.financeiro, access: DEPARTMENT, status },
    pdf(),
    "relatorio.pdf",
  );
}

beforeEach(() => {
  setDBForTests(buildSeed(new Date("2026-10-14T15:00:00-03:00")));
});

describe("nova versão de documento vigente (demonstração)", () => {
  it("quem não valida envia a versão e o documento volta para “Em elaboração”; quem valida mantém vigente", async () => {
    // Helena (Secretaria) valida documentos; Caio (Financeiro) edita no departamento, sem documents.approve.
    const d = await financeDocBy(USR.helena);
    setActorForTests(USR.caio);
    const byEditor = await documents.addVersion(d.id, pdf("relatorio-v2.pdf"), "Valores corrigidos");
    expect(byEditor.versions.map((v) => `${v.version}:${v.uploadedBy}`)).toEqual([`1:${USR.helena}`, `2:${USR.caio}`]);
    expect(byEditor.status).toBe("draft");
    expect(byEditor.history.slice(-2)).toMatchObject([
      { action: "version", actorId: USR.caio },
      { action: "status", actorId: USR.caio, summary: "Nova versão aguardando validação: situação alterada para Em elaboração" },
    ]);
    await expect(documents.update(d.id, { status: "current" })).rejects.toMatchObject({ code: "forbidden" });

    setActorForTests(USR.helena);
    expect((await documents.update(d.id, { status: "current" })).status).toBe("current");
    const byApprover = await documents.addVersion(d.id, pdf());
    expect(byApprover.status).toBe("current");
    expect(byApprover.history.at(-1)).toMatchObject({ action: "version" });
  });

  it("quem criou mantém o próprio documento vigente; documento em elaboração continua em elaboração", async () => {
    setActorForTests(USR.caio);
    expect((await documents.addVersion(DOC.relFinanceiro, pdf())).status).toBe("current");

    const draft = await financeDocBy(USR.helena, "draft");
    setActorForTests(USR.caio);
    const next = await documents.addVersion(draft.id, pdf());
    expect(next.status).toBe("draft");
    expect(next.history.map((h) => h.action)).toEqual(["created", "version"]);
  });

  it("restaurar devolve como vigente só para quem pode validar (como no servidor)", async () => {
    const d = await financeDocBy(USR.helena);
    await documents.archive(d.id);
    // Caio passa a poder arquivar/restaurar, mas continua sem validar documentos.
    getDB().roles.find((r) => r.id === ROLE.financeiro)!.permissions.push("documents.archive");
    setActorForTests(USR.caio);
    const restored = await documents.restore(d.id);
    expect(restored.status).toBe("draft");
    expect(restored.history.at(-1)).toMatchObject({ action: "restored", summary: "Documento restaurado (em elaboração)" });

    setActorForTests(USR.helena);
    await documents.archive(d.id);
    expect((await documents.restore(d.id)).status).toBe("current");
  });

  it("a política usada pela interface: valida quem tem documents.approve ou criou o documento", () => {
    const d = getDB().documents.find((x) => x.id === DOC.relFinanceiro)!;
    setActorForTests(USR.caio);
    expect(canMarkDocumentCurrent(accessContext(getDB()), d)).toBe(true);
    expect(canMarkDocumentCurrent(accessContext(getDB()), { ...d, createdBy: USR.helena })).toBe(false);
    setActorForTests(USR.helena);
    expect(canMarkDocumentCurrent(accessContext(getDB()), d)).toBe(true);
  });
});

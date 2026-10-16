import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { DocumentCategory, InstitutionalDocument } from "@/types";
import { documentsActions, newDocumentId } from "../src/modules/documents";
import { systemActions } from "../src/modules/system";
import { auditFor, bucket, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const documents = caller("documents", documentsActions);
const system = caller("system", systemActions);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% documento de teste\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

const ALL = { scope: "all", roleIds: [], userIds: [] };

function docInput(over: Record<string, unknown> = {}) {
  return {
    name: "Estatuto social",
    description: "Versão aprovada em assembleia",
    categoryId: "estatuto",
    departmentId: "secretaria",
    status: "current",
    access: { scope: "department", departmentId: "secretaria", roleIds: [], userIds: [] },
    ...over,
  };
}

/** Emite o tíquete pelo próprio servidor e envia o conteúdo para a área temporária (como o navegador faria). */
async function stage(uid: string, content: Buffer, fileName = "estatuto.pdf", contentType = "application/pdf", targetId?: string) {
  const ticket = await system<{ uploadId: string; path: string; fileName: string }>("prepareUpload", uid, {
    purpose: "document",
    fileName,
    size: content.length,
    contentType,
    ...(targetId ? { targetId } : {}),
  });
  // O SDK do navegador grava um token de download público nos metadados; o servidor precisa removê-lo.
  await bucket().file(ticket.path).save(content, { contentType, metadata: { metadata: { firebaseStorageDownloadTokens: "token-publico-de-teste" } } });
  return ticket;
}

async function createDoc(uid = "sec", over: Record<string, unknown> = {}, uploadId: string | null = null, requestId?: string) {
  return documents<InstitutionalDocument>("create", uid, { input: docInput(over), uploadId }, requestId);
}

async function stored(id: string) {
  return (await db.doc(`documents/${id}`).get()).data()!;
}

async function exists(path: string) {
  const [ok] = await bucket().file(path).exists();
  return ok;
}

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("criação", () => {
  it("sem arquivo: versão 1 sem arquivo; autor, datas, readers, histórico e índice definidos pelo servidor", async () => {
    const d = await createDoc("sec", { links: { eventId: "" } });
    expect(d.createdBy).toBe("sec");
    expect(d.sample).toBe(false);
    expect(d.versions).toHaveLength(1);
    expect(d.versions[0]).toMatchObject({ version: 1, file: null, uploadedBy: "sec", note: "Versão inicial" });
    expect(d.versions[0].uploadedAt).toBe(d.createdAt);
    expect(d.links).toEqual({});
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ action: "created", actorId: "sec", summary: "Documento adicionado sem arquivo" });
    expect(d).not.toHaveProperty("readers");

    const data = await stored(d.id);
    expect(data.readers).toEqual(["d:secretaria", "u:sec"]);
    const index = (await db.doc(`searchIndex/document__${d.id}`).get()).data()!;
    expect(index.readers).toEqual(data.readers);
    expect(index.subtitle).toBe("Estatuto");
    expect(index.terms).toContain("estatuto");

    const audit = await auditFor(d.id);
    expect(audit.map((a) => a.action)).toEqual(["documents.create"]);
    expect(audit[0]).toMatchObject({ actorId: "sec", module: "documents", outcome: "success" });
    expect(audit[0].details).toMatchObject({ version: 1, hasFile: false, scope: "department" });
  });

  it("com PDF real: conferido, movido para documents/{id}/v1, sem token público e com SHA-256", async () => {
    const ticket = await stage("sec", PDF);
    const [stagedMeta] = await bucket().file(ticket.path).getMetadata();
    expect(stagedMeta.metadata?.firebaseStorageDownloadTokens).toBe("token-publico-de-teste");
    const requestId = randomUUID();
    const d = await createDoc("sec", {}, ticket.uploadId, requestId);

    // O id do documento é derivado da requisição (uid:requestId) — reenvios usam a mesma pasta.
    expect(d.id).toBe(newDocumentId("sec", requestId));
    expect(d.id).toMatch(/^[a-f0-9]{20}$/);
    const file = d.versions[0].file!;
    expect(file.path).toBe(`documents/${d.id}/v1/${ticket.uploadId}-estatuto.pdf`);
    expect(file).toMatchObject({ name: "estatuto.pdf", size: PDF.length, mimeType: "application/pdf", sha256: sha256(PDF) });
    expect(d.history[0].summary).toBe("Documento adicionado com arquivo");

    expect(await exists(file.path!)).toBe(true);
    expect(await exists(ticket.path)).toBe(false);
    const [meta] = await bucket().file(file.path!).getMetadata();
    expect(meta.contentType).toBe("application/pdf");
    expect(meta.metadata?.firebaseStorageDownloadTokens ?? null).toBeNull();
    expect(meta.metadata?.sha256).toBe(sha256(PDF));
    const [content] = await bucket().file(file.path!).download();
    expect(content.equals(PDF)).toBe(true);

    const upload = (await db.doc(`uploads/${ticket.uploadId}`).get()).data()!;
    expect(upload.status).toBe("attached");
    expect(upload.attachedTo).toBe(`documents/${d.id}`);

    const audit = await auditFor(d.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({ hasFile: true, mimeType: "application/pdf", size: PDF.length, sha256: sha256(PDF) });
    // A auditoria não guarda o nome do arquivo.
    expect(JSON.stringify(audit[0])).not.toContain("estatuto.pdf");
  });

  it("reenvio da mesma requisição com arquivo devolve o mesmo documento, sem duplicar nada", async () => {
    const ticket = await stage("sec", PDF);
    const requestId = randomUUID();
    const first = await createDoc("sec", {}, ticket.uploadId, requestId);
    const again = await createDoc("sec", {}, ticket.uploadId, requestId);
    expect(again.id).toBe(first.id);
    expect(again.versions).toEqual(first.versions);
    expect((await db.collection("documents").get()).size).toBe(1);
    expect(await auditFor(first.id)).toHaveLength(1);
    expect(await exists(first.versions[0].file!.path!)).toBe(true);

    // Reenvio da mesma requisição com outro envio (o navegador reenviou o arquivo): continua o mesmo documento.
    const second = await stage("sec", PDF);
    const third = await createDoc("sec", {}, second.uploadId, requestId);
    expect(third.id).toBe(first.id);
    expect(third.versions[0].file!.path).toBe(first.versions[0].file!.path);
    expect((await db.collection("documents").get()).size).toBe(1);
  });

  it("arquivo declarado como PDF com conteúdo PNG ou texto é recusado e nada é gravado", async () => {
    for (const content of [PNG, Buffer.from("isto não é um PDF, é texto simples\n")]) {
      const ticket = await stage("sec", content, "falso.pdf", "application/pdf");
      await expectCode(createDoc("sec", {}, ticket.uploadId), "invalid");
      expect(await exists(ticket.path)).toBe(false);
      expect((await db.doc(`uploads/${ticket.uploadId}`).get()).data()!.status).toBe("rejected");
    }
    expect((await db.collection("documents").get()).size).toBe(0);
    expect((await db.collection("searchIndex").get()).size).toBe(0);
    expect((await db.collection("auditLogs").where("module", "==", "documents").get()).size).toBe(0);
    const [files] = await bucket().getFiles({ prefix: "documents/" });
    expect(files).toHaveLength(0);
  });

  it("falha de regra depois de mover o arquivo: o arquivo definitivo é apagado (compensação)", async () => {
    const ticket = await stage("sec", PDF);
    await expectCode(createDoc("sec", { categoryId: "nao-existe" }, ticket.uploadId), "invalid");
    const [files] = await bucket().getFiles({ prefix: "documents/" });
    expect(files).toHaveLength(0);
    expect((await db.doc(`uploads/${ticket.uploadId}`).get()).data()!.status).toBe("discarded");
    expect((await db.collection("documents").get()).size).toBe(0);
  });

  it("perfis sem documents.create não criam nem recebem tíquete de envio", async () => {
    await expectCode(createDoc("ass"), "forbidden");
    await expectCode(stage("ass", PDF), "forbidden");
  });

  it("um envio de outra pessoa não pode ser anexado", async () => {
    const ticket = await stage("fin", PDF);
    await expectCode(createDoc("sec", {}, ticket.uploadId), "forbidden");
    expect(await exists(ticket.path)).toBe(true);
  });

  it("categoria, departamento, público e vínculos precisam existir; campos extras são recusados", async () => {
    await expectCode(createDoc("sec", { categoryId: "nao-existe" }), "invalid");
    await expectCode(createDoc("sec", { departmentId: "nao-existe" }), "invalid");
    await expectCode(createDoc("sec", { access: { scope: "roles", roleIds: ["cargo-inexistente"], userIds: [] } }), "invalid");
    await expectCode(createDoc("sec", { access: { scope: "people", roleIds: [], userIds: [] } }), "invalid");
    await expectCode(createDoc("sec", { links: { eventId: "evento-inexistente" } }), "invalid");
    await expectCode(createDoc("sec", { links: { projectId: "projeto-inexistente" } }), "invalid");
    await expectCode(createDoc("sec", { readers: ["u:sec"] }), "invalid");
    await expectCode(createDoc("sec", { createdBy: "pres" }), "invalid");
    await expectCode(createDoc("sec", { name: "ab" }), "invalid");
    await expectCode(documents("create", "sec", { input: docInput(), uploadId: "../../etc" }), "invalid");
    expect((await db.collection("documents").get()).size).toBe(0);
  });

  it("vínculo com evento existente e visível é aceito; evento oculto para o autor é recusado", async () => {
    const base = { departmentId: "eventos", responsibleIds: [], createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", history: [] };
    await db.doc("events/evt-visivel").set({ ...base, name: "Calourada", createdBy: "evt", access: ALL, readers: ["all"] });
    await db.doc("events/evt-oculto").set({ ...base, name: "Reunião fechada", createdBy: "evt", access: { scope: "people", roleIds: [], userIds: ["evt"] }, readers: ["u:evt"] });
    const d = await createDoc("sec", { links: { eventId: "evt-visivel" } });
    expect(d.links).toEqual({ eventId: "evt-visivel" });
    await expectCode(createDoc("sec", { links: { eventId: "evt-oculto" } }), "invalid");
  });

  it("módulo desativado nas configurações recusa a operação", async () => {
    await db.doc("settings/system").update({ "modules.documents": false });
    await expectCode(createDoc("sec"), "unavailable");
  });
});

describe("categorias", () => {
  it("categorias da estrutura e as criadas em Configurações podem ser usadas; o índice mostra o nome", async () => {
    const seeded = await db.collection("documentCategories").get();
    expect(seeded.size).toBeGreaterThan(5);
    expect(seeded.docs.map((d) => d.id)).toContain("estatuto");

    const cat = await system<DocumentCategory>("createDocumentCategory", "pres", { name: "Regimentos internos" });
    const d = await createDoc("sec", { categoryId: cat.id });
    expect(d.categoryId).toBe(cat.id);
    expect((await db.doc(`searchIndex/document__${d.id}`).get()).data()!.subtitle).toBe("Regimentos internos");
  });
});

describe("versões", () => {
  it("nova versão fica em v2 e mantém a v1 (registro e arquivo)", async () => {
    const t1 = await stage("sec", PDF);
    const d = await createDoc("sec", {}, t1.uploadId);
    const content = Buffer.from("%PDF-1.7\n% segunda versão\n%%EOF\n");
    const t2 = await stage("sec", content, "estatuto-v2.pdf", "application/pdf", d.id);
    const next = await documents<InstitutionalDocument>("addVersion", "sec", { id: d.id, uploadId: t2.uploadId, note: "  Artigo 5º corrigido  " });

    expect(next.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(next.versions[0]).toEqual(d.versions[0]);
    expect(next.versions[1]).toMatchObject({ version: 2, uploadedBy: "sec", note: "Artigo 5º corrigido" });
    expect(next.versions[1].file!.path).toBe(`documents/${d.id}/v2/${t2.uploadId}-estatuto-v2.pdf`);
    expect(next.versions[1].file!.sha256).toBe(sha256(content));
    expect(await exists(d.versions[0].file!.path!)).toBe(true);
    expect(await exists(next.versions[1].file!.path!)).toBe(true);
    expect(next.history.at(-1)).toMatchObject({ action: "version", summary: "Versão 2 enviada; versões anteriores mantidas" });

    // Versão sem arquivo na criação: a próxima é a 2.
    const empty = await createDoc("sec");
    const t3 = await stage("sec", PDF);
    const v2 = await documents<InstitutionalDocument>("addVersion", "sec", { id: empty.id, uploadId: t3.uploadId });
    expect(v2.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(v2.versions[1].note).toBeUndefined();

    const audit = await auditFor(d.id);
    expect(audit.map((a) => a.action).sort()).toEqual(["documents.addVersion", "documents.create"]);
    expect(audit.find((a) => a.action === "documents.addVersion")!.details).toMatchObject({ version: 2, sha256: sha256(content) });
  });

  it("reenvio da mesma requisição de nova versão não cria uma terceira versão", async () => {
    const d = await createDoc("sec");
    const ticket = await stage("sec", PDF);
    const requestId = randomUUID();
    const a = await documents<InstitutionalDocument>("addVersion", "sec", { id: d.id, uploadId: ticket.uploadId }, requestId);
    const b = await documents<InstitutionalDocument>("addVersion", "sec", { id: d.id, uploadId: ticket.uploadId }, requestId);
    expect(a.versions).toHaveLength(2);
    expect(b.versions).toEqual(a.versions);
    expect((await stored(d.id)).versions).toHaveLength(2);
  });

  it("quem não pode editar o documento não envia versão (e o arquivo não é movido)", async () => {
    // Público "todos": Marketing vê, mas tem documents.edit em outro departamento.
    const d = await createDoc("sec", { access: ALL });
    const ticket = await stage("mkt", PDF);
    await expectCode(documents("addVersion", "mkt", { id: d.id, uploadId: ticket.uploadId }), "forbidden");
    expect(await exists(ticket.path)).toBe(true);
    expect((await stored(d.id)).versions).toHaveLength(1);

    // Quem tem documents.edit (sem documents.admin) no mesmo departamento pode.
    await db.doc("roles/secretario").update({ permissions: ["documents.view", "documents.create", "documents.edit"] });
    await createMember("sec3", "Secretaria Três Teste", "secretario");
    const t2 = await stage("sec3", PDF);
    const ok = await documents<InstitutionalDocument>("addVersion", "sec3", { id: d.id, uploadId: t2.uploadId });
    expect(ok.versions).toHaveLength(2);
  });

  it("documento vigente: nova versão de quem não valida volta para “Em elaboração”; quem valida (ou criou) mantém vigente", async () => {
    // A Secretaria (documents.approve) cria um documento vigente do Financeiro.
    const finance = { departmentId: "financeiro", categoryId: "relatorios-financeiros", access: { scope: "department", roleIds: [], userIds: [] } };
    const d = await createDoc("sec", finance, (await stage("sec", PDF)).uploadId);
    expect(d.status).toBe("current");

    // Diretor Financeiro: documents.edit no departamento, sem documents.approve e não é o criador.
    const v2 = Buffer.from("%PDF-1.7\n% conteúdo diferente, ainda não validado\n%%EOF\n");
    const byEditor = await documents<InstitutionalDocument>("addVersion", "fin", { id: d.id, uploadId: (await stage("fin", v2, "relatorio-v2.pdf")).uploadId });
    expect(byEditor.versions.map((v) => `${v.version}:${v.uploadedBy}`)).toEqual(["1:sec", "2:fin"]);
    expect(byEditor.status).toBe("draft");
    expect(byEditor.history.slice(-2)).toMatchObject([
      { action: "version", actorId: "fin", summary: "Versão 2 enviada; versões anteriores mantidas" },
      { action: "status", actorId: "fin", summary: "Nova versão aguardando validação: situação alterada para Em elaboração" },
    ]);
    expect((await stored(d.id)).status).toBe("draft");
    const log = (await auditFor(d.id)).find((a) => a.action === "documents.addVersion")!;
    expect(log.details).toMatchObject({ version: 2, status: "draft", awaitingValidation: true });
    // Quem não valida também não marca de volta como vigente.
    await expectCode(documents("update", "fin", { id: d.id, input: { status: "current" } }), "forbidden");

    // Quem valida marca como vigente; versão enviada por quem valida mantém vigente.
    const validated = await documents<InstitutionalDocument>("update", "sec", { id: d.id, input: { status: "current" } });
    expect(validated.status).toBe("current");
    const byApprover = await documents<InstitutionalDocument>("addVersion", "sec", { id: d.id, uploadId: (await stage("sec", PDF)).uploadId });
    expect(byApprover.status).toBe("current");
    expect(byApprover.history.at(-1)).toMatchObject({ action: "version", actorId: "sec" });

    // Quem criou (mesmo sem documents.approve) também mantém o próprio documento vigente.
    const own = await createDoc("fin", finance);
    expect(own.status).toBe("current");
    const ownVersion = await documents<InstitutionalDocument>("addVersion", "fin", { id: own.id, uploadId: (await stage("fin", PDF)).uploadId });
    expect(ownVersion.status).toBe("current");

    // Documento em elaboração continua em elaboração (sem entrada extra no histórico).
    const draft = await createDoc("sec", { ...finance, status: "draft" });
    const draftVersion = await documents<InstitutionalDocument>("addVersion", "fin", { id: draft.id, uploadId: (await stage("fin", PDF)).uploadId });
    expect(draftVersion.status).toBe("draft");
    expect(draftVersion.history.map((h) => h.action)).toEqual(["created", "version"]);
  });

  it("documento arquivado não recebe nova versão; depois de restaurado, recebe", async () => {
    const d = await createDoc("sec");
    await documents("archive", "sec", { id: d.id });
    const ticket = await stage("sec", PDF);
    await expectCode(documents("addVersion", "sec", { id: d.id, uploadId: ticket.uploadId }), "conflict");
    expect(await exists(ticket.path)).toBe(true);
    const [files] = await bucket().getFiles({ prefix: `documents/${d.id}/` });
    expect(files).toHaveLength(0);

    await documents("restore", "sec", { id: d.id });
    const ok = await documents<InstitutionalDocument>("addVersion", "sec", { id: d.id, uploadId: ticket.uploadId });
    expect(ok.versions).toHaveLength(2);
  });

  it("conteúdo diferente do tipo declarado é recusado também em nova versão", async () => {
    const d = await createDoc("sec");
    const ticket = await stage("sec", Buffer.from("texto simples"), "falso.pdf", "application/pdf");
    await expectCode(documents("addVersion", "sec", { id: d.id, uploadId: ticket.uploadId }), "invalid");
    expect((await stored(d.id)).versions).toHaveLength(1);
  });
});

describe("compartilhamento", () => {
  it("setAccess recalcula readers (documento e índice), registra histórico e avisa o novo público", async () => {
    const d = await createDoc("sec");
    expect((await stored(d.id)).readers).toEqual(["d:secretaria", "u:sec"]);
    const next = await documents<InstitutionalDocument>("setAccess", "sec", { id: d.id, access: { scope: "people", departmentId: null, roleIds: ["presidente"], userIds: ["fin", "fin"] } });
    expect(next.access).toEqual({ scope: "people", roleIds: [], userIds: ["fin"] });
    const data = await stored(d.id);
    expect(data.readers).toEqual(["u:fin", "u:sec"]);
    expect((await db.doc(`searchIndex/document__${d.id}`).get()).data()!.readers).toEqual(data.readers);
    expect(next.history.at(-1)).toMatchObject({ action: "shared", summary: "Compartilhamento alterado para: Pessoas específicas" });

    const notes = await db.collection("notifications").where("recipientId", "==", "fin").get();
    expect(notes.docs.map((n) => n.data().kind)).toContain("document_shared");
    expect(notes.docs[0].data().href).toBe(`/documentos/${d.id}`);

    const audit = (await auditFor(d.id)).find((a) => a.action === "documents.setAccess")!;
    expect(audit.details).toMatchObject({ from: "department", to: "people", people: 1, changed: true });
    expect(JSON.stringify(audit)).not.toContain("u:fin");
  });

  it("quem edita pelo departamento e deixa de ver o documento recebe o estado que gravou; depois, vale o novo público", async () => {
    await db.doc("roles/secretario").update({ permissions: ["documents.view", "documents.create", "documents.edit"] });
    await createMember("sec3", "Secretaria Três Teste", "secretario");
    const d = await createDoc("pres", { access: { scope: "department", roleIds: [], userIds: [] } });
    const next = await documents<InstitutionalDocument>("setAccess", "sec3", { id: d.id, access: { scope: "people", roleIds: [], userIds: ["fin"] } });
    expect(next.access).toEqual({ scope: "people", roleIds: [], userIds: ["fin"] });
    expect((await stored(d.id)).readers).toEqual(["u:fin", "u:pres"]);
    await expectCode(documents("update", "sec3", { id: d.id, input: { name: "Outro nome" } }), "forbidden");
  });

  it("quem só vê o documento não altera o compartilhamento", async () => {
    const d = await createDoc("sec", { access: ALL });
    await expectCode(documents("setAccess", "mkt", { id: d.id, access: ALL }), "forbidden");
    await expectCode(documents("setAccess", "ass", { id: d.id, access: ALL }), "forbidden");
  });

  it("quem não vê o documento recebe recusa (sem revelar o conteúdo)", async () => {
    const d = await createDoc("sec");
    await expectCode(documents("update", "fin", { id: d.id, input: { name: "Outro nome" } }), "forbidden");
  });
});

describe("edição, situação e arquivamento", () => {
  it("edita metadados com validação e recalcula o público quando o departamento muda", async () => {
    const d = await createDoc("sec", { access: { scope: "department", roleIds: [], userIds: [] } });
    const next = await documents<InstitutionalDocument>("update", "sec", {
      id: d.id,
      input: { name: "Estatuto consolidado", departmentId: "presidencia", categoryId: "atas-de-reunioes", links: null },
    });
    expect(next).toMatchObject({ name: "Estatuto consolidado", departmentId: "presidencia", categoryId: "atas-de-reunioes", links: {} });
    expect((await stored(d.id)).readers).toEqual(["d:presidencia", "u:sec"]);
    await expectCode(documents("update", "sec", { id: d.id, input: { categoryId: "nao-existe" } }), "invalid");
    await expectCode(documents("update", "sec", { id: d.id, input: { status: "archived" } }), "invalid");
    await expectCode(documents("update", "sec", { id: d.id, input: { versions: [] } }), "invalid");
  });

  it("marcar como vigente exige documents.approve ou ser o criador", async () => {
    const d = await createDoc("fin", { departmentId: "financeiro", status: "draft", categoryId: "relatorios-financeiros", access: { scope: "department", roleIds: [], userIds: [] } });
    await createMember("fin2", "Financeiro Dois Teste", "diretor-financeiro");
    await expectCode(documents("update", "fin2", { id: d.id, input: { status: "current" } }), "forbidden");
    // Outros campos continuam editáveis por quem tem documents.edit no departamento.
    await documents("update", "fin2", { id: d.id, input: { description: "Revisado" } });
    const byCreator = await documents<InstitutionalDocument>("update", "fin", { id: d.id, input: { status: "current" } });
    expect(byCreator.status).toBe("current");
    expect(byCreator.history.at(-1)).toMatchObject({ action: "status", summary: "Situação alterada para Vigente" });
    await documents("update", "fin", { id: d.id, input: { status: "draft" } });
    const byApprover = await documents<InstitutionalDocument>("update", "pres", { id: d.id, input: { status: "current" } });
    expect(byApprover.status).toBe("current");
  });

  it("arquivar e restaurar: criador ou documents.archive; nada é apagado", async () => {
    const ticket = await stage("sec", PDF);
    const d = await createDoc("sec", { access: ALL }, ticket.uploadId);
    await expectCode(documents("archive", "fin", { id: d.id }), "forbidden");
    const archived = await documents<InstitutionalDocument>("archive", "sec", { id: d.id });
    expect(archived.status).toBe("archived");
    expect(archived.versions).toEqual(d.versions);
    expect(await exists(d.versions[0].file!.path!)).toBe(true);
    expect((await db.doc(`searchIndex/document__${d.id}`).get()).data()!.archived).toBe(true);
    await expectCode(documents("archive", "sec", { id: d.id }), "conflict");
    // Arquivado: a situação só muda restaurando.
    await expectCode(documents("update", "sec", { id: d.id, input: { status: "draft" } }), "conflict");
    // Outros dados continuam editáveis.
    await documents("update", "sec", { id: d.id, input: { description: "Mantido para consulta" } });

    await expectCode(documents("restore", "fin", { id: d.id }), "forbidden");
    const restored = await documents<InstitutionalDocument>("restore", "pres", { id: d.id });
    expect(restored.status).toBe("current");
    await expectCode(documents("restore", "pres", { id: d.id }), "conflict");

    const actions = (await auditFor(d.id)).map((a) => a.action).sort();
    expect(actions).toEqual(["documents.archive", "documents.create", "documents.restore", "documents.update"]);
  });

  it("documento inexistente", async () => {
    await expectCode(documents("archive", "sec", { id: "nao-existe" }), "not_found");
    await expectCode(documents("archive", "sec", { id: "../x" }), "invalid");
  });
});

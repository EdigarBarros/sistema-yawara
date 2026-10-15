import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eventDoc } from "@/lib/firestore-model";
import type { AtleticaEvent, ContentItem } from "@/types";
import { MAX_FILES_PER_CALL, marketingActions } from "../src/modules/marketing";
import { systemActions } from "../src/modules/system";
import { auditFor, bucket, caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const marketing = caller("marketing", marketingActions);
const system = caller("system", systemActions);

const ALL = { scope: "all", roleIds: [], userIds: [] };
const NOW = "2026-10-14T12:00:00.000Z";

/** JPEG mínimo de verdade (SOI + APP0/JFIF + EOI). */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0xff, 0xd9,
]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

function contentInput(over: Record<string, unknown> = {}) {
  return {
    title: "Arte principal da Calourada",
    type: "arte",
    responsibleId: "assmkt",
    publishDate: "2026-11-10",
    channels: ["instagram_feed", "instagram_stories"],
    briefing: "Arte de divulgação da Calourada para o feed e os stories.",
    notes: "Usar a identidade visual nova",
    links: [{ label: "Pasta de referências", url: "https://example.org/referencias" }],
    ...over,
  };
}

async function createContent(uid = "mkt", over: Record<string, unknown> = {}, requestId?: string) {
  return marketing<ContentItem>("create", uid, contentInput(over), requestId);
}

async function stored(id: string) {
  return (await db.doc(`contents/${id}`).get()).data()!;
}

/** Emite o tíquete pelo próprio servidor e envia o conteúdo para a área temporária (como o navegador faria). */
async function stage(uid: string, content: Buffer, fileName = "arte.jpg", contentType = "image/jpeg", targetId?: string) {
  const ticket = await system<{ uploadId: string; path: string; fileName: string }>("prepareUpload", uid, {
    purpose: "marketingFile",
    fileName,
    size: content.length,
    contentType,
    ...(targetId ? { targetId } : {}),
  });
  // O SDK do navegador grava um token de download público nos metadados; o servidor precisa removê-lo.
  await bucket().file(ticket.path).save(content, { contentType, metadata: { metadata: { firebaseStorageDownloadTokens: "token-publico-de-teste" } } });
  return ticket;
}

async function exists(path: string) {
  const [ok] = await bucket().file(path).exists();
  return ok;
}

async function notificationsOf(kind: string) {
  const snap = await db.collection("notifications").where("kind", "==", kind).get();
  return snap.docs.map((d) => d.data());
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("criação", () => {
  it("quem tem marketing.create cria; servidor define código, autor, datas, etapa, readers, histórico, índice e auditoria", async () => {
    const c = await createContent("evt");
    expect(c.code).toMatch(/^MKT-\d{4}-001$/);
    expect(c.createdBy).toBe("evt");
    expect(c.status).toBe("briefing");
    expect(c.files).toEqual([]);
    expect(c.access).toEqual(ALL);
    expect(c.history).toHaveLength(1);
    expect(c.history[0]).toMatchObject({ action: "created", actorId: "evt", summary: "Conteúdo criado com briefing" });
    expect(c.createdAt).toBe(c.updatedAt);
    expect(c).not.toHaveProperty("readers");

    const data = await stored(c.id);
    // Público padrão (todos) + criador + responsável.
    expect(data.readers).toEqual(["all", "u:assmkt", "u:evt"]);
    const index = (await db.doc(`searchIndex/content__${c.id}`).get()).data()!;
    expect(index.readers).toEqual(data.readers);
    expect(index.module).toBe("marketing");
    expect(index.terms).toContain("calourada");

    const logs = await auditFor(c.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "marketing.create", module: "marketing", actorId: "evt", outcome: "success", resourceType: "content" });
    expect(logs[0].summary).toContain(c.code);

    const second = await createContent("mkt");
    expect(second.code).toMatch(/^MKT-\d{4}-002$/);
  });

  it("perfis sem marketing.create não criam conteúdos", async () => {
    await expectCode(createContent("sec"), "forbidden");
    await expectCode(createContent("fin"), "forbidden");
    await expectCode(marketing("create", undefined, contentInput()), "unauthenticated");
  });

  it("campos controlados pelo servidor enviados pelo cliente são recusados", async () => {
    for (const extra of [{ createdBy: "pres" }, { readers: ["all"] }, { id: "x" }, { status: "approved" }, { code: "MKT-1" }, { files: [] }, { createdAt: NOW }]) {
      await expectCode(createContent("mkt", extra), "invalid");
    }
    await expectCode(createContent("mkt", { access: { ...ALL, extra: true } }), "invalid");
    await expectCode(createContent("mkt", { links: [{ label: "x", url: "https://example.org", extra: 1 }] }), "invalid");
  });

  it("valida nome, briefing, canais, links, responsável, vínculos e público", async () => {
    await createMember("inativo", "Inativo Teste", "assessor-marketing", { status: "inactive" });
    await expectCode(createContent("mkt", { title: "ab" }), "invalid");
    await expectCode(createContent("mkt", { briefing: "curto" }), "invalid");
    const noChannel = await expectCode(createContent("mkt", { channels: [] }), "invalid");
    expect(noChannel.message).toMatch(/canal/);
    await expectCode(createContent("mkt", { channels: ["facebook"] }), "invalid");
    for (const url of ["ftp://example.org/a", "javascript:alert(1)", "example.org", "https://"]) {
      const e = await expectCode(createContent("mkt", { links: [{ label: "Ref", url }] }), "invalid");
      expect(e.message).toMatch(/http:\/\/ ou https:\/\//);
    }
    await expectCode(createContent("mkt", { publishDate: "2026-02-30" }), "invalid");
    const e1 = await expectCode(createContent("mkt", { responsibleId: "ninguem" }), "invalid");
    expect(e1.message).toMatch(/não é integrante/);
    const e2 = await expectCode(createContent("mkt", { responsibleId: "inativo" }), "invalid");
    expect(e2.message).toMatch(/desativada/);
    await expectCode(createContent("mkt", { responsibleId: "../members/pres" }), "invalid");
    await expectCode(createContent("mkt", { campaignId: "nao-existe" }), "invalid");
    await expectCode(createContent("mkt", { eventId: "nao-existe" }), "invalid");
    await expectCode(createContent("mkt", { access: { scope: "department", roleIds: [], userIds: [] } }), "invalid");
    await expectCode(createContent("mkt", { access: { scope: "department", departmentId: "nao-existe", roleIds: [], userIds: [] } }), "invalid");
    await expectCode(createContent("mkt", { access: { scope: "people", roleIds: [], userIds: [] } }), "invalid");
    expect((await db.collection("contents").get()).size).toBe(0);
  });

  it("vincula campanha e evento existentes e visíveis; campos opcionais vazios não são gravados", async () => {
    const ev: AtleticaEvent = {
      id: "evt-calourada",
      code: "EVT-2026-001",
      name: "Calourada",
      description: "",
      objective: "",
      type: "festa",
      date: "2026-11-20",
      time: "20:00",
      location: "Quadra",
      departmentId: "eventos",
      responsibleIds: ["evt"],
      access: { scope: "all", roleIds: [], userIds: [] },
      status: "planning",
      schedule: [],
      tasks: [],
      suppliers: [],
      createdBy: "evt",
      createdAt: NOW,
      updatedAt: NOW,
      history: [],
    };
    await db.doc(`events/${ev.id}`).set(eventDoc(ev));
    await db.doc("campaigns/cmp-1").set({
      code: "RIFA-2026-001",
      name: "Rifa de teste",
      departmentId: "financeiro",
      createdBy: "fin",
      access: { view: { scope: "all", roleIds: [], userIds: [] }, sell: ALL, buyerData: { scope: "board", roleIds: [], userIds: [] } },
      readers: ["all", "u:fin"],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const c = await createContent("mkt", { campaignId: "cmp-1", eventId: ev.id, notes: "", publishDate: "" });
    expect(c.campaignId).toBe("cmp-1");
    expect(c.eventId).toBe(ev.id);
    expect(c).not.toHaveProperty("notes");
    expect(c).not.toHaveProperty("publishDate");
    const data = await stored(c.id);
    expect(data).not.toHaveProperty("notes");

    // Assessora de Marketing não tem events.view: não pode vincular eventos (nem saber se existem).
    const e = await expectCode(createContent("assmkt", { eventId: ev.id }), "invalid");
    expect(e.message).toMatch(/não existe ou não está disponível/);
  });

  it("módulo desativado recusa as operações", async () => {
    const c = await createContent("mkt");
    await db.doc("settings/system").update({ "modules.marketing": false });
    await expectCode(createContent("mkt"), "unavailable");
    await expectCode(marketing("update", "mkt", { id: c.id, input: { title: "Outro nome" } }), "unavailable");
    await expectCode(marketing("setStatus", "mkt", { id: c.id, status: "production" }), "unavailable");
  });
});

describe("edição e público", () => {
  it("o responsável sem marketing.edit edita o próprio conteúdo; quem não é criador, responsável nem editor não edita", async () => {
    // "evt" (Diretor de Eventos) tem marketing.view/create, mas não marketing.edit.
    const c = await createContent("mkt", { responsibleId: "evt" });
    const edited = await marketing<ContentItem>("update", "evt", { id: c.id, input: { title: "Arte da Calourada (versão final)" } });
    expect(edited.title).toBe("Arte da Calourada (versão final)");
    expect(edited.history.map((h) => h.action)).toEqual(["created", "updated"]);
    expect(edited.history.at(-1)!.actorId).toBe("evt");

    // "ext" vê o conteúdo (público "todos"), mas não pode editar.
    await expectCode(marketing("update", "ext", { id: c.id, input: { title: "Outro nome" } }), "forbidden");
    // Sem marketing.view: nem vê.
    await expectCode(marketing("update", "sec", { id: c.id, input: { title: "Outro nome" } }), "forbidden");
    // Com marketing.edit: edita.
    const byEditor = await marketing<ContentItem>("update", "assmkt", { id: c.id, input: { notes: null, publishDate: null, links: [] } });
    expect(byEditor.notes).toBeUndefined();
    expect(byEditor.publishDate).toBeUndefined();
    expect(byEditor.links).toEqual([]);
    const data = await stored(c.id);
    expect(data).not.toHaveProperty("notes");
    expect(data).not.toHaveProperty("publishDate");
    expect(data.title).toBe("Arte da Calourada (versão final)");

    // Edição sem mudança não grava nada.
    await marketing("update", "assmkt", { id: c.id, input: { title: "Arte da Calourada (versão final)" } });
    expect((await stored(c.id)).history).toHaveLength(3);

    const logs = await auditFor(c.id);
    expect(logs.filter((l) => l.action === "marketing.update")).toHaveLength(2);
  });

  it("mudar o público (compartilhar) ou o responsável recalcula readers e o índice, e registra no histórico", async () => {
    const c = await createContent("mkt", { access: { scope: "people", roleIds: [], userIds: ["assmkt"] } });
    expect((await stored(c.id)).readers).toEqual(["u:assmkt", "u:mkt"]);
    // "evt" não vê o conteúdo.
    await expectCode(marketing("update", "evt", { id: c.id, input: { title: "Outro nome" } }), "forbidden");

    // Arte compartilhada com o departamento de Eventos.
    const shared = await marketing<ContentItem>("update", "mkt", {
      id: c.id,
      input: { access: { scope: "department", departmentId: "eventos", roleIds: ["ignorado"], userIds: ["ignorado"] } },
    });
    expect(shared.access).toEqual({ scope: "department", departmentId: "eventos", roleIds: [], userIds: [] });
    expect(shared.history.map((h) => h.action)).toEqual(["created", "updated", "shared"]);
    let data = await stored(c.id);
    expect(data.readers).toEqual(["d:eventos", "u:assmkt", "u:mkt"]);
    expect((await db.doc(`searchIndex/content__${c.id}`).get()).data()!.readers).toEqual(data.readers);

    // Agora "evt" (departamento Eventos) vê; "ext" (Extensão) não.
    const seenByEvents = await marketing<ContentItem>("update", "mkt", { id: c.id, input: { responsibleId: "evt" } });
    expect(seenByEvents.responsibleId).toBe("evt");
    data = await stored(c.id);
    expect(data.readers).toEqual(["d:eventos", "u:evt", "u:mkt"]);
    await expectCode(marketing("setStatus", "ext", { id: c.id, status: "production" }), "forbidden");

    const logs = await auditFor(c.id);
    const update = logs.find((l) => l.action === "marketing.update" && l.details?.accessChanged === true)!;
    expect(update.details).toMatchObject({ scope: "department" });
    expect(update.summary).toContain("access");
  });
});

describe("etapas", () => {
  it("só quem tem marketing.approve aprova; depois de aprovado, quem não aprova só marca como publicado", async () => {
    const c = await createContent("assmkt", { responsibleId: "assmkt" });
    const prod = await marketing<ContentItem>("setStatus", "assmkt", { id: c.id, status: "production" });
    expect(prod.status).toBe("production");
    await marketing("setStatus", "assmkt", { id: c.id, status: "review" });
    const denied = await expectCode(marketing("setStatus", "assmkt", { id: c.id, status: "approved" }), "forbidden");
    expect(denied.message).toMatch(/Aprovado/);
    await expectCode(marketing("setStatus", "ext", { id: c.id, status: "approved" }), "forbidden");
    await expectCode(marketing("setStatus", "mkt", { id: c.id, status: "review" }), "conflict");

    const approved = await marketing<ContentItem>("setStatus", "mkt", { id: c.id, status: "approved" });
    expect(approved.status).toBe("approved");
    expect(approved.history.at(-1)).toMatchObject({ action: "status", actorId: "mkt", summary: "Etapa alterada para Aprovado" });

    // Sem marketing.approve, de "Aprovado" só pode ir para "Publicado".
    await expectCode(marketing("setStatus", "assmkt", { id: c.id, status: "production" }), "forbidden");
    const published = await marketing<ContentItem>("setStatus", "assmkt", { id: c.id, status: "published" });
    expect(published.status).toBe("published");

    const logs = (await auditFor(c.id)).filter((l) => l.action === "marketing.setStatus");
    expect(logs.map((l) => `${l.details.from}>${l.details.to}`).sort()).toEqual(["approved>published", "briefing>production", "production>review", "review>approved"].sort());
  });

  it("aprovação avisa a diretoria que pode ver o conteúdo (menos quem aprovou)", async () => {
    // Público "todos": toda a diretoria com acesso ao Marketing é avisada.
    const open = await createContent("assmkt");
    await marketing("setStatus", "mkt", { id: open.id, status: "approved" });
    let notes = await notificationsOf("content_approved");
    let recipients = notes.map((n) => n.recipientId).sort();
    // Diretoria com marketing.view: presidência, vice, eventos e extensão (secretaria e financeiro não têm Marketing).
    expect(recipients).toEqual(["evt", "ext", "pres", "vice"]);
    expect(notes[0]).toMatchObject({ title: "Material aprovado", href: `/marketing?item=${open.id}`, actorId: "mkt" });
    expect(notes[0].body).toContain(open.title);

    // Público restrito: só a diretoria que pode abrir o conteúdo (a presidência não está no público).
    await db.recursiveDelete(db.collection("notifications"));
    const restricted = await createContent("assmkt", { access: { scope: "people", roleIds: [], userIds: ["mkt", "ext"] } });
    await marketing("setStatus", "mkt", { id: restricted.id, status: "approved" });
    notes = await notificationsOf("content_approved");
    recipients = notes.map((n) => n.recipientId).sort();
    expect(recipients).toEqual(["ext"]);
    // A responsável (assessora, fora da diretoria) não é avisada — como no modo demonstração.
    expect(recipients).not.toContain("assmkt");
  });

  it("cancelar (arquivar) exige marketing.archive — nem o criador sem a permissão cancela", async () => {
    const c = await createContent("evt", { responsibleId: "evt" });
    await expectCode(marketing("setStatus", "evt", { id: c.id, status: "cancelled" }), "forbidden");
    await expectCode(marketing("setStatus", "assmkt", { id: c.id, status: "cancelled" }), "forbidden");
    const cancelled = await marketing<ContentItem>("setStatus", "mkt", { id: c.id, status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect((await db.doc(`searchIndex/content__${c.id}`).get()).data()!.archived).toBe(true);
    // O registro e o histórico permanecem; quem edita pode reabrir para o fluxo.
    const reopened = await marketing<ContentItem>("setStatus", "evt", { id: c.id, status: "briefing" });
    expect(reopened.status).toBe("briefing");
    expect((await db.doc(`searchIndex/content__${c.id}`).get()).data()!.archived).toBe(false);
  });

  it("repetir a mesma requisição não duplica o conteúdo nem o código", async () => {
    const requestId = randomUUID();
    const a = await createContent("mkt", {}, requestId);
    const b = await createContent("mkt", {}, requestId);
    expect(b.id).toBe(a.id);
    expect(b.code).toBe(a.code);
    expect((await db.collection("contents").get()).size).toBe(1);
    expect((await auditFor(a.id)).filter((l) => l.action === "marketing.create")).toHaveLength(1);
  });
});

describe("arquivos", () => {
  it("JPEG real: conferido, copiado para marketing/{id}/ sem token público, com SHA-256, histórico e auditoria", async () => {
    const c = await createContent("mkt");
    const ticket = await stage("assmkt", JPEG, "arte final.jpg", "image/jpeg", c.id);
    const requestId = randomUUID();
    const updated = await marketing<ContentItem>("addFiles", "assmkt", { id: c.id, uploadIds: [ticket.uploadId] }, requestId);
    expect(updated.files).toHaveLength(1);
    const file = updated.files[0];
    expect(file).toMatchObject({ name: "arte final.jpg", size: JPEG.length, mimeType: "image/jpeg" });
    expect(file.path).toBe(`marketing/${c.id}/${ticket.uploadId}-arte final.jpg`);
    expect(file.sha256).toBe(createHash("sha256").update(JPEG).digest("hex"));
    expect(await exists(file.path!)).toBe(true);
    expect(await exists(ticket.path)).toBe(false);
    const [meta] = await bucket().file(file.path!).getMetadata();
    expect(meta.contentType).toBe("image/jpeg");
    expect(meta.metadata?.firebaseStorageDownloadTokens ?? null).toBeNull();
    const upload = (await db.doc(`uploads/${ticket.uploadId}`).get()).data()!;
    expect(upload.status).toBe("attached");
    expect(upload.attachedTo).toBe(`contents/${c.id}`);
    expect(updated.history.at(-1)).toMatchObject({ action: "attachment", actorId: "assmkt", summary: "1 arquivo(s) anexado(s)" });

    // Repetição da mesma requisição: mesmo resultado, nada duplicado.
    const again = await marketing<ContentItem>("addFiles", "assmkt", { id: c.id, uploadIds: [ticket.uploadId] }, requestId);
    expect(again.files).toHaveLength(1);
    // Outra requisição com o mesmo envio: o arquivo não é anexado de novo.
    const other = await marketing<ContentItem>("addFiles", "assmkt", { id: c.id, uploadIds: [ticket.uploadId] });
    expect(other.files).toHaveLength(1);
    expect((await stored(c.id)).files).toHaveLength(1);

    const logs = (await auditFor(c.id)).filter((l) => l.action === "marketing.addFiles");
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toMatchObject({ files: 1, bytes: JPEG.length });
    // Sem nomes de arquivo na auditoria.
    expect(JSON.stringify(logs[0])).not.toContain("arte final");
  });

  it("vários arquivos num envio (até 10); PDF e JPEG juntos", async () => {
    const c = await createContent("mkt");
    const t1 = await stage("mkt", JPEG, "a.jpg");
    const t2 = await stage("mkt", PDF, "roteiro.pdf", "application/pdf");
    const updated = await marketing<ContentItem>("addFiles", "mkt", { id: c.id, uploadIds: [t1.uploadId, t2.uploadId] });
    expect(updated.files.map((f) => f.mimeType)).toEqual(["image/jpeg", "application/pdf"]);
    expect(updated.files.every((f) => f.path!.startsWith(`marketing/${c.id}/`))).toBe(true);

    const tooMany = Array.from({ length: MAX_FILES_PER_CALL + 1 }, () => randomUUID().replace(/-/g, ""));
    const e = await expectCode(marketing("addFiles", "mkt", { id: c.id, uploadIds: tooMany }), "invalid");
    expect(e.message).toMatch(/no máximo 10/);
    await expectCode(marketing("addFiles", "mkt", { id: c.id, uploadIds: [t1.uploadId, t1.uploadId] }), "invalid");
    await expectCode(marketing("addFiles", "mkt", { id: c.id, uploadIds: [] }), "invalid");
  });

  it("tíquete recusa arquivo grande demais ou de tipo não aceito; conteúdo diferente do declarado é recusado ao anexar", async () => {
    const tooBig = await expectCode(
      system("prepareUpload", "mkt", { purpose: "marketingFile", fileName: "video.mp4", size: 50 * 1024 * 1024 + 1, contentType: "video/mp4" }),
      "invalid",
    );
    expect(tooBig.message).toMatch(/50 MB/);
    await expectCode(system("prepareUpload", "mkt", { purpose: "marketingFile", fileName: "logo.svg", size: 100, contentType: "image/svg+xml" }), "invalid");
    await expectCode(system("prepareUpload", "mkt", { purpose: "marketingFile", fileName: "pagina.html", size: 100, contentType: "text/html" }), "invalid");
    await expectCode(system("prepareUpload", "mkt", { purpose: "marketingFile", fileName: "nota.txt", size: 100, contentType: "text/plain" }), "invalid");
    // Sem acesso ao Marketing: nem emite tíquete.
    await expectCode(system("prepareUpload", "sec", { purpose: "marketingFile", fileName: "a.jpg", size: 100, contentType: "image/jpeg" }), "forbidden");

    const c = await createContent("mkt");
    const fake = await stage("mkt", Buffer.from("<html><script>alert(1)</script></html>"), "falso.jpg", "image/jpeg");
    await expectCode(marketing("addFiles", "mkt", { id: c.id, uploadIds: [fake.uploadId] }), "invalid");
    expect((await db.doc(`uploads/${fake.uploadId}`).get()).data()!.status).toBe("rejected");
    expect(await exists(fake.path)).toBe(false);
    expect((await stored(c.id)).files).toEqual([]);

    // PDF declarado como imagem também é recusado (tipo real diferente do declarado).
    const mismatch = await stage("mkt", PDF, "arte.jpg", "image/jpeg");
    await expectCode(marketing("addFiles", "mkt", { id: c.id, uploadIds: [mismatch.uploadId] }), "invalid");
  });

  it("quem não pode editar o conteúdo não anexa; envio de outra pessoa não é aceito", async () => {
    const c = await createContent("mkt");
    const ticket = await stage("ext", JPEG);
    // "ext" vê, mas não edita: recusado antes de mover o arquivo.
    await expectCode(marketing("addFiles", "ext", { id: c.id, uploadIds: [ticket.uploadId] }), "forbidden");
    expect(await exists(ticket.path)).toBe(true);
    expect((await db.doc(`uploads/${ticket.uploadId}`).get()).data()!.status).toBe("pending");
    // Envio feito por outra pessoa não pode ser anexado por quem edita.
    await expectCode(marketing("addFiles", "mkt", { id: c.id, uploadIds: [ticket.uploadId] }), "forbidden");
    expect((await stored(c.id)).files).toEqual([]);
    await expectCode(marketing("addFiles", "mkt", { id: "nao-existe", uploadIds: [ticket.uploadId] }), "not_found");
  });
});

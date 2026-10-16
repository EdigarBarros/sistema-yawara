/**
 * Envio de arquivos: nome guardado pelo tipo real, reserva atômica do tíquete,
 * prazo do tíquete × limpeza diária e compensação quando a preparação falha.
 * Dados fictícios, criados só para o teste.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentItem, InstitutionalDocument } from "@/types";
import { Timestamp } from "../src/core/admin";
import { loadActorOutsideTx, registerActionsForTests, type MutationAction, type PrepareContext } from "../src/core/dispatch";
import {
  attachmentDisposition,
  EXTENSION_BY_MIME,
  extensionOf,
  finalizeUpload,
  FINALIZE_GRACE_MS,
  MIME_BY_KIND,
  officeNameMatches,
  safeFileName,
  storedFileName,
} from "../src/core/files";
import { documentsActions } from "../src/modules/documents";
import { financeActions, type StoredEntry } from "../src/modules/finance";
import { cleanupUploadsOnce } from "../src/modules/maintenance";
import { marketingActions } from "../src/modules/marketing";
import { systemActions } from "../src/modules/system";
import { bucket, caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const documents = caller("documents", documentsActions);
const finance = caller("finance", financeActions);
const marketing = caller("marketing", marketingActions);
const system = caller("system", systemActions);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
/** "PDF" poliglota: começa com a assinatura de PDF e segue com HTML. */
const PDF_POLYGLOT = Buffer.from("%PDF-1.4\n<html><body><script>alert('teste')</script></body></html>\n");
const BATCH = Buffer.from("@echo off\r\necho arquivo de teste\r\n");
const HTML = Buffer.from("<!doctype html><html><body><script>alert('teste')</script></body></html>\n");
/** Cabeçalho de pacote ZIP (Office/ODF). */
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)]);
/** JPEG mínimo de verdade (SOI + APP0/JFIF + EOI). */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const ALL = { scope: "all", roleIds: [], userIds: [] };

type Purpose = "document" | "financeReceipt" | "marketingFile";

/** Emite o tíquete pelo servidor e envia o conteúdo para a área temporária (como o navegador faria). */
async function stage(uid: string, purpose: Purpose, content: Buffer, fileName: string, contentType: string) {
  const ticket = await system<{ uploadId: string; path: string; fileName: string }>("prepareUpload", uid, { purpose, fileName, size: content.length, contentType });
  await bucket().file(ticket.path).save(content, { contentType, metadata: { metadata: { firebaseStorageDownloadTokens: "token-publico-de-teste" } } });
  return ticket;
}

async function exists(path: string) {
  const [ok] = await bucket().file(path).exists();
  return ok;
}

async function ticketOf(uploadId: string) {
  return (await db.doc(`uploads/${uploadId}`).get()).data()!;
}

async function objectsUnder(prefix: string) {
  const [files] = await bucket().getFiles({ prefix });
  return files.map((f) => f.name);
}

function docInput(over: Record<string, unknown> = {}) {
  return {
    name: "Ata da assembleia",
    description: "",
    categoryId: "estatuto",
    departmentId: "secretaria",
    status: "current",
    access: ALL,
    ...over,
  };
}

function entryInput(over: Record<string, unknown> = {}) {
  return {
    type: "income",
    description: "Ingressos de teste",
    categoryId: "rec-ingressos-de-eventos",
    amount: 5000,
    date: "2026-10-10",
    responsibleId: "fin",
    departmentId: "financeiro",
    status: "pending",
    ...over,
  };
}

async function newEntry() {
  return finance<StoredEntry>("create", "fin", { input: entryInput() });
}

/** Contexto de preparação de teste (registra as compensações sem rodá-las). */
function prepareContext(): PrepareContext & { aborts: (() => Promise<void>)[] } {
  const aborts: (() => Promise<void>)[] = [];
  return { requestId: randomUUID(), now: new Date().toISOString(), onAbort: (fn) => aborts.push(fn), aborts };
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nome guardado pelo tipo REAL do conteúdo", () => {
  it("regras do nome: extensão informada trocada pela do tipo detectado, nome-base preservado e limitado", () => {
    expect(storedFileName("Ata assinada.html", "text/plain")).toBe("Ata assinada.txt");
    expect(storedFileName("Relatorio.pdf.bat", "text/plain")).toBe("Relatorio.pdf.txt");
    expect(storedFileName("fatura.html", "application/pdf")).toBe("fatura.pdf");
    expect(storedFileName("script.hta", "text/csv")).toBe("script.csv");
    expect(storedFileName("Comprovante.bat. . ", "application/pdf")).toBe("Comprovante.pdf");
    expect(storedFileName("FOTO.JPEG", "image/jpeg")).toBe("FOTO.jpg");
    expect(storedFileName("estatuto.pdf", "application/pdf")).toBe("estatuto.pdf");
    // Sem extensão (ou só números depois do ponto): o nome inteiro é mantido.
    expect(storedFileName("Ata 15.10", "application/pdf")).toBe("Ata 15.10.pdf");
    expect(storedFileName("contrato", DOCX)).toBe("contrato.docx");
    expect(storedFileName(".htaccess", "text/plain")).toBe("arquivo.txt");
    // Caracteres de direção de texto não disfarçam a extensão.
    expect(storedFileName("fatura‮txt.exe", "application/pdf")).toBe("fatura_txt.pdf");
    const long = storedFileName(`${"á".repeat(300)}.html`, "text/plain");
    expect(Array.from(long).length).toBeLessThanOrEqual(105);
    expect(long.endsWith(".txt")).toBe(true);
    // Emoji no limite não é partido ao meio.
    expect(storedFileName(`${"a".repeat(99)}😀😀.pdf`, "application/pdf")).toBe(`${"a".repeat(99)}😀.pdf`);
    // Determinístico (idempotência): mesmo nome, mesmo resultado.
    expect(storedFileName("Ata assinada.html", "text/plain")).toBe(storedFileName("Ata assinada.html", "text/plain"));
    // Todo tipo aceito tem extensão canônica.
    for (const mime of Object.values(MIME_BY_KIND).flat()) expect(EXTENSION_BY_MIME[mime]).toMatch(/^[a-z0-9]{3,4}$/);
    expect(extensionOf("planilha.XLSX")).toBe("xlsx");
    expect(extensionOf("Ata 15.10")).toBe("");
    expect(safeFileName("a‮b/c")).toBe("a_b_c");
    expect(officeNameMatches("planilha.xlsx", XLSX)).toBe(true);
    expect(officeNameMatches("planilha.xlsx", DOCX)).toBe(false);
    expect(officeNameMatches("qualquer.pdf", "application/pdf")).toBe(true);
    expect(attachmentDisposition("Relatório \"final\".pdf")).toBe(
      `attachment; filename="Relatorio _final_.pdf"; filename*=UTF-8''Relat%C3%B3rio%20%22final%22.pdf`,
    );
  });

  it("F7: texto chamado .html/.bat e PDF poliglota chamado .html ficam com a extensão do tipo real (nome, caminho e Content-Disposition)", async () => {
    const t1 = await stage("sec", "document", HTML, "Ata assinada.html", "text/plain");
    const d = await documents<InstitutionalDocument>("create", "sec", { input: docInput(), uploadId: t1.uploadId });
    const t2 = await stage("sec", "document", BATCH, "Relatorio.pdf.bat", "text/plain");
    await documents("addVersion", "sec", { id: d.id, uploadId: t2.uploadId });
    const t3 = await stage("sec", "document", PDF_POLYGLOT, "fatura.html", "application/pdf");
    const final = await documents<InstitutionalDocument>("addVersion", "sec", { id: d.id, uploadId: t3.uploadId });

    const files = final.versions.map((v) => v.file!);
    expect(files.map((f) => `${f.name} [${f.mimeType}]`)).toEqual(["Ata assinada.txt [text/plain]", "Relatorio.pdf.txt [text/plain]", "fatura.pdf [application/pdf]"]);
    expect(files[0].path).toBe(`documents/${d.id}/v1/${t1.uploadId}-Ata assinada.txt`);
    expect(files[1].path).toBe(`documents/${d.id}/v2/${t2.uploadId}-Relatorio.pdf.txt`);
    expect(files[2].path).toBe(`documents/${d.id}/v3/${t3.uploadId}-fatura.pdf`);
    for (const f of files) {
      expect(f.name).not.toMatch(/\.(html|bat|hta|js)$/i);
      expect(await exists(f.path!)).toBe(true);
      const [meta] = await bucket().file(f.path!).getMetadata();
      expect(meta.contentType).toBe(f.mimeType);
      expect(meta.contentDisposition).toBe(attachmentDisposition(f.name));
      expect(meta.metadata?.firebaseStorageDownloadTokens ?? null).toBeNull();
    }
    // Nenhum objeto com a extensão enganosa foi gravado.
    expect((await objectsUnder(`documents/${d.id}/`)).filter((p) => /\.(html|bat)$/.test(p))).toEqual([]);
  });

  it("Office (ZIP): a extensão do nome precisa corresponder ao tipo declarado; quando corresponde, o nome é mantido", async () => {
    const e = await expectCode(system("prepareUpload", "sec", { purpose: "document", fileName: "planilha.xlsx", size: ZIP.length, contentType: DOCX }), "invalid");
    expect(e.message).toBe("A extensão do arquivo não corresponde ao tipo do documento. Envie o arquivo original, sem renomear.");
    await expectCode(system("prepareUpload", "sec", { purpose: "document", fileName: "programa.exe", size: ZIP.length, contentType: DOCX }), "invalid");

    // Tíquete antigo (emitido antes da regra) com nome incompatível: recusado ao anexar.
    const actor = await loadActorOutsideTx("sec");
    const legacyId = randomUUID().replace(/-/g, "");
    const legacyPath = `staging/sec/${legacyId}/pacote.jar`;
    await db.doc(`uploads/${legacyId}`).set({
      uid: "sec",
      purpose: "document",
      targetId: null,
      fileName: "pacote.jar",
      size: ZIP.length,
      contentType: DOCX,
      maxBytes: 25 * 1024 * 1024,
      path: legacyPath,
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: Timestamp.fromMillis(Date.now() + HOUR),
    });
    await bucket().file(legacyPath).save(ZIP, { contentType: DOCX });
    await expectCode(finalizeUpload(actor, legacyId, "document", "documents/qualquer/v1", prepareContext()), "invalid");
    expect((await ticketOf(legacyId)).status).toBe("rejected");
    expect(await exists(legacyPath)).toBe(false);

    const ok = await stage("sec", "document", ZIP, "Ata.docx", DOCX);
    const d = await documents<InstitutionalDocument>("create", "sec", { input: docInput(), uploadId: ok.uploadId });
    expect(d.versions[0].file).toMatchObject({ name: "Ata.docx", mimeType: DOCX });
  });
});

describe("reserva atômica do tíquete", () => {
  it("duas operações simultâneas com o mesmo envio: exatamente uma anexa; a outra recebe conflito claro", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024, 0x20)]);
    for (let trial = 0; trial < 3; trial++) {
      const [a, b] = [await newEntry(), await newEntry()];
      const ticket = await stage("fin", "financeReceipt", big, "comprovante.pdf", "application/pdf");
      const results = await Promise.allSettled([
        finance<StoredEntry>("attachReceipt", "fin", { id: a.id, uploadId: ticket.uploadId }),
        finance<StoredEntry>("attachReceipt", "fin", { id: b.id, uploadId: ticket.uploadId }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason.code).toBe("conflict");
      expect(failed[0].reason.message).toMatch(/^Este arquivo já (está sendo anexado|foi usado) em outra operação/);

      const winner = (ok[0] as PromiseFulfilledResult<StoredEntry>).value;
      const loser = winner.id === a.id ? b : a;
      expect((await db.doc(`financeEntries/${loser.id}`).get()).data()!.receipt ?? null).toBeNull();
      const t = await ticketOf(ticket.uploadId);
      expect(t.status).toBe("attached");
      expect(t.attachedTo).toBe(`financeEntries/${winner.id}`);
      // Uma única cópia definitiva.
      expect(await objectsUnder(`finance/${winner.id}/`)).toEqual([winner.receipt!.path]);
      expect(await objectsUnder(`finance/${loser.id}/`)).toEqual([]);
    }
  });

  it("tíquete em uso por outra operação ('finalizing') é recusado com conflito, sem tocar no arquivo", async () => {
    const e = await newEntry();
    const ticket = await stage("fin", "financeReceipt", PDF, "comprovante.pdf", "application/pdf");
    await db.doc(`uploads/${ticket.uploadId}`).update({ status: "finalizing", destDir: "finance/outro", claimedAt: new Date().toISOString() });
    const err = await expectCode(finance("attachReceipt", "fin", { id: e.id, uploadId: ticket.uploadId }), "conflict");
    expect(err.message).toBe("Este arquivo já está sendo anexado em outra operação. Aguarde e confira o registro antes de enviar de novo.");
    expect(await exists(ticket.path)).toBe(true);
    expect((await ticketOf(ticket.uploadId)).status).toBe("finalizing");
  });

  it("falha na cópia: a compensação registrada ANTES de copiar descarta o tíquete e não deixa arquivo definitivo", async () => {
    const e = await newEntry();
    const ticket = await stage("fin", "financeReceipt", PDF, "comprovante.pdf", "application/pdf");
    const fileProto = Object.getPrototypeOf(bucket().file("qualquer")) as { copy: (...args: unknown[]) => Promise<unknown> };
    const original = fileProto.copy;
    vi.spyOn(fileProto, "copy").mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
      // A cópia chega a criar o objeto, mas a resposta falha (ex.: conexão interrompida).
      await original.apply(this, args);
      throw new Error("falha simulada na cópia");
    });
    await expectCode(finance("attachReceipt", "fin", { id: e.id, uploadId: ticket.uploadId }), "internal");
    expect((await ticketOf(ticket.uploadId)).status).toBe("discarded");
    expect(await objectsUnder(`finance/${e.id}/`)).toEqual([]);
    expect((await db.doc(`financeEntries/${e.id}`).get()).data()!.receipt ?? null).toBeNull();
  });
});

describe("prazo do tíquete × limpeza diária", () => {
  it("tíquete vencido há mais de 30 min (validade + tolerância) é recusado ao anexar; dentro da tolerância é aceito", async () => {
    const e = await newEntry();
    const late = await stage("fin", "financeReceipt", PDF, "comprovante.pdf", "application/pdf");
    await db.doc(`uploads/${late.uploadId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - FINALIZE_GRACE_MS - MINUTE) });
    const err = await expectCode(finance("attachReceipt", "fin", { id: e.id, uploadId: late.uploadId }), "invalid");
    expect(err.message).toBe("O envio expirou. Envie o arquivo novamente.");
    expect((await ticketOf(late.uploadId)).status).toBe("pending");
    expect(await objectsUnder(`finance/${e.id}/`)).toEqual([]);

    const grace = await stage("fin", "financeReceipt", PDF, "comprovante.pdf", "application/pdf");
    await db.doc(`uploads/${grace.uploadId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 10 * MINUTE) });
    const ok = await finance<StoredEntry>("attachReceipt", "fin", { id: e.id, uploadId: grace.uploadId });
    expect(ok.receipt?.path).toBe(`finance/${e.id}/${grace.uploadId}-comprovante.pdf`);
  });

  it("F5: a limpeza rodando no meio da operação (tíquete criado há 3 h) não apaga o arquivo que está sendo anexado", async () => {
    const e = await newEntry();
    const ticket = await stage("fin", "financeReceipt", PDF, "comprovante.pdf", "application/pdf");
    await db.doc(`uploads/${ticket.uploadId}`).update({ createdAt: new Date(Date.now() - 3 * HOUR).toISOString() });
    // A rotina agendada dispara depois da preparação e antes da confirmação.
    const def = financeActions.attachReceipt as MutationAction<unknown, unknown, unknown>;
    const racing = registerActionsForTests("finance-corrida", {
      attachReceipt: {
        ...def,
        async run(tx, actor, input, ctx, prepared) {
          await cleanupUploadsOnce();
          return def.run(tx, actor, input, ctx, prepared);
        },
      } as MutationAction<unknown, unknown, unknown>,
    });
    const call = caller("finance-corrida", racing);
    const done = await call<StoredEntry>("attachReceipt", "fin", { id: e.id, uploadId: ticket.uploadId });
    expect(done.receipt?.path).toBeTruthy();
    expect(await exists(done.receipt!.path!)).toBe(true);
    expect((await ticketOf(ticket.uploadId)).status).toBe("attached");
    // Mesmo bem depois, um arquivo anexado nunca é removido pela limpeza.
    await cleanupUploadsOnce(Date.now() + 3 * HOUR);
    expect(await exists(done.receipt!.path!)).toBe(true);
    expect((await ticketOf(ticket.uploadId)).status).toBe("attached");
  });

  it("arquivo conferido mas nunca anexado: removido só 2 h depois da conferência (status trocado antes de apagar)", async () => {
    const actor = await loadActorOutsideTx("fin");
    const ticket = await stage("fin", "financeReceipt", PDF, "comprovante.pdf", "application/pdf");
    await db.doc(`uploads/${ticket.uploadId}`).update({ createdAt: new Date(Date.now() - 5 * HOUR).toISOString() });
    const file = await finalizeUpload(actor, ticket.uploadId, "financeReceipt", "finance/orfao", prepareContext());
    expect((await ticketOf(ticket.uploadId)).status).toBe("finalized");

    // Criado há 5 h, mas conferido agora: ainda não é órfão.
    expect((await cleanupUploadsOnce(Date.now())).orphans).toBe(0);
    expect(await exists(file.path!)).toBe(true);
    expect((await ticketOf(ticket.uploadId)).status).toBe("finalized");

    expect((await cleanupUploadsOnce(Date.now() + 2 * HOUR + MINUTE)).orphans).toBe(1);
    expect(await exists(file.path!)).toBe(false);
    expect((await ticketOf(ticket.uploadId)).status).toBe("discarded");
  });

  it("reserva interrompida ('finalizing' há mais de 2 h): a limpeza descarta o tíquete e apaga a cópia parcial", async () => {
    const ticket = await stage("fin", "financeReceipt", PDF, "comprovante.pdf", "application/pdf");
    const old = new Date(Date.now() - 3 * HOUR).toISOString();
    await db.doc(`uploads/${ticket.uploadId}`).update({ status: "finalizing", destDir: "finance/interrompido", claimedAt: old, createdAt: old });
    const partial = `finance/interrompido/${ticket.uploadId}-comprovante.pdf`;
    await bucket().file(partial).save(PDF, { contentType: "application/pdf" });
    const other = "finance/interrompido/outro-envio-comprovante.pdf";
    await bucket().file(other).save(PDF, { contentType: "application/pdf" });

    // Reserva recente não é tocada.
    const fresh = await stage("fin", "financeReceipt", PDF, "novo.pdf", "application/pdf");
    await db.doc(`uploads/${fresh.uploadId}`).update({ status: "finalizing", destDir: "finance/em-andamento", claimedAt: new Date().toISOString(), createdAt: old });

    expect((await cleanupUploadsOnce()).orphans).toBe(1);
    expect((await ticketOf(ticket.uploadId)).status).toBe("discarded");
    expect(await exists(partial)).toBe(false);
    expect(await exists(ticket.path)).toBe(false);
    expect(await exists(other)).toBe(true);
    expect((await ticketOf(fresh.uploadId)).status).toBe("finalizing");
    expect(await exists(fresh.path)).toBe(true);
  });
});

describe("compensação quando a preparação falha no meio", () => {
  it("marketing.addFiles [boa.jpg, falsa.jpg]: nenhum arquivo órfão e o tíquete bom não fica 'finalized'", async () => {
    const c = await marketing<ContentItem>("create", "mkt", {
      title: "Arte de teste",
      type: "arte",
      responsibleId: "mkt",
      publishDate: "2026-11-10",
      channels: ["instagram_feed"],
      briefing: "Arte de divulgação de teste.",
    });
    const good = await stage("mkt", "marketingFile", JPEG, "boa.jpg", "image/jpeg");
    const fake = await stage("mkt", "marketingFile", HTML, "falsa.jpg", "image/jpeg");
    await expectCode(marketing("addFiles", "mkt", { id: c.id, uploadIds: [good.uploadId, fake.uploadId] }), "invalid");

    expect(await objectsUnder(`marketing/${c.id}/`)).toEqual([]);
    expect((await ticketOf(good.uploadId)).status).toBe("discarded");
    expect((await ticketOf(fake.uploadId)).status).toBe("rejected");
    expect((await db.doc(`contents/${c.id}`).get()).data()!.files ?? []).toEqual([]);
    // Nada sobra para a limpeza diária.
    expect((await cleanupUploadsOnce(Date.now() + 3 * HOUR)).orphans).toBe(0);
  });
});

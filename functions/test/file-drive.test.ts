/**
 * Arquivos no Google Drive da Atlética (FILE_STORAGE=drive, implantação
 * gratuita): envio em partes direto para o Drive, conferência ao anexar,
 * compensação, limpeza e leitura pelo servidor com conferência de acesso. O Drive é simulado em memória
 * (a chamada HTTP real fica em core/drive.ts); o resto roda nos emuladores.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN } from "@/lib/access-tokens";
import type { InstitutionalDocument } from "@/types";
import { DRIVE_CHUNK_BYTES } from "../src/core/files";
import { Timestamp } from "firebase-admin/firestore";
import { documentsActions } from "../src/modules/documents";
import { systemActions } from "../src/modules/system";
import { caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const drive = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  sessions: new Map<string, { parts: Buffer[]; total: number; uploadId: string }>(),
  cancelled: [] as string[],
  puts: 0,
}));

vi.mock("../src/core/drive", async () => {
  const { createHash } = await import("node:crypto");
  return {
    async startDriveUpload(_name: string, _mime: string, size: number, uploadId: string) {
      const uri = `https://upload.example/sessao-${uploadId}`;
      drive.sessions.set(uri, { parts: [], total: size, uploadId });
      return uri;
    },
    async putDriveChunk(uri: string, bytes: Buffer, start: number, total: number) {
      drive.puts++;
      const session = drive.sessions.get(uri);
      if (!session) throw new Error("sessão inexistente no Drive simulado");
      const received = session.parts.reduce((n, b) => n + b.length, 0);
      if (start !== received || total !== session.total) throw new Error(`parte fora de ordem: ${start} != ${received}`);
      session.parts.push(Buffer.from(bytes));
      if (received + bytes.length < total) return { done: false };
      const id = `drive-${session.uploadId}`;
      drive.files.set(id, Buffer.concat(session.parts));
      drive.sessions.delete(uri);
      return { done: true, id };
    },
    async cancelDriveUpload(uri: string) {
      drive.cancelled.push(uri);
      drive.sessions.delete(uri);
    },
    async driveFileInfo(id: string) {
      const content = drive.files.get(id)!;
      return { size: content.length, sha256: createHash("sha256").update(content).digest("hex") };
    },
    async renameDriveFile() {},
    async readDriveRange(id: string, start: number, end: number) {
      const content = drive.files.get(id);
      if (!content) throw new Error("arquivo inexistente no Drive simulado");
      return content.subarray(start, end + 1);
    },
    async deleteDriveFile(id: string) {
      drive.files.delete(id);
    },
  };
});

const documents = caller("documents", documentsActions);
const system = caller("system", systemActions);

function pdf(size: number) {
  const head = Buffer.from("%PDF-1.4\n% documento ficticio de teste\n");
  return Buffer.concat([head, Buffer.alloc(size - head.length, 0x41)]);
}

function docInput(over: Record<string, unknown> = {}) {
  return {
    name: "Estatuto social",
    description: "",
    categoryId: "estatuto",
    departmentId: "secretaria",
    status: "current",
    access: { scope: "department", departmentId: "secretaria", roleIds: [], userIds: [] },
    ...over,
  };
}

const part = (content: Buffer, i: number) => content.subarray(i * DRIVE_CHUNK_BYTES, (i + 1) * DRIVE_CHUNK_BYTES).toString("base64");

async function upload(uid: string, content: Buffer, fileName = "estatuto.pdf") {
  const t = await system<{ uploadId: string; chunkBytes: number }>("prepareUpload", uid, { purpose: "document", fileName, size: content.length, contentType: "application/pdf" });
  expect(t.chunkBytes).toBe(DRIVE_CHUNK_BYTES);
  for (let i = 0; i * DRIVE_CHUNK_BYTES < content.length; i++) {
    await system("uploadChunk", uid, { uploadId: t.uploadId, index: i, data: part(content, i) });
  }
  return t.uploadId;
}

/** Lê o arquivo inteiro pelo servidor, como o navegador faz. */
async function readAll(uid: string, uploadId: string) {
  const parts: Buffer[] = [];
  for (let index = 0, got = 0, size = 1; got < size; index++) {
    const r = await system<{ data: string; size: number }>("readFile", uid, { uploadId, index });
    parts.push(Buffer.from(r.data, "base64"));
    got += parts[parts.length - 1].length;
    size = r.size;
  }
  return Buffer.concat(parts);
}

const ticket = async (id: string) => (await db.doc(`uploads/${id}`).get()).data()!;

let previous: string | undefined;
beforeAll(() => {
  previous = process.env.FILE_STORAGE;
  process.env.FILE_STORAGE = "drive";
});
afterAll(() => {
  if (previous === undefined) delete process.env.FILE_STORAGE;
  else process.env.FILE_STORAGE = previous;
});
beforeEach(async () => {
  drive.files.clear();
  drive.sessions.clear();
  drive.cancelled.length = 0;
  drive.puts = 0;
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("arquivos no Google Drive", () => {
  it("envia direto para o Drive em partes: nada fica no banco e o arquivo lido é idêntico", async () => {
    const content = pdf(DRIVE_CHUNK_BYTES * 2 + 777);
    const uploadId = await upload("sec", content);
    expect(drive.puts).toBe(3);
    expect(await ticket(uploadId)).toMatchObject({ nextIndex: 3, driveId: `drive-${uploadId}` });
    expect((await ticket(uploadId)).sessionUri).toBeUndefined();
    expect((await db.collection("fileChunks").get()).size).toBe(0);

    const d = await documents<InstitutionalDocument>("create", "sec", { input: docInput(), uploadId });
    const file = d.versions[0].file!;
    expect(file).toMatchObject({ name: "estatuto.pdf", size: content.length, mimeType: "application/pdf", driveId: `drive-${uploadId}` });
    expect(file.chunks).toBeUndefined();
    expect(file.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(await ticket(uploadId)).toMatchObject({ status: "attached", destDir: `documents/${d.id}/v1` });
    expect((await readAll("sec", uploadId)).equals(content)).toBe(true);
  });

  it("partes: fora de ordem é recusada, repetida não duplica, outra pessoa não envia, incompleto não anexa", async () => {
    const content = pdf(DRIVE_CHUNK_BYTES + 10);
    const t = await system<{ uploadId: string }>("prepareUpload", "sec", { purpose: "document", fileName: "a.pdf", size: content.length, contentType: "application/pdf" });
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 1, data: part(content, 1) }), "invalid");
    await expectCode(system("uploadChunk", "pres", { uploadId: t.uploadId, index: 0, data: part(content, 0) }), "forbidden");
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: Buffer.from("%PDF-curto").toString("base64") }), "invalid");
    await system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: part(content, 0) });
    await system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: part(content, 0) });
    expect(drive.puts).toBe(1);
    await expectCode(documents("create", "sec", { input: docInput(), uploadId: t.uploadId }), "invalid");
    expect((await ticket(t.uploadId)).status).toBe("pending");

    await system("uploadChunk", "sec", { uploadId: t.uploadId, index: 1, data: part(content, 1) });
    await documents("create", "sec", { input: docInput(), uploadId: t.uploadId });
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 1, data: part(content, 1) }), "conflict");
  });

  it("leitura: quem não vê o registro, envio não anexado e pedaço fora do arquivo são recusados", async () => {
    const content = pdf(5000);
    const uploadId = await upload("sec", content);
    await expectCode(system("readFile", "sec", { uploadId, index: 0 }), "forbidden");

    await documents("create", "sec", { input: docInput(), uploadId });
    await expectCode(system("readFile", "ass", { uploadId, index: 0 }), "forbidden");
    await expectCode(system("readFile", "sec", { uploadId, index: 1 }), "invalid");
    await expectCode(system("readFile", "sec", { uploadId: "0".repeat(32), index: 0 }), "forbidden");
  });

  it("falha da operação depois do envio: o arquivo continua no Drive e o envio é reaproveitado", async () => {
    const content = pdf(2000);
    const uploadId = await upload("sec", content);
    await expectCode(documents("create", "sec", { input: docInput({ categoryId: "nao-existe" }), uploadId }), "invalid");
    expect((await ticket(uploadId)).status).toBe("pending");
    expect(drive.files.size).toBe(1);
    await documents("create", "sec", { input: docInput(), uploadId });
    expect((await ticket(uploadId)).status).toBe("attached");
  });

  it("envio abandonado: ao pedir um novo envio, o arquivo vencido da própria pessoa sai do Drive", async () => {
    const old = await upload("sec", pdf(2000));
    const unfinished = await system<{ uploadId: string }>("prepareUpload", "sec", { purpose: "document", fileName: "b.pdf", size: DRIVE_CHUNK_BYTES + 5, contentType: "application/pdf" });
    const past = Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000);
    await db.doc(`uploads/${old}`).update({ expiresAt: past });
    await db.doc(`uploads/${unfinished.uploadId}`).update({ expiresAt: past });
    await upload("sec", pdf(1000));
    expect(drive.files.has(`drive-${old}`)).toBe(false);
    expect(drive.cancelled).toContain(`https://upload.example/sessao-${unfinished.uploadId}`);
    expect((await ticket(old)).status).toBe("discarded");
  });

  it("conteúdo falso é recusado na primeira parte, antes de qualquer byte ir para o Drive", async () => {
    const fake = Buffer.from("isto não é um PDF, é texto simples\n");
    const t = await system<{ uploadId: string }>("prepareUpload", "sec", { purpose: "document", fileName: "falso.pdf", size: fake.length, contentType: "application/pdf" });
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: fake.toString("base64") }), "invalid");
    expect(drive.puts).toBe(0);
    expect(drive.cancelled).toHaveLength(1);
    expect((await ticket(t.uploadId)).status).toBe("rejected");
  });

  it("leitura segue a mesma regra do registro dono: financeiro, marketing e comprovante de venda", async () => {
    /** Arquivo já anexado em `destDir` (tíquete gravado direto, como o servidor faria). */
    async function attached(uploadId: string, destDir: string) {
      drive.files.set(`drive-${uploadId}`, pdf(100));
      await db.doc(`uploads/${uploadId}`).set({ status: "attached", destDir, file: { name: "a.pdf", size: 100, mimeType: "application/pdf", driveId: `drive-${uploadId}` } });
      return uploadId;
    }
    const read = (uid: string, uploadId: string) => system("readFile", uid, { uploadId, index: 0 });

    const fin = await attached("f".repeat(32), "finance/lanc1");
    await read("fin", fin);
    await expectCode(read("mkt", fin), "forbidden");

    await db.doc("contents/k1").set({ readers: [TOKEN.user("mkt")] });
    const mkt = await attached("e".repeat(32), "marketing/k1");
    await read("mkt", mkt);
    await expectCode(read("assmkt", mkt), "forbidden");

    await db.doc("campaigns/c1").set({ readers: [TOKEN.all] });
    await db.doc("campaigns/c1/buyers/s1").set({ readers: [TOKEN.user("ass")] });
    const sale = await attached("d".repeat(32), "campaigns/c1/receipts/s1");
    await expectCode(read("sec", sale), "forbidden");

    // Módulo desativado nas configurações: ninguém lê, nem com a permissão.
    await db.doc("settings/system").set({ modules: { finance: false } }, { merge: true });
    await expectCode(read("fin", fin), "forbidden");
  });

  it("limite de 500 MB por arquivo; vídeo continua recusado; 20 MB é aceito", async () => {
    const ticketOf = (size: number, fileName = "grande.pdf", contentType = "application/pdf") =>
      system("prepareUpload", "sec", { purpose: "document", fileName, size, contentType });
    await ticketOf(20 * 1024 * 1024);
    await expectCode(ticketOf(500 * 1024 * 1024 + 1), "invalid");
    await expectCode(system("prepareUpload", "mkt", { purpose: "marketingFile", fileName: "video.mp4", size: 1000, contentType: "video/mp4" }), "invalid");
  });
});

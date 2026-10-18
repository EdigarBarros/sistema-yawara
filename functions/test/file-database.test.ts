/**
 * Arquivos guardados no próprio banco (FILE_STORAGE=database, implantação
 * gratuita): envio em pedaços pelo servidor, conferência do conteúdo,
 * compensação e limpeza. Dados fictícios, criados só para o teste.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import type { InstitutionalDocument } from "@/types";
import { FILE_CHUNK_BYTES } from "../src/core/files";
import { documentsActions } from "../src/modules/documents";
import { systemActions } from "../src/modules/system";
import { caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const documents = caller("documents", documentsActions);
const system = caller("system", systemActions);

/** PDF fictício com `size` bytes (cabeçalho real + preenchimento). */
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

async function ticketFor(uid: string, size: number, fileName = "estatuto.pdf", contentType = "application/pdf") {
  return system<{ uploadId: string; chunkBytes: number }>("prepareUpload", uid, { purpose: "document", fileName, size, contentType });
}

/** Envia o conteúdo em pedaços, como o navegador faz. */
async function sendChunks(uid: string, uploadId: string, content: Buffer) {
  for (let i = 0; i * FILE_CHUNK_BYTES < content.length; i++) {
    const data = content.subarray(i * FILE_CHUNK_BYTES, (i + 1) * FILE_CHUNK_BYTES).toString("base64");
    await system("uploadChunk", uid, { uploadId, index: i, data });
  }
}

const ticket = async (id: string) => (await db.doc(`uploads/${id}`).get()).data()!;
const chunkDocs = async (uploadId: string) => (await db.collection("fileChunks").where("uploadId", "==", uploadId).get()).docs;

let previous: string | undefined;
beforeAll(() => {
  previous = process.env.FILE_STORAGE;
  process.env.FILE_STORAGE = "database";
});
afterAll(() => {
  if (previous === undefined) delete process.env.FILE_STORAGE;
  else process.env.FILE_STORAGE = previous;
});
beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("arquivos no banco", () => {
  it("envia em pedaços, confere e anexa; o arquivo remontado é idêntico", async () => {
    const content = pdf(FILE_CHUNK_BYTES * 2 + 1234);
    const t = await ticketFor("sec", content.length);
    expect(t.chunkBytes).toBe(FILE_CHUNK_BYTES);
    await sendChunks("sec", t.uploadId, content);

    const d = await documents<InstitutionalDocument>("create", "sec", { input: docInput(), uploadId: t.uploadId });
    const file = d.versions[0].file!;
    expect(file).toMatchObject({ name: "estatuto.pdf", size: content.length, mimeType: "application/pdf", chunks: 3 });
    expect(file.path).toBe(`documents/${d.id}/v1/${t.uploadId}-estatuto.pdf`);
    expect(file.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(await ticket(t.uploadId)).toMatchObject({ status: "attached", destDir: `documents/${d.id}/v1` });

    const docs = (await chunkDocs(t.uploadId)).sort((a, b) => a.get("index") - b.get("index"));
    expect(docs.map((c) => c.id)).toEqual([0, 1, 2].map((i) => `${t.uploadId}_${i}`));
    expect(Buffer.concat(docs.map((c) => Buffer.from(c.get("data")))).equals(content)).toBe(true);
  });

  it("recusa pedaço de outra pessoa, de tamanho errado, fora da sequência ou depois de anexado", async () => {
    const content = pdf(FILE_CHUNK_BYTES + 10);
    const t = await ticketFor("sec", content.length);
    const first = content.subarray(0, FILE_CHUNK_BYTES).toString("base64");
    await expectCode(system("uploadChunk", "pres", { uploadId: t.uploadId, index: 0, data: first }), "forbidden");
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: Buffer.from("curto").toString("base64") }), "invalid");
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 2, data: first }), "invalid");
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: "não é base64!" }), "invalid");
    expect(await chunkDocs(t.uploadId)).toHaveLength(0);

    await sendChunks("sec", t.uploadId, content);
    await documents("create", "sec", { input: docInput(), uploadId: t.uploadId });
    // Depois de anexado, ninguém troca o conteúdo.
    await expectCode(system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: first }), "conflict");
  });

  it("envio incompleto não é anexado", async () => {
    const content = pdf(FILE_CHUNK_BYTES + 10);
    const t = await ticketFor("sec", content.length);
    await system("uploadChunk", "sec", { uploadId: t.uploadId, index: 0, data: content.subarray(0, FILE_CHUNK_BYTES).toString("base64") });
    await expectCode(documents("create", "sec", { input: docInput(), uploadId: t.uploadId }), "invalid");
    expect((await db.collection("documents").get()).size).toBe(0);
    expect((await ticket(t.uploadId)).status).toBe("pending");
  });

  it("conteúdo que não é do tipo declarado é recusado e os pedaços são apagados", async () => {
    const fake = Buffer.from("isto não é um PDF, é texto simples\n");
    const t = await ticketFor("sec", fake.length, "falso.pdf");
    await sendChunks("sec", t.uploadId, fake);
    await expectCode(documents("create", "sec", { input: docInput(), uploadId: t.uploadId }), "invalid");
    expect((await ticket(t.uploadId)).status).toBe("rejected");
    expect(await chunkDocs(t.uploadId)).toHaveLength(0);
    expect((await db.collection("documents").get()).size).toBe(0);
  });

  it("falha da operação depois da conferência: o envio volta a pendente e é reaproveitado", async () => {
    const content = pdf(2000);
    const t = await ticketFor("sec", content.length);
    await sendChunks("sec", t.uploadId, content);
    await expectCode(documents("create", "sec", { input: docInput({ categoryId: "nao-existe" }), uploadId: t.uploadId }), "invalid");
    expect((await ticket(t.uploadId)).status).toBe("pending");
    expect(await chunkDocs(t.uploadId)).toHaveLength(1);
    await documents("create", "sec", { input: docInput(), uploadId: t.uploadId });
    expect((await ticket(t.uploadId)).status).toBe("attached");
  });

  it("limites menores no banco: acima de 8 MB ou vídeo é recusado no tíquete", async () => {
    await expectCode(ticketFor("sec", 8 * 1024 * 1024 + 1), "invalid");
    await expectCode(system("prepareUpload", "mkt", { purpose: "marketingFile", fileName: "video.mp4", size: 1000, contentType: "video/mp4" }), "invalid");
  });

  it("ao pedir um novo envio, os envios vencidos da própria pessoa são apagados", async () => {
    const content = pdf(1000);
    const old = await ticketFor("sec", content.length);
    await sendChunks("sec", old.uploadId, content);
    await db.doc(`uploads/${old.uploadId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000) });
    const other = await ticketFor("pres", content.length);
    await sendChunks("pres", other.uploadId, content);
    await db.doc(`uploads/${other.uploadId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000) });

    await ticketFor("sec", content.length);
    expect((await ticket(old.uploadId)).status).toBe("discarded");
    expect(await chunkDocs(old.uploadId)).toHaveLength(0);
    // O envio de outra pessoa não é mexido.
    expect((await ticket(other.uploadId)).status).toBe("pending");
    expect(await chunkDocs(other.uploadId)).toHaveLength(1);
  });
});

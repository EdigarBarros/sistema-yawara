/**
 * Arquivos no Google Drive da Atlética (FILE_STORAGE=drive, implantação
 * gratuita): envio em pedaços, envio ao Drive ao anexar, compensação e leitura
 * pelo servidor com conferência de acesso. O Drive é simulado em memória
 * (a chamada HTTP real fica em core/drive.ts); o resto roda nos emuladores.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN } from "@/lib/access-tokens";
import type { InstitutionalDocument } from "@/types";
import { DRIVE_READ_BYTES, FILE_CHUNK_BYTES } from "../src/core/files";
import { documentsActions } from "../src/modules/documents";
import { systemActions } from "../src/modules/system";
import { caller, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const drive = vi.hoisted(() => ({ files: new Map<string, Buffer>(), uploads: 0 }));

vi.mock("../src/core/drive", () => ({
  async uploadToDrive(_name: string, _mime: string, content: Buffer, uploadId: string) {
    drive.uploads++;
    const id = `drive-${uploadId}`;
    drive.files.set(id, Buffer.from(content));
    return id;
  },
  async readDriveRange(id: string, start: number, end: number) {
    const content = drive.files.get(id);
    if (!content) throw new Error("arquivo inexistente no Drive simulado");
    return content.subarray(start, end + 1);
  },
  async deleteDriveFile(id: string) {
    drive.files.delete(id);
  },
}));

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

async function upload(uid: string, content: Buffer, fileName = "estatuto.pdf") {
  const t = await system<{ uploadId: string }>("prepareUpload", uid, { purpose: "document", fileName, size: content.length, contentType: "application/pdf" });
  for (let i = 0; i * FILE_CHUNK_BYTES < content.length; i++) {
    await system("uploadChunk", uid, { uploadId: t.uploadId, index: i, data: content.subarray(i * FILE_CHUNK_BYTES, (i + 1) * FILE_CHUNK_BYTES).toString("base64") });
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
const chunkDocs = async (uploadId: string) => (await db.collection("fileChunks").where("uploadId", "==", uploadId).get()).docs;

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
  drive.uploads = 0;
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("arquivos no Google Drive", () => {
  it("anexa: o conteúdo vai para o Drive, os pedaços saem do banco e o arquivo lido é idêntico", async () => {
    const content = pdf(DRIVE_READ_BYTES + FILE_CHUNK_BYTES + 777);
    const uploadId = await upload("sec", content);

    const d = await documents<InstitutionalDocument>("create", "sec", { input: docInput(), uploadId });
    const file = d.versions[0].file!;
    expect(file).toMatchObject({ name: "estatuto.pdf", size: content.length, mimeType: "application/pdf", driveId: `drive-${uploadId}` });
    expect(file.chunks).toBeUndefined();
    expect(file.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(drive.files.get(file.driveId!)!.equals(content)).toBe(true);
    expect(await ticket(uploadId)).toMatchObject({ status: "attached", destDir: `documents/${d.id}/v1` });
    expect(await chunkDocs(uploadId)).toHaveLength(0);

    expect((await readAll("sec", uploadId)).equals(content)).toBe(true);
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

  it("falha da operação depois do envio ao Drive: o arquivo sai do Drive e o envio é reaproveitado", async () => {
    const content = pdf(2000);
    const uploadId = await upload("sec", content);
    await expectCode(documents("create", "sec", { input: docInput({ categoryId: "nao-existe" }), uploadId }), "invalid");
    expect(drive.files.size).toBe(0);
    expect((await ticket(uploadId)).status).toBe("pending");
    expect(await chunkDocs(uploadId)).toHaveLength(1);

    await documents("create", "sec", { input: docInput(), uploadId });
    expect((await ticket(uploadId)).status).toBe("attached");
    expect(drive.files.size).toBe(1);
  });

  it("conteúdo falso é recusado antes de chegar ao Drive", async () => {
    const fake = Buffer.from("isto não é um PDF, é texto simples\n");
    const uploadId = await upload("sec", fake, "falso.pdf");
    await expectCode(documents("create", "sec", { input: docInput(), uploadId }), "invalid");
    expect(drive.uploads).toBe(0);
    expect((await ticket(uploadId)).status).toBe("rejected");
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

  it("mesmos limites do envio em pedaços: acima de 8 MB é recusado no tíquete", async () => {
    await expectCode(system("prepareUpload", "sec", { purpose: "document", fileName: "grande.pdf", size: 8 * 1024 * 1024 + 1, contentType: "application/pdf" }), "invalid");
  });
});

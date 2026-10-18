/**
 * Regras dos arquivos guardados no próprio banco (`fileChunks`, implantação
 * gratuita): só depois de anexado e só para quem vê o registro dono do arquivo.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Bytes, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { buyerReaders, campaignReaders, documentReaders } from "@/lib/record-readers";
import { createEnv, seedAccess } from "./setup";

let env: RulesTestEnvironment;
const fs = (uid?: string) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
const chunk = (uid: string | undefined, id: string) => getDoc(doc(fs(uid), `fileChunks/${id}_0`));

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedAccess(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const board = { access: { scope: "board" as const, roleIds: [], userIds: [] }, departmentId: "secretaria", createdBy: "sec" };
    await setDoc(doc(db, "documents/d-board"), { ...board, readers: documentReaders(board) });
    const camp = { access: { view: { scope: "all" as const, roleIds: [], userIds: [] }, sell: { scope: "all" as const, roleIds: [], userIds: [] }, buyerData: { scope: "people" as const, roleIds: [], userIds: ["fin"] } }, departmentId: "financeiro", createdBy: "fin" };
    await setDoc(doc(db, "campaigns/c1"), { readers: campaignReaders(camp) });
    await setDoc(doc(db, "campaigns/c1/buyers/s1"), { readers: buyerReaders(camp, { sellerId: "ass", registeredById: "ass" }), viewReaders: campaignReaders(camp) });
    await setDoc(doc(db, "contents/k1"), { readers: ["d:marketing", "u:mkt"] });

    const files: Record<string, { destDir: string; status?: string }> = {
      doc: { destDir: "documents/d-board/v1" },
      venda: { destDir: "campaigns/c1/receipts/s1" },
      fin: { destDir: "finance/f1" },
      mkt: { destDir: "marketing/k1" },
      pendente: { destDir: "documents/d-board/v2", status: "finalized" },
      estranho: { destDir: "outra/coisa" },
    };
    for (const [id, f] of Object.entries(files)) {
      await setDoc(doc(db, `uploads/${id}`), { uid: "sec", status: f.status ?? "attached", destDir: f.destDir, storage: "database", chunks: 1 });
      await setDoc(doc(db, `fileChunks/${id}_0`), { uploadId: id, index: 0, uid: "sec", data: Bytes.fromUint8Array(new Uint8Array([37, 80, 68, 70])) });
    }
  });
});

describe("leitura dos pedaços", () => {
  it("documento da diretoria: diretoria lê; assessor e visitante não", async () => {
    await assertSucceeds(chunk("fin", "doc"));
    await assertFails(chunk("ass", "doc"));
    await assertFails(chunk(undefined, "doc"));
  });
  it("comprovante de venda: público dos dados do comprador dentro de campanha visível", async () => {
    await assertSucceeds(chunk("fin", "venda"));
    await assertSucceeds(chunk("ass", "venda"));
    await assertFails(chunk("mkt", "venda"));
  });
  it("comprovante financeiro: só com acesso ao Financeiro", async () => {
    await assertSucceeds(chunk("fin", "fin"));
    await assertFails(chunk("evt", "fin"));
  });
  it("arquivo de marketing: público do conteúdo; conta desativada não lê", async () => {
    await assertSucceeds(chunk("mkt", "mkt"));
    await assertFails(chunk("fin", "mkt"));
    await assertFails(chunk("off", "mkt"));
  });
  it("envio ainda não anexado ou destino desconhecido: ninguém lê", async () => {
    await assertFails(chunk("pres", "pendente"));
    await assertFails(chunk("pres", "estranho"));
  });
  it("não dá para listar, gravar nem apagar pedaços pelo navegador", async () => {
    await assertFails(getDocs(query(collection(fs("pres"), "fileChunks"), where("uploadId", "==", "doc"))));
    await assertFails(setDoc(doc(fs("pres"), "fileChunks/doc_1"), { uploadId: "doc", index: 1, data: Bytes.fromUint8Array(new Uint8Array([1])) }));
    await assertFails(deleteDoc(doc(fs("pres"), "fileChunks/doc_0")));
  });
});

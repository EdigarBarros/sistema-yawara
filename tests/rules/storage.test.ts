/**
 * Testes das regras do Cloud Storage (com consultas cruzadas ao Firestore).
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { buyerReaders, campaignReaders, documentReaders } from "@/lib/record-readers";
import { createEnv, seedAccess } from "./setup";

let env: RulesTestEnvironment;
const st = (uid?: string) => (uid ? env.authenticatedContext(uid).storage() : env.unauthenticatedContext().storage());
const bytes = (n: number) => new Uint8Array(n).fill(65);
const inOneHour = () => Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seedAccess(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const ticket = { uid: "ass", status: "pending", fileName: "ata.pdf", size: 10, maxBytes: 1024, contentType: "application/pdf", expiresAt: inOneHour() };
    await setDoc(doc(db, "uploads/t-ok"), ticket);
    await setDoc(doc(db, "uploads/t-expired"), { ...ticket, expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await setDoc(doc(db, "uploads/t-used"), { ...ticket, status: "finalized" });
    const board = { access: { scope: "board" as const, roleIds: [], userIds: [] }, departmentId: "secretaria", createdBy: "sec" };
    await setDoc(doc(db, "documents/d-board"), { ...board, readers: documentReaders(board) });
    const camp = { access: { view: { scope: "all" as const, roleIds: [], userIds: [] }, sell: { scope: "all" as const, roleIds: [], userIds: [] }, buyerData: { scope: "people" as const, roleIds: [], userIds: ["fin"] } }, departmentId: "financeiro", createdBy: "fin" };
    await setDoc(doc(db, "campaigns/c1/buyers/s1"), { readers: buyerReaders(camp, { sellerId: "ass", registeredById: "ass" }), viewReaders: campaignReaders(camp) });
    // Campanha só do Financeiro com dados dos compradores liberados para a diretoria (público dos compradores mais amplo).
    const restrita = { access: { view: { scope: "roles" as const, roleIds: ["diretor-financeiro"], userIds: [] }, sell: { scope: "roles" as const, roleIds: ["diretor-financeiro"], userIds: [] }, buyerData: { scope: "board" as const, roleIds: [], userIds: [] } }, departmentId: "financeiro", createdBy: "fin" };
    await setDoc(doc(db, "campaigns/c2/buyers/s2"), { readers: buyerReaders(restrita, { sellerId: "fin", registeredById: "fin" }), viewReaders: campaignReaders(restrita) });
    // Vendedor (ass) que saiu do público da campanha (agora só evt).
    const estreita = { access: { view: { scope: "people" as const, roleIds: [], userIds: ["evt"] }, sell: { scope: "people" as const, roleIds: [], userIds: ["evt"] }, buyerData: { scope: "people" as const, roleIds: [], userIds: ["evt"] } }, departmentId: "eventos", createdBy: "evt" };
    await setDoc(doc(db, "campaigns/c3/buyers/s3"), { readers: buyerReaders(estreita, { sellerId: "ass", registeredById: "ass" }), viewReaders: campaignReaders(estreita) });
    // Documento antigo, sem a cópia do público da campanha: fechado por padrão.
    await setDoc(doc(db, "campaigns/c1/buyers/s4"), { readers: buyerReaders(camp, { sellerId: "ass", registeredById: "ass" }) });
    await setDoc(doc(db, "contents/k1"), { readers: ["d:marketing", "u:mkt"] });
    const storage = ctx.storage();
    await uploadBytes(ref(storage, "documents/d-board/v1/ata.pdf"), bytes(10), { contentType: "application/pdf" });
    await uploadBytes(ref(storage, "campaigns/c1/receipts/s1/comprovante.pdf"), bytes(10), { contentType: "application/pdf" });
    await uploadBytes(ref(storage, "campaigns/c2/receipts/s2/comprovante.pdf"), bytes(10), { contentType: "application/pdf" });
    await uploadBytes(ref(storage, "campaigns/c3/receipts/s3/comprovante.pdf"), bytes(10), { contentType: "application/pdf" });
    await uploadBytes(ref(storage, "campaigns/c1/receipts/s4/comprovante.pdf"), bytes(10), { contentType: "application/pdf" });
    await uploadBytes(ref(storage, "finance/f1/nota.pdf"), bytes(10), { contentType: "application/pdf" });
    await uploadBytes(ref(storage, "marketing/k1/arte.png"), bytes(10), { contentType: "image/png" });
  });
});

describe("envio para a área temporária", () => {
  it("aceita apenas o arquivo descrito no tíquete, pelo dono, dentro da validade", async () => {
    await assertSucceeds(uploadBytes(ref(st("ass"), "staging/ass/t-ok/ata.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("ass"), "staging/ass/t-ok/ata.pdf"), bytes(11), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("ass"), "staging/ass/t-ok/ata.pdf"), bytes(10), { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(st("ass"), "staging/ass/t-ok/outro.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("ass"), "staging/ass/t-expired/ata.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("ass"), "staging/ass/t-used/ata.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("fin"), "staging/ass/t-ok/ata.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("fin"), "staging/fin/t-ok/ata.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st(), "staging/ass/t-ok/ata.pdf"), bytes(10), { contentType: "application/pdf" }));
  });
  it("o navegador nunca lê nem grava arquivos definitivos diretamente", async () => {
    await assertFails(getBytes(ref(st("ass"), "staging/ass/t-ok/ata.pdf")));
    await assertFails(uploadBytes(ref(st("pres"), "documents/d-board/v2/ata.pdf"), bytes(10), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(st("fin"), "finance/f1/nota.pdf"), bytes(10), { contentType: "application/pdf" }));
  });
});

describe("leitura de arquivos definitivos", () => {
  it("documento da diretoria: diretoria lê; assessor não", async () => {
    await assertSucceeds(getBytes(ref(st("fin"), "documents/d-board/v1/ata.pdf")));
    await assertFails(getBytes(ref(st("ass"), "documents/d-board/v1/ata.pdf")));
    await assertFails(getBytes(ref(st(), "documents/d-board/v1/ata.pdf")));
  });
  it("comprovante de venda: mesmo público dos dados do comprador", async () => {
    await assertSucceeds(getBytes(ref(st("fin"), "campaigns/c1/receipts/s1/comprovante.pdf")));
    await assertSucceeds(getBytes(ref(st("ass"), "campaigns/c1/receipts/s1/comprovante.pdf")));
    await assertFails(getBytes(ref(st("mkt"), "campaigns/c1/receipts/s1/comprovante.pdf")));
  });
  it("comprovante de venda: também exige ver a campanha", async () => {
    // mkt é da diretoria (público dos compradores), mas a campanha é só do Financeiro.
    await assertFails(getBytes(ref(st("mkt"), "campaigns/c2/receipts/s2/comprovante.pdf")));
    await assertSucceeds(getBytes(ref(st("fin"), "campaigns/c2/receipts/s2/comprovante.pdf")));
    await assertSucceeds(getBytes(ref(st("pres"), "campaigns/c2/receipts/s2/comprovante.pdf")));
    // Vendedor fora do público da campanha perde o acesso ao comprovante da própria venda.
    await assertFails(getBytes(ref(st("ass"), "campaigns/c3/receipts/s3/comprovante.pdf")));
    await assertSucceeds(getBytes(ref(st("evt"), "campaigns/c3/receipts/s3/comprovante.pdf")));
    // Sem a cópia do público da campanha, só quem administra campanhas lê.
    await assertFails(getBytes(ref(st("ass"), "campaigns/c1/receipts/s4/comprovante.pdf")));
    await assertSucceeds(getBytes(ref(st("pres"), "campaigns/c1/receipts/s4/comprovante.pdf")));
  });
  it("comprovante financeiro: só com acesso ao Financeiro", async () => {
    await assertSucceeds(getBytes(ref(st("fin"), "finance/f1/nota.pdf")));
    await assertFails(getBytes(ref(st("evt"), "finance/f1/nota.pdf")));
  });
  it("arquivo de marketing: público do conteúdo; conta desativada não lê", async () => {
    await assertSucceeds(getBytes(ref(st("mkt"), "marketing/k1/arte.png")));
    await assertFails(getBytes(ref(st("fin"), "marketing/k1/arte.png")));
    await assertFails(getBytes(ref(st("off"), "marketing/k1/arte.png")));
  });
});

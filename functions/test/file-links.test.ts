/**
 * Arquivos como LINK (implantação gratuita, sem Cloud Storage): documentos,
 * comprovantes financeiros e de venda, e arquivos de Marketing guardam só o
 * nome e o link https. Dados fictícios, criados só para o teste.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Campaign, ContentItem, InstitutionalDocument, Sale } from "@/types";
import { campaignsActions } from "../src/modules/campaigns";
import { documentsActions } from "../src/modules/documents";
import { financeActions, type StoredEntry } from "../src/modules/finance";
import { marketingActions } from "../src/modules/marketing";
import { bucket, caller, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const documents = caller("documents", documentsActions);
const finance = caller("finance", financeActions);
const marketing = caller("marketing", marketingActions);
const campaigns = caller("campaigns", campaignsActions);

const DRIVE = "https://drive.google.com/file/d/arquivo-ficticio/view";
const link = (url = DRIVE, name = "Estatuto assinado.pdf") => ({ name, url });

function docInput() {
  return {
    name: "Estatuto social",
    description: "",
    categoryId: "estatuto",
    departmentId: "secretaria",
    status: "draft",
    access: { scope: "department", departmentId: "secretaria", roleIds: [], userIds: [] },
  };
}

function entryInput() {
  return { type: "expense", description: "Compra fictícia", categoryId: "desp-materiais-e-insumos", amount: 1500, date: "2026-10-10", responsibleId: "fin", departmentId: "financeiro", status: "pending" };
}

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
});

describe("documentos com link", () => {
  it("cria e adiciona versão por link; nada vai para o Storage", async () => {
    const doc = await documents<InstitutionalDocument>("create", "sec", { input: docInput(), link: link() });
    expect(doc.versions[0].file).toMatchObject({ name: "Estatuto assinado.pdf", size: 0, mimeType: "text/uri-list", url: DRIVE });
    expect(doc.versions[0].file.path).toBeUndefined();

    const v2 = await documents<InstitutionalDocument>("addVersion", "sec", { id: doc.id, link: link("https://onedrive.live.com/arquivo-ficticio", "Estatuto v2.pdf") });
    expect(v2.versions.map((v) => v.file.url)).toEqual([DRIVE, "https://onedrive.live.com/arquivo-ficticio"]);
    const [files] = await bucket().getFiles({ prefix: "documents/" });
    expect(files).toHaveLength(0);
  });

  it("recusa links que não são https, com usuário/senha, ou arquivo e link juntos; nova versão exige arquivo ou link", async () => {
    for (const url of ["javascript:alert(1)", "http://exemplo.org/a.pdf", "data:text/html,oi", "https://usuario:senha@exemplo.org/a", "nao-e-link"]) {
      const err = await expectCode(documents("create", "sec", { input: docInput(), link: link(url) }), "invalid");
      expect(err.message).toMatch(/https:\/\//);
    }
    await expectCode(documents("create", "sec", { input: docInput(), link: link(), uploadId: "a".repeat(32) }), "invalid");
    const doc = await documents<InstitutionalDocument>("create", "sec", { input: docInput() });
    const err = await expectCode(documents("addVersion", "sec", { id: doc.id }), "invalid");
    expect(err.message).toMatch(/arquivo da nova versão/);
  });
});

describe("comprovantes com link", () => {
  it("financeiro: cria com link e substitui por outro link (o anterior fica no histórico)", async () => {
    const entry = await finance<StoredEntry>("create", "fin", { input: entryInput(), link: link(DRIVE, "Nota fiscal.pdf") });
    expect(entry.receipt).toMatchObject({ url: DRIVE, name: "Nota fiscal.pdf" });
    const next = await finance<StoredEntry>("attachReceipt", "fin", { id: entry.id, link: link("https://drive.google.com/file/d/outro/view", "Nota corrigida.pdf") });
    expect(next.receipt?.url).toBe("https://drive.google.com/file/d/outro/view");
    expect(next.receiptHistory?.map((r) => r.url)).toEqual([DRIVE]);
    await expectCode(finance("attachReceipt", "fin", { id: entry.id }), "invalid");
  });

  it("rifa: confirmar pagamento com link do comprovante", async () => {
    const c = await campaigns<Campaign>("create", "pres", {
      name: "Rifa de Teste",
      description: "",
      prize: "Kit",
      quantity: 20,
      unitPrice: 1000,
      access: { view: { scope: "all", roleIds: [], userIds: [] }, sell: { scope: "directors_advisors", roleIds: [], userIds: [] }, buyerData: { scope: "board", roleIds: [], userIds: [] } },
    });
    const sale = await campaigns<Sale>("registerSale", "pres", { campaignId: c.id, numbers: [4], buyerName: "Comprador Ficticio", buyerContact: "(00) 90000-0000", sellerId: "pres", status: "pending", paymentMethod: "pix" });
    const paid = await campaigns<Sale>("confirmPayment", "fin", { campaignId: c.id, saleId: sale.id, paymentMethod: "pix", link: link(DRIVE, "Pix.png") });
    expect(paid.status).toBe("paid");
    const asPres = await campaigns<Sale[]>("listSales", "pres", { campaignId: c.id });
    expect(asPres.find((s) => s.id === sale.id)?.receipt).toMatchObject({ url: DRIVE, name: "Pix.png" });
  });
});

describe("marketing com links", () => {
  it("anexa links (sem repetir o mesmo link) e recusa chamada vazia", async () => {
    const c = await marketing<ContentItem>("create", "mkt", {
      title: "Arte de teste",
      type: "arte",
      responsibleId: "mkt",
      publishDate: "2026-11-10",
      channels: ["instagram_feed"],
      briefing: "Arte de divulgação de teste.",
    });
    const a = await marketing<ContentItem>("addFiles", "mkt", { id: c.id, links: [link(DRIVE, "arte.png"), link(DRIVE, "arte-repetida.png")] });
    expect(a.files.map((f) => f.url)).toEqual([DRIVE]);
    const again = await marketing<ContentItem>("addFiles", "mkt", { id: c.id, links: [link(DRIVE, "arte.png")] });
    expect(again.files).toHaveLength(1);
    await expectCode(marketing("addFiles", "mkt", { id: c.id }), "invalid");
  });
});

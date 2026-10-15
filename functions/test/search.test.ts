import { beforeEach, describe, expect, it } from "vitest";
import { readersFor, TOKEN } from "@/lib/access-tokens";
import type { SearchIndexEntry } from "@/lib/search-entries";
import type { Audience, SearchResult } from "@/types";
import { indexRecord } from "../src/core/search-index";
import { searchActions } from "../src/modules/search";
import { caller, createMember, db, expectCode, resetEmulators, seedPeople, seedStructure } from "./helpers";

const system = caller("system", searchActions);
const AT = "2026-10-10T12:00:00.000Z";

function audience(scope: Audience["scope"], extra: Partial<Audience> = {}): Audience {
  return { scope, roleIds: [], userIds: [], ...extra };
}

/** Grava a entrada exatamente como os módulos fazem (indexRecord, na transação). */
async function index(entry: Omit<SearchIndexEntry, "at" | "subtitle" | "href"> & Partial<Pick<SearchIndexEntry, "at" | "subtitle" | "href">>) {
  const full: SearchIndexEntry = { at: AT, subtitle: "", href: `/${entry.kind}/${entry.id}`, ...entry };
  await db.runTransaction(async (tx) => {
    indexRecord(tx, full);
  });
}

async function search(uid: string, query: string) {
  return system<SearchResult[]>("search", uid, { query });
}

const titles = (rs: SearchResult[]) => rs.map((r) => r.title).sort();

beforeEach(async () => {
  await resetEmulators();
  await seedStructure();
  await seedPeople();
  // Campanha aberta a todos (criada por Eventos).
  await index({
    kind: "campaign",
    module: "campaigns",
    id: "cmp-agasalho",
    title: "Rifa do Agasalho",
    subtitle: "RIFA-2026-001 · Agasalho oficial",
    text: ["RIFA-2026-001", "Agasalho oficial"],
    readers: readersFor([{ audience: audience("all") }], ["evt"]),
    at: "2026-10-09T10:00:00.000Z",
  });
  // Campanha restrita ao departamento Financeiro.
  await index({
    kind: "campaign",
    module: "campaigns",
    id: "cmp-secreta",
    title: "Rifa Secreta do Financeiro",
    text: ["RIFA-2026-002", "Cesta de chocolates"],
    readers: readersFor([{ audience: audience("department", { departmentId: "financeiro" }) }], ["fin"]),
  });
  // Documento compartilhado só com a pessoa do Financeiro.
  await index({
    kind: "document",
    module: "documents",
    id: "doc-estatuto",
    title: "Estatuto Social Revisado",
    subtitle: "Estatuto",
    text: ["Versão aprovada em assembleia"],
    readers: readersFor([{ audience: audience("people", { userIds: ["fin"] }) }], ["fin"]),
  });
  // Lançamento financeiro (público técnico "all"; o acesso é por finance.view).
  await index({
    kind: "finance",
    module: "finance",
    id: "lan-dj",
    title: "Pagamento do DJ da Festa",
    text: ["LAN-0001"],
    readers: [TOKEN.all],
  });
  // Reunião com público "pessoas específicas" (Secretaria).
  await index({
    kind: "meeting",
    module: "meetings",
    id: "reu-outubro",
    title: "Reunião Ordinária de Outubro",
    text: ["REU-2026-010", "Prestação de contas"],
    readers: readersFor([{ audience: audience("people", { userIds: ["sec"] }) }], ["sec"]),
  });
  // Evento do departamento de Eventos.
  await index({
    kind: "event",
    module: "events",
    id: "evt-junina",
    title: "Festa Junina da Psicologia",
    text: ["EVT-2026-003", "Quadra da universidade"],
    readers: readersFor([{ audience: audience("department", { departmentId: "eventos" }) }], ["evt"]),
  });
  // Conteúdo de Marketing aberto a todos.
  await index({
    kind: "content",
    module: "marketing",
    id: "mkt-arte",
    title: "Arte da Festa Junina",
    text: ["MKT-2026-004", "Post para o Instagram"],
    readers: readersFor([{ audience: audience("all") }], ["mkt"]),
  });
});

describe("busca global: nunca revela registros ocultos", () => {
  it("assessor vê só o que está no seu público", async () => {
    expect(titles(await search("ass", "rifa"))).toEqual(["Rifa do Agasalho"]);
    // Documento compartilhado com outra pessoa e reunião restrita: nada aparece.
    expect(await search("ass", "estatuto")).toEqual([]);
    expect(await search("ass", "reuniao")).toEqual([]);
    // Evento do próprio departamento aparece.
    expect(titles(await search("ass", "junina"))).toEqual(["Festa Junina da Psicologia"]);
  });

  it("diretoria de outro departamento não vê o registro restrito ao Financeiro nem o evento de Eventos", async () => {
    expect(titles(await search("evt", "rifa"))).toEqual(["Rifa do Agasalho"]);
    expect(titles(await search("mkt", "festa"))).toEqual(["Arte da Festa Junina"]);
  });

  it("o departamento e as pessoas do público encontram o registro", async () => {
    expect(titles(await search("fin", "rifa"))).toEqual(["Rifa Secreta do Financeiro", "Rifa do Agasalho"].sort());
    expect(titles(await search("fin", "estatuto"))).toEqual(["Estatuto Social Revisado"]);
    expect(titles(await search("sec", "reuniao"))).toEqual(["Reunião Ordinária de Outubro"]);
  });

  it("quem tem <módulo>.admin vê todos os registros do módulo", async () => {
    // Presidência: campaigns.admin, documents.admin, events.admin.
    expect(titles(await search("pres", "rifa"))).toEqual(["Rifa Secreta do Financeiro", "Rifa do Agasalho"].sort());
    expect(titles(await search("pres", "estatuto"))).toEqual(["Estatuto Social Revisado"]);
    // Secretaria tem documents.admin: vê o documento compartilhado só com o Financeiro.
    expect(titles(await search("sec", "estatuto"))).toEqual(["Estatuto Social Revisado"]);
  });

  it("lançamentos financeiros só aparecem para quem tem finance.view", async () => {
    expect(await search("evt", "pagamento")).toEqual([]);
    expect(await search("ass", "dj")).toEqual([]);
    expect(titles(await search("fin", "pagamento"))).toEqual(["Pagamento do DJ da Festa"]);
    expect(titles(await search("pres", "lan-0001"))).toEqual(["Pagamento do DJ da Festa"]);
  });

  it("sem a permissão de ver o módulo, nada aparece (mesmo com público 'todos')", async () => {
    // Assessor(a) de Eventos não tem marketing.view.
    expect(await search("ass", "arte")).toEqual([]);
    // Pessoa com cargo sem campaigns.view: cria um cargo mínimo.
    await db.doc("roles/somente-documentos").set({ name: "Somente documentos", departmentId: "secretaria", level: "member", isBoard: false, active: true, permissions: ["documents.view"], homePreset: "advisor" });
    await createMember("doc-only", "Leitor de Documentos", "somente-documentos");
    expect(await search("doc-only", "rifa")).toEqual([]);
  });

  it("módulo desativado nas configurações fica fora da busca", async () => {
    expect(titles(await search("mkt", "arte"))).toEqual(["Arte da Festa Junina"]);
    await db.doc("settings/system").update({ "modules.marketing": false });
    expect(await search("mkt", "arte")).toEqual([]);
    expect(titles(await search("pres", "festa"))).toEqual(["Festa Junina da Psicologia", "Pagamento do DJ da Festa"].sort());
  });

  it("conta desativada não pesquisa", async () => {
    await db.doc("members/ass").update({ status: "inactive" });
    await expectCode(search("ass", "rifa"), "forbidden");
    await expectCode(system("search", undefined, { query: "rifa" }), "unauthenticated");
  });
});

describe("busca global: termos", () => {
  it("várias palavras restringem o resultado", async () => {
    expect((await search("pres", "rifa")).length).toBe(2);
    expect(titles(await search("pres", "rifa agasalho"))).toEqual(["Rifa do Agasalho"]);
    expect(titles(await search("pres", "agasalho rifa"))).toEqual(["Rifa do Agasalho"]);
    expect(await search("pres", "rifa inexistente")).toEqual([]);
    expect(titles(await search("pres", "festa junina"))).toEqual(["Arte da Festa Junina", "Festa Junina da Psicologia"]);
    expect(titles(await search("pres", "festa junina psicologia"))).toEqual(["Festa Junina da Psicologia"]);
  });

  it("acentos e maiúsculas são ignorados; prefixos funcionam", async () => {
    expect(titles(await search("sec", "REUNIÃO ordinária"))).toEqual(["Reunião Ordinária de Outubro"]);
    expect(titles(await search("sec", "reuniao ordinaria"))).toEqual(["Reunião Ordinária de Outubro"]);
    expect(titles(await search("sec", "prestacao"))).toEqual(["Reunião Ordinária de Outubro"]);
    expect(titles(await search("pres", "agasa"))).toEqual(["Rifa do Agasalho"]);
    expect(titles(await search("pres", "psicolog"))).toEqual(["Festa Junina da Psicologia"]);
  });

  it("palavras com mais de 14 letras usam o prefixo indexado e conferem a palavra inteira", async () => {
    await index({ kind: "campaign", module: "campaigns", id: "cmp-longa", title: "Campanha Responsabilidades", text: [], readers: [TOKEN.all] });
    expect(titles(await search("pres", "responsabilidades"))).toEqual(["Campanha Responsabilidades"]);
    expect(titles(await search("pres", "responsabilidad"))).toEqual(["Campanha Responsabilidades"]);
    expect(await search("pres", "responsabilidadex")).toEqual([]);
  });

  it("resultado traz só os campos públicos, ordenado do mais recente", async () => {
    const [first, ...rest] = await search("pres", "rifa");
    expect(Object.keys(first).sort()).toEqual(["at", "href", "id", "kind", "subtitle", "title"]);
    expect(first).toMatchObject({ id: "cmp-secreta", kind: "campaign", href: "/campaign/cmp-secreta" });
    expect(rest[0]).toMatchObject({ id: "cmp-agasalho", subtitle: "RIFA-2026-001 · Agasalho oficial" });
  });

  it("busca curta ou só com sinais devolve vazio; campos extras são recusados", async () => {
    expect(await search("pres", "a")).toEqual([]);
    expect(await search("pres", "  -- ")).toEqual([]);
    await expectCode(system("search", "pres", { query: "rifa", readers: ["all"] }), "invalid");
    await expectCode(system("search", "pres", { query: "x".repeat(201) }), "invalid");
  });

  it("limita a 60 resultados", async () => {
    const batch = db.batch();
    for (let i = 0; i < 70; i++) {
      batch.set(db.doc(`searchIndex/event__massa${i}`), {
        kind: "event",
        module: "events",
        recordId: `massa${i}`,
        title: `Treino coletivo ${i}`,
        subtitle: "",
        href: `/eventos/massa${i}`,
        at: AT,
        readers: [TOKEN.all],
        archived: false,
        terms: ["tr", "tre", "trei", "trein", "treino"],
      });
    }
    await batch.commit();
    expect((await search("pres", "treino")).length).toBe(60);
  });
});

/**
 * Testes das regras do Firestore: tentativas legítimas e maliciosas.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { campaignReaders, buyerReaders, projectEditors } from "@/lib/record-readers";
import { access, createEnv, PEOPLE, seedAccess } from "./setup";

let env: RulesTestEnvironment;
const fs = (uid?: string) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
const tokens = (uid: string) => access(uid, PEOPLE[uid].roleId).tokens;
const NOW = "2026-10-14T12:00:00.000Z";

const audiences = {
  all: { scope: "all" as const, roleIds: [], userIds: [] },
  board: { scope: "board" as const, roleIds: [], userIds: [] },
  dept: (departmentId: string) => ({ scope: "department" as const, departmentId, roleIds: [], userIds: [] }),
  roles: (...roleIds: string[]) => ({ scope: "roles" as const, roleIds, userIds: [] }),
  people: (...userIds: string[]) => ({ scope: "people" as const, roleIds: [], userIds }),
};

/** Grava `settings/system` (como o servidor) com os módulos informados. */
async function setModules(modules: Record<string, boolean> | null) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "settings/system"), modules ? { institution: { shortName: "Atlética" }, modules } : { institution: { shortName: "Atlética" } });
  });
}

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
    // Campanha visível só para o departamento de Eventos (criada por evt).
    const evento = { access: { view: audiences.dept("eventos"), sell: audiences.dept("eventos"), buyerData: audiences.people("evt") }, departmentId: "eventos", createdBy: "evt" };
    await setDoc(doc(db, "campaigns/c-evt"), { name: "Rifa Eventos", ...evento, readers: campaignReaders(evento), updatedAt: NOW });
    const aberta = { access: { view: audiences.all, sell: audiences.all, buyerData: audiences.people("fin") }, departmentId: "financeiro", createdBy: "fin" };
    await setDoc(doc(db, "campaigns/c-all"), { name: "Rifa geral", ...aberta, readers: campaignReaders(aberta), updatedAt: NOW });
    await setDoc(doc(db, "campaigns/c-evt/sales/s1"), { numbers: [1, 2], status: "pending", sellerId: "ass", registeredById: "ass" });
    await setDoc(doc(db, "campaigns/c-evt/buyers/s1"), { name: "Comprador", contact: "0000", readers: buyerReaders(evento, { sellerId: "ass", registeredById: "ass" }) });
    await setDoc(doc(db, "campaigns/c-evt/numbers/00001"), { saleId: "s1" });
    await setDoc(doc(db, "financeEntries/f1"), { description: "Despesa", amount: 1000 });
    await setDoc(doc(db, "auditLogs/a1"), { action: "x", at: NOW });
    await setDoc(doc(db, "notifications/n-ass"), { recipientId: "ass", title: "Oi", readAt: null, createdAt: NOW });
    await setDoc(doc(db, "notifications/n-fin"), { recipientId: "fin", title: "Oi", readAt: null, createdAt: NOW });
    await setDoc(doc(db, "invitations/i1"), { email: "x@example.org", status: "pending" });
    await setDoc(doc(db, "projects/p1"), { name: "Palestra", readers: ["all"], updatedAt: NOW });
    await setDoc(doc(db, "projects/p1/private/attendance"), { attendees: [{ id: "a", name: "Participante", present: true }], editors: projectEditors({ createdBy: "ext", responsibleId: "ext" }) });
    // Projeto restrito à pessoa responsável (ext): a lista de presença também fica restrita.
    await setDoc(doc(db, "projects/p2"), { name: "Projeto restrito", readers: ["u:ext"], updatedAt: NOW });
    await setDoc(doc(db, "projects/p2/private/attendance"), { attendees: [{ id: "b", name: "Participante", present: false }], editors: projectEditors({ createdBy: "ext", responsibleId: "ext" }) });
    await setDoc(doc(db, "searchIndex/campaign__c-evt"), { terms: ["rifa"] });
    await setDoc(doc(db, "uploads/u1"), { uid: "ass" });
  });
});

describe("autenticação e situação da conta", () => {
  it("sem login nada é lido", async () => {
    await assertFails(getDoc(doc(fs(), "members/pres")));
    await assertFails(getDoc(doc(fs(), "settings/system")));
    await assertFails(getDocs(query(collection(fs(), "campaigns"), where("readers", "array-contains-any", ["all"]))));
  });
  it("conta autenticada sem cadastro na Central não lê nada", async () => {
    await assertFails(getDoc(doc(fs("intruso"), "members/pres")));
    await assertFails(getDocs(query(collection(fs("intruso"), "campaigns"), where("readers", "array-contains-any", ["all"]))));
  });
  it("conta desativada perde o acesso", async () => {
    await assertFails(getDoc(doc(fs("off"), "members/pres")));
    await assertFails(getDocs(query(collection(fs("off"), "campaigns"), where("readers", "array-contains-any", ["all"]))));
  });
});

describe("organização", () => {
  it("integrantes ativos leem o diretório; e-mail só para si e para quem administra integrantes", async () => {
    await assertSucceeds(getDocs(collection(fs("ass"), "members")));
    await assertSucceeds(getDoc(doc(fs("ass"), "memberPrivate/ass")));
    await assertFails(getDoc(doc(fs("ass"), "memberPrivate/pres")));
    await assertSucceeds(getDoc(doc(fs("pres"), "memberPrivate/ass")));
  });
  it("retrato de acesso: só o próprio (ou quem administra permissões)", async () => {
    await assertSucceeds(getDoc(doc(fs("ass"), "userAccess/ass")));
    await assertFails(getDoc(doc(fs("ass"), "userAccess/pres")));
    await assertSucceeds(getDoc(doc(fs("pres"), "userAccess/ass")));
  });
  it("ninguém grava o próprio cargo, permissões ou marcadores", async () => {
    await assertFails(setDoc(doc(fs("ass"), "userAccess/ass"), { ...access("ass", "presidente") }));
    await assertFails(updateDoc(doc(fs("ass"), "members/ass"), { roleId: "presidente" }));
    await assertFails(setDoc(doc(fs("pres"), "roles/novo"), { name: "Novo", permissions: ["organization.admin"] }));
    await assertFails(setDoc(doc(fs("pres"), "members/pres"), { name: "Pres", roleId: "presidente", status: "active" }));
  });
  it("convites: só quem pode convidar", async () => {
    await assertSucceeds(getDoc(doc(fs("pres"), "invitations/i1")));
    await assertFails(getDoc(doc(fs("ass"), "invitations/i1")));
  });
});

describe("campanhas e dados de compradores", () => {
  it("lista filtrada pelos próprios marcadores é permitida e só traz o que o perfil vê", async () => {
    const res = await assertSucceeds(getDocs(query(collection(fs("ass"), "campaigns"), where("readers", "array-contains-any", tokens("ass")), orderBy("updatedAt", "desc"), limit(50))));
    if (res.docs.map((d) => d.id).sort().join() !== "c-all,c-evt") throw new Error("assessor de Eventos deveria ver c-all e c-evt");
    const mkt = await assertSucceeds(getDocs(query(collection(fs("mkt"), "campaigns"), where("readers", "array-contains-any", tokens("mkt")))));
    if (mkt.docs.map((d) => d.id).join() !== "c-all") throw new Error("Marketing deveria ver só c-all");
  });
  it("consulta ampla ou com marcadores alheios é recusada", async () => {
    await assertFails(getDocs(collection(fs("mkt"), "campaigns")));
    await assertFails(getDocs(query(collection(fs("mkt"), "campaigns"), where("readers", "array-contains-any", ["d:eventos"]))));
    await assertFails(getDoc(doc(fs("mkt"), "campaigns/c-evt")));
  });
  it("quem administra campanhas lista tudo", async () => {
    await assertSucceeds(getDocs(collection(fs("pres"), "campaigns")));
  });
  it("vendas seguem a visibilidade da campanha; dados do comprador têm público próprio", async () => {
    await assertSucceeds(getDocs(collection(fs("ass"), "campaigns/c-evt/sales")));
    await assertFails(getDocs(collection(fs("mkt"), "campaigns/c-evt/sales")));
    // Vendedor (ass) e público de dados (evt) leem o comprador; outro integrante do departamento não.
    await assertSucceeds(getDoc(doc(fs("ass"), "campaigns/c-evt/buyers/s1")));
    await assertSucceeds(getDoc(doc(fs("evt"), "campaigns/c-evt/buyers/s1")));
    await assertSucceeds(getDocs(query(collection(fs("evt"), "campaigns/c-evt/buyers"), where("readers", "array-contains-any", tokens("evt")))));
    await assertFails(getDocs(collection(fs("evt"), "campaigns/c-evt/buyers")));
  });
  it("dados de compradores exigem ver a campanha (público dos compradores mais amplo que o da campanha)", async () => {
    // Campanha só do Financeiro; dados dos compradores liberados para a diretoria.
    const restrita = { access: { view: audiences.roles("diretor-financeiro"), sell: audiences.roles("diretor-financeiro"), buyerData: audiences.board }, departmentId: "financeiro", createdBy: "fin" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "campaigns/c-fin"), { name: "Rifa do Financeiro", ...restrita, readers: campaignReaders(restrita), updatedAt: NOW });
      await setDoc(doc(db, "campaigns/c-fin/sales/s9"), { numbers: [9], status: "pending", sellerId: "fin", registeredById: "fin" });
      await setDoc(doc(db, "campaigns/c-fin/buyers/s9"), { name: "Comprador Sigiloso", contact: "0000", readers: buyerReaders(restrita, { sellerId: "fin", registeredById: "fin" }) });
    });
    // mkt é da diretoria (está no público dos compradores), mas não vê a campanha.
    if (!buyerReaders(restrita, { sellerId: "fin", registeredById: "fin" }).some((t) => tokens("mkt").includes(t))) throw new Error("cenário: mkt deveria estar no público dos compradores");
    await assertFails(getDoc(doc(fs("mkt"), "campaigns/c-fin")));
    await assertFails(getDocs(collection(fs("mkt"), "campaigns/c-fin/sales")));
    await assertFails(getDoc(doc(fs("mkt"), "campaigns/c-fin/buyers/s9")));
    await assertFails(getDocs(query(collection(fs("mkt"), "campaigns/c-fin/buyers"), where("readers", "array-contains-any", tokens("mkt")))));
    // Quem vê a campanha e está no público dos compradores continua lendo; quem administra campanhas também.
    await assertSucceeds(getDoc(doc(fs("fin"), "campaigns/c-fin/buyers/s9")));
    await assertSucceeds(getDocs(query(collection(fs("fin"), "campaigns/c-fin/buyers"), where("readers", "array-contains-any", tokens("fin")))));
    await assertSucceeds(getDoc(doc(fs("pres"), "campaigns/c-fin/buyers/s9")));
  });

  it("vendedor que sai do público da campanha perde o acesso ao comprador", async () => {
    // ass vendeu (está nos `readers` do comprador), mas a campanha agora é só de evt.
    const estreita = { access: { view: audiences.people("evt"), sell: audiences.people("evt"), buyerData: audiences.people("evt") }, departmentId: "eventos", createdBy: "evt" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "campaigns/c-estreita"), { name: "Rifa", ...estreita, readers: campaignReaders(estreita), updatedAt: NOW });
      await setDoc(doc(db, "campaigns/c-estreita/buyers/s1"), { name: "Comprador", contact: "0000", readers: buyerReaders(estreita, { sellerId: "ass", registeredById: "ass" }) });
    });
    await assertFails(getDoc(doc(fs("ass"), "campaigns/c-estreita/buyers/s1")));
    await assertFails(getDocs(query(collection(fs("ass"), "campaigns/c-estreita/buyers"), where("readers", "array-contains-any", tokens("ass")))));
    await assertSucceeds(getDoc(doc(fs("evt"), "campaigns/c-estreita/buyers/s1")));
  });

  it("travas de números e gravações de vendas são exclusivas do servidor", async () => {
    await assertFails(getDoc(doc(fs("pres"), "campaigns/c-evt/numbers/00001")));
    await assertFails(setDoc(doc(fs("evt"), "campaigns/c-evt/numbers/00003"), { saleId: "fake" }));
    await assertFails(setDoc(doc(fs("evt"), "campaigns/c-evt/sales/s2"), { numbers: [3], status: "paid" }));
    await assertFails(updateDoc(doc(fs("pres"), "campaigns/c-evt/sales/s1"), { status: "paid" }));
    await assertFails(updateDoc(doc(fs("pres"), "campaigns/c-evt"), { status: "closed" }));
  });
});

describe("financeiro, auditoria, extensão e coleções internas", () => {
  it("lançamentos: só com acesso ao Financeiro", async () => {
    await assertSucceeds(getDoc(doc(fs("fin"), "financeEntries/f1")));
    await assertFails(getDoc(doc(fs("evt"), "financeEntries/f1")));
    await assertFails(setDoc(doc(fs("fin"), "financeEntries/f2"), { amount: 1 }));
  });
  it("auditoria: leitura com audit.view; ninguém grava ou apaga", async () => {
    await assertSucceeds(getDocs(collection(fs("pres"), "auditLogs")));
    await assertFails(getDocs(collection(fs("fin"), "auditLogs")));
    await assertFails(addDoc(collection(fs("pres"), "auditLogs"), { action: "falso" }));
    await assertFails(deleteDoc(doc(fs("pres"), "auditLogs/a1")));
  });
  it("lista de presença: só quem pode editar o projeto", async () => {
    await assertSucceeds(getDoc(doc(fs("ext"), "projects/p1/private/attendance")));
    await assertSucceeds(getDoc(doc(fs("assext"), "projects/p1/private/attendance")));
    await assertFails(getDoc(doc(fs("sec"), "projects/p1/private/attendance")));
    // Quem pode editar projetos, mas não vê este projeto, não lê a presença dele.
    await assertSucceeds(getDoc(doc(fs("ext"), "projects/p2/private/attendance")));
    await assertFails(getDoc(doc(fs("assext"), "projects/p2/private/attendance")));
  });
  it("índice de busca, tíquetes, idempotência e contadores são inacessíveis", async () => {
    await assertFails(getDoc(doc(fs("pres"), "searchIndex/campaign__c-evt")));
    await assertFails(getDoc(doc(fs("ass"), "uploads/u1")));
    await assertFails(getDoc(doc(fs("pres"), "idempotency/x")));
    await assertFails(setDoc(doc(fs("pres"), "counters/RIFA-2026"), { value: 1 }));
  });
});

describe("módulos desativados nas configurações", () => {
  it("sem o documento de configurações, sem a lista de módulos ou sem a chave do módulo: módulo conta como ativo", async () => {
    // beforeEach não grava settings/system.
    await assertSucceeds(getDoc(doc(fs("ass"), "campaigns/c-all")));
    await setModules(null);
    await assertSucceeds(getDoc(doc(fs("ass"), "campaigns/c-all")));
    await assertSucceeds(getDoc(doc(fs("fin"), "financeEntries/f1")));
    await setModules({ events: true });
    await assertSucceeds(getDoc(doc(fs("ass"), "campaigns/c-all")));
    await assertSucceeds(getDoc(doc(fs("ext"), "projects/p1/private/attendance")));
    await setModules({ campaigns: true, finance: true, extension: true });
    await assertSucceeds(getDocs(collection(fs("ass"), "campaigns/c-evt/sales")));
    await assertSucceeds(getDoc(doc(fs("evt"), "campaigns/c-evt/buyers/s1")));
    await assertSucceeds(getDoc(doc(fs("fin"), "financeEntries/f1")));
    await assertSucceeds(getDoc(doc(fs("ext"), "projects/p1")));
  });

  it("Campanhas desativado: campanhas, vendas e compradores ficam ilegíveis (inclusive para quem administra)", async () => {
    await setModules({ campaigns: false });
    await assertFails(getDoc(doc(fs("ass"), "campaigns/c-all")));
    await assertFails(getDocs(query(collection(fs("ass"), "campaigns"), where("readers", "array-contains-any", tokens("ass")))));
    await assertFails(getDocs(collection(fs("pres"), "campaigns")));
    await assertFails(getDocs(collection(fs("ass"), "campaigns/c-evt/sales")));
    await assertFails(getDoc(doc(fs("evt"), "campaigns/c-evt/buyers/s1")));
    await assertFails(getDoc(doc(fs("pres"), "campaigns/c-evt/buyers/s1")));
    // Os demais módulos seguem normais.
    await assertSucceeds(getDoc(doc(fs("fin"), "financeEntries/f1")));
    await assertSucceeds(getDoc(doc(fs("ext"), "projects/p1")));
  });

  it("Financeiro desativado: lançamentos ficam ilegíveis", async () => {
    await setModules({ finance: false });
    await assertFails(getDoc(doc(fs("fin"), "financeEntries/f1")));
    await assertFails(getDocs(collection(fs("pres"), "financeEntries")));
    await assertSucceeds(getDoc(doc(fs("ass"), "campaigns/c-all")));
  });

  it("Ensino e Extensão desativado: projetos e listas de presença ficam ilegíveis", async () => {
    await setModules({ extension: false });
    await assertFails(getDoc(doc(fs("ext"), "projects/p1")));
    await assertFails(getDoc(doc(fs("ext"), "projects/p1/private/attendance")));
    await assertFails(getDocs(query(collection(fs("ext"), "projects"), where("readers", "array-contains-any", tokens("ext")))));
  });

  it("Documentos, Eventos, Reuniões e Marketing desativados: registros ficam ilegíveis", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const path of ["documents/d1", "events/e1", "meetings/m1", "contents/k1"]) await setDoc(doc(db, path), { name: "Registro", readers: ["all"], updatedAt: NOW });
    });
    await assertSucceeds(getDoc(doc(fs("pres"), "documents/d1")));
    await assertSucceeds(getDoc(doc(fs("pres"), "events/e1")));
    await assertSucceeds(getDoc(doc(fs("pres"), "meetings/m1")));
    await assertSucceeds(getDoc(doc(fs("pres"), "contents/k1")));
    await setModules({ documents: false, events: false, meetings: false, marketing: false });
    await assertFails(getDoc(doc(fs("pres"), "documents/d1")));
    await assertFails(getDoc(doc(fs("pres"), "events/e1")));
    await assertFails(getDoc(doc(fs("pres"), "meetings/m1")));
    await assertFails(getDoc(doc(fs("pres"), "contents/k1")));
  });
});

describe("notificações", () => {
  it("cada um lê só as próprias", async () => {
    await assertSucceeds(getDocs(query(collection(fs("ass"), "notifications"), where("recipientId", "==", "ass"))));
    await assertFails(getDocs(query(collection(fs("ass"), "notifications"), where("recipientId", "==", "fin"))));
    await assertFails(getDoc(doc(fs("ass"), "notifications/n-fin")));
  });
  it("só é possível marcar como lida, uma vez, com o horário do servidor", async () => {
    await assertFails(updateDoc(doc(fs("ass"), "notifications/n-ass"), { readAt: "2026-01-01T00:00:00.000Z" }));
    await assertFails(updateDoc(doc(fs("ass"), "notifications/n-ass"), { readAt: serverTimestamp(), title: "alterado" }));
    await assertFails(updateDoc(doc(fs("fin"), "notifications/n-ass"), { readAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(fs("ass"), "notifications/n-ass"), { readAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(fs("ass"), "notifications/n-ass"), { readAt: serverTimestamp() }));
    await assertFails(addDoc(collection(fs("ass"), "notifications"), { recipientId: "fin", title: "spam", readAt: null }));
  });
});

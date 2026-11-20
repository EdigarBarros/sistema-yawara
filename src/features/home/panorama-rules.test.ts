import { describe, expect, it } from "vitest";
import type { AtleticaEvent, Campaign, ContentItem, ExtensionProject, FinanceEntry, Meeting, Sale, SportTeam } from "@/types";
import { eventsArea, extensionArea, financeArea, marketingArea, meetingsArea, rafflesArea, sportsArea } from "./panorama-rules";

const TODAY = "2026-10-20";

const campaign = (partial: Partial<Campaign> = {}) => ({ id: "c1", name: "Rifa", status: "active", quantity: 100, unitPrice: 500, ...partial }) as Campaign;
const sale = (partial: Partial<Sale>) => ({ id: Math.random().toString(36), campaignId: "c1", numbers: [1], status: "paid", createdAt: "2026-10-19T12:00:00.000Z", ...partial }) as Sale;
const entry = (partial: Partial<FinanceEntry>) => ({ id: Math.random().toString(36), type: "income", status: "settled", amount: 10_000, date: "2026-10-01", ...partial }) as FinanceEntry;

describe("panorama: rifas", () => {
  it("fica parado sem rifa ativa e verde com tudo pago", () => {
    expect(rafflesArea(TODAY, [], []).health).toBe("idle");
    const ok = rafflesArea(TODAY, [campaign()], [sale({ numbers: [1, 2] })]);
    expect(ok).toMatchObject({ health: "ok", headline: "2/100" });
  });

  it("amarelo com venda não paga recente; vermelho quando passa de 7 dias", () => {
    expect(rafflesArea(TODAY, [campaign()], [sale({ status: "pending" })]).health).toBe("warn");
    const late = rafflesArea(TODAY, [campaign()], [sale({ status: "pending", createdAt: "2026-10-01T12:00:00.000Z" })]);
    expect(late.health).toBe("alert");
    expect(late.reason).toContain("1 venda sem pagamento");
  });

  it("amarelo com sorteio próximo e muitos números livres", () => {
    expect(rafflesArea(TODAY, [campaign({ drawDate: "2026-10-22" })], []).reason).toContain("Sorteio em 2 dias");
  });
});

describe("panorama: financeiro", () => {
  it("vermelho com caixa negativo ou conta vencida", () => {
    expect(financeArea(TODAY, [entry({ type: "expense", amount: 20_000 }), entry({})]).health).toBe("alert");
    expect(financeArea(TODAY, [entry({}), entry({ type: "expense", status: "pending", amount: 100, date: "2026-10-10" })]).reason).toContain("1 conta vencida");
  });

  it("amarelo quando as contas a pagar passam do caixa", () => {
    expect(financeArea(TODAY, [entry({ amount: 1000 }), entry({ type: "expense", status: "pending", amount: 5000, date: "2026-11-10" })]).health).toBe("warn");
  });

  it("verde com contas em dia; parado sem lançamentos", () => {
    expect(financeArea(TODAY, [entry({})]).health).toBe("ok");
    expect(financeArea(TODAY, []).health).toBe("idle");
  });
});

describe("panorama: eventos", () => {
  const ev = (partial: Partial<AtleticaEvent>) => ({ id: "e1", name: "Calourada", date: "2026-11-30", status: "planning", tasks: [], ...partial }) as AtleticaEvent;
  it("vermelho com tarefa atrasada, amarelo com tarefa travada ou evento perto com tarefas abertas", () => {
    expect(eventsArea(TODAY, [ev({ tasks: [{ id: "t", title: "Som", status: "todo", dueDate: "2026-10-01" }] as AtleticaEvent["tasks"] })]).health).toBe("alert");
    expect(eventsArea(TODAY, [ev({ tasks: [{ id: "t", title: "Som", status: "blocked" }] as AtleticaEvent["tasks"] })]).health).toBe("warn");
    expect(eventsArea(TODAY, [ev({ date: "2026-10-23", tasks: [{ id: "t", title: "Som", status: "doing" }] as AtleticaEvent["tasks"] })]).reason).toContain("3 dia");
  });
  it("mostra o próximo evento como número principal", () => {
    expect(eventsArea(TODAY, [ev({})])).toMatchObject({ health: "ok", caption: "próximo: Calourada" });
    expect(eventsArea(TODAY, []).health).toBe("idle");
  });
});

describe("panorama: marketing, secretaria e extensão", () => {
  it("marketing: atrasado é vermelho, em revisão é amarelo", () => {
    expect(marketingArea(TODAY, [{ id: "a", status: "production", publishDate: "2026-10-10" }] as ContentItem[]).health).toBe("alert");
    expect(marketingArea(TODAY, [{ id: "a", status: "review", publishDate: "2026-10-22" }] as ContentItem[])).toMatchObject({ health: "warn", headline: "1" });
  });

  it("secretaria: ata parada há mais de 7 dias é vermelho", () => {
    expect(meetingsArea(TODAY, [{ id: "m", title: "Geral", date: "2026-10-01", status: "pending_approval" }] as Meeting[]).health).toBe("alert");
    expect(meetingsArea(TODAY, [{ id: "m", title: "Geral", date: "2026-10-18", status: "pending_approval" }] as Meeting[]).health).toBe("warn");
    expect(meetingsArea(TODAY, [{ id: "m", title: "Geral", date: "2026-10-15", status: "draft" }] as Meeting[]).reason).toContain("sem ata");
  });

  it("extensão: certificado pendente é amarelo", () => {
    const projects = [
      { id: "p1", status: "done", certificateStatus: "not_started", date: "2026-10-01" },
      { id: "p2", status: "open", certificateStatus: "not_started", date: "2026-11-01" },
    ] as ExtensionProject[];
    expect(extensionArea(TODAY, projects)).toMatchObject({ health: "warn", headline: "1" });
    expect(extensionArea(TODAY, []).health).toBe("idle");
  });
});

describe("panorama: esportes", () => {
  const team = (matches: Partial<SportTeam["matches"][number]>[], status: SportTeam["status"] = "active") =>
    ({ id: "t", name: "Futsal Fem.", status, matches: matches.map((m, i) => ({ id: `m${i}`, opponent: "Medicina", location: "Ginásio", status: "scheduled", ...m })) }) as SportTeam;
  it("parado sem modalidade ativa; amarelo com jogo passado sem resultado", () => {
    expect(sportsArea(TODAY, [team([], "paused")]).health).toBe("idle");
    expect(sportsArea(TODAY, [team([{ date: "2026-10-10" }])]).reason).toContain("1 jogo já passou");
  });
  it("mostra o próximo jogo", () => {
    expect(sportsArea(TODAY, [team([{ date: "2026-10-25" }])])).toMatchObject({ health: "ok", caption: "próximo jogo: Futsal Fem. × Medicina" });
  });
});

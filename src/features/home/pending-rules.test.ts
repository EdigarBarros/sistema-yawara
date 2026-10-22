import { describe, expect, it } from "vitest";
import type { AtleticaEvent, Campaign, Meeting, Sale } from "@/types";
import { buildPending, type PendingInput } from "./pending-rules";

const TODAY = "2026-10-20";

const campaign = (partial: Partial<Campaign> = {}) =>
  ({ id: "c1", name: "Rifa do Kit", status: "active", quantity: 100, unitPrice: 500, ...partial }) as Campaign;

const sale = (partial: Partial<Sale>) =>
  ({ id: Math.random().toString(36), campaignId: "c1", numbers: [1], status: "pending", createdAt: "2026-10-01T12:00:00.000Z", history: [], ...partial }) as Sale;

const base = (partial: Partial<PendingInput> = {}): PendingInput => ({
  today: TODAY,
  userId: "u1",
  oversight: false,
  canApproveMeetings: false,
  followsPayments: false,
  ...partial,
});

describe("Precisa de você", () => {
  it("lista atas para aprovar só para quem aprova", () => {
    const meetings = [{ id: "m1", title: "Reunião geral", date: "2026-10-01", startTime: "19:00", status: "pending_approval" }] as Meeting[];
    expect(buildPending(base({ meetings }))).toHaveLength(0);
    expect(buildPending(base({ meetings, canApproveMeetings: true }))[0]).toMatchObject({ kind: "meeting", action: "Revisar e aprovar" });
  });

  it("agrupa vendas sem pagamento há 7 dias ou mais em um cartão por rifa", () => {
    const sales = [
      sale({ numbers: [1, 2] }),
      sale({ numbers: [3] }),
      sale({ numbers: [4], createdAt: "2026-10-18T12:00:00.000Z" }),
      sale({ numbers: [5], status: "paid" }),
    ];
    const items = buildPending(base({ campaigns: [campaign()], sales, followsPayments: true }));
    const unpaid = items.find((i) => i.kind === "unpaid")!;
    expect(unpaid.title).toBe("2 vendas ainda sem pagamento");
    expect(unpaid.detail).toContain("3 número(s)");
    expect(unpaid.urgent).toBe(true);
    expect(items[0].kind).toBe("unpaid");
    expect(buildPending(base({ campaigns: [campaign()], sales }))).toHaveLength(0);
  });

  it("avisa sorteio próximo só quando ainda há muitos números livres", () => {
    const c = campaign({ drawDate: "2026-10-23" });
    expect(buildPending(base({ campaigns: [c], sales: [] }))[0]).toMatchObject({ kind: "draw", title: "100 números ainda livres" });
    const quaseTudo = [sale({ numbers: Array.from({ length: 90 }, (_, i) => i + 1) })];
    expect(buildPending(base({ campaigns: [c], sales: quaseTudo }))).toHaveLength(0);
  });

  it("presidência vê tarefas atrasadas de qualquer pessoa; os demais, só as próprias", () => {
    const events = [
      {
        id: "e1",
        name: "Calourada",
        date: "2026-11-30",
        location: "Campus",
        status: "planning",
        tasks: [
          { id: "t1", title: "Fechar som", dueDate: "2026-10-10", status: "todo", responsibleId: "u2" },
          { id: "t2", title: "Comprar copos", dueDate: "2026-10-22", status: "doing", responsibleId: "u1" },
        ],
      },
    ] as unknown as AtleticaEvent[];
    expect(buildPending(base({ events })).map((i) => i.id)).toEqual(["t:t2"]);
    expect(buildPending(base({ events, oversight: true })).map((i) => i.id)).toEqual(["t:t1", "t:t2"]);
  });

  it("mostra eventos e reuniões de hoje e dos próximos 2 dias", () => {
    const events = [
      { id: "e1", name: "Treino", date: "2026-10-20", location: "Ginásio", status: "confirmed", tasks: [] },
      { id: "e2", name: "Festa", date: "2026-10-25", location: "", status: "confirmed", tasks: [] },
    ] as unknown as AtleticaEvent[];
    const meetings = [{ id: "m1", title: "Diretoria", date: "2026-10-21", startTime: "18:00", status: "draft" }] as Meeting[];
    const items = buildPending(base({ events, meetings }));
    expect(items.map((i) => i.label)).toEqual(["Evento hoje", "Reunião chegando"]);
    expect(items[1].detail).toBe("amanhã · 18:00");
  });
});

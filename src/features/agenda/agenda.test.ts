import { describe, expect, it } from "vitest";
import type { AtleticaEvent, Campaign, Meeting } from "@/types";
import { buildAgenda, groupByDay, monthGrid, weekOf } from "./agenda";

const event = (over: Partial<AtleticaEvent>) =>
  ({ id: "e1", name: "Festa", date: "2026-10-31", time: "21:00", location: "Quadra", status: "confirmed", tasks: [], ...over }) as AtleticaEvent;
const meeting = (over: Partial<Meeting>) => ({ id: "m1", title: "Reunião de diretoria", date: "2026-10-20", startTime: "19:00", location: "Sala 2", ...over }) as Meeting;
const campaign = (over: Partial<Campaign>) => ({ id: "c1", name: "Rifa de Natal", prize: "Cesta", status: "active", ...over }) as Campaign;

describe("buildAgenda", () => {
  it("junta eventos, reuniões e datas de rifas em ordem de data e hora", () => {
    const items = buildAgenda({
      events: [event({})],
      meetings: [meeting({})],
      campaigns: [campaign({ drawDate: "2026-12-20", endDate: "2026-12-18" })],
    });
    expect(items.map((i) => [i.kind, i.date])).toEqual([
      ["meeting", "2026-10-20"],
      ["event", "2026-10-31"],
      ["deadline", "2026-12-18"],
      ["raffle", "2026-12-20"],
    ]);
    expect(items[0].href).toBe("/secretaria/m1");
  });

  it("ignora eventos cancelados, tarefas concluídas e campanhas encerradas", () => {
    const items = buildAgenda({
      events: [
        event({ id: "x", status: "cancelled" }),
        event({
          tasks: [
            { id: "t1", title: "Comprar gelo", dueDate: "2026-10-30", status: "todo" },
            { id: "t2", title: "Feita", dueDate: "2026-10-29", status: "done" },
            { id: "t3", title: "Sem prazo", status: "todo" },
          ] as AtleticaEvent["tasks"],
        }),
      ],
      campaigns: [campaign({ status: "closed", drawDate: "2026-12-20" })],
    });
    expect(items.map((i) => i.title)).toEqual(["Comprar gelo", "Festa"]);
    expect(items[0]).toMatchObject({ kind: "deadline", detail: "Tarefa de Festa", href: "/eventos/e1?aba=tarefas" });
  });

  it("não repete o fim das vendas quando coincide com o sorteio", () => {
    const items = buildAgenda({ campaigns: [campaign({ drawDate: "2026-12-20", endDate: "2026-12-20" })] });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("raffle");
  });
});

describe("grade do calendário", () => {
  it("monta o mês começando no domingo e completa a última semana", () => {
    const cells = monthGrid(2026, 9); // outubro de 2026 começa numa quinta
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(31);
  });

  it("devolve a semana inteira da data, inclusive virando o mês", () => {
    expect(weekOf("2026-10-01")).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("agrupa itens por dia", () => {
    const map = groupByDay(buildAgenda({ meetings: [meeting({}), meeting({ id: "m2", startTime: "08:00" })] }));
    expect(map.get("2026-10-20")?.map((i) => i.id)).toEqual(["meeting:m2", "meeting:m1"]);
  });
});

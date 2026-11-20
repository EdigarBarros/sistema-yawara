import { describe, expect, it } from "vitest";
import type { AtleticaEvent, EventTask } from "@/types";
import { eventCountdown, eventNumbers, nextEvent, taskBoard } from "./home-rules";

const TODAY = "2026-11-20";
let n = 0;
const task = (p: Partial<EventTask>) => ({ id: `t${++n}`, title: "Tarefa", departmentId: "d", status: "todo", ...p }) as EventTask;
const event = (p: Partial<AtleticaEvent>) =>
  ({ id: `e${++n}`, name: "Evento", date: "2026-11-25", time: "20:00", status: "planning", tasks: [], suppliers: [], schedule: [], ...p }) as unknown as AtleticaEvent;

describe("tela do diretor de eventos", () => {
  it("próximo evento ignora passados, concluídos e cancelados", () => {
    const a = event({ date: "2026-11-28", tasks: [task({ status: "done" }), task({})] });
    const b = event({ date: "2026-11-22", status: "cancelled" });
    const c = event({ date: "2026-11-10" });
    const g = nextEvent([a, b, c], TODAY)!;
    expect(g.event).toBe(a);
    expect(g).toMatchObject({ inDays: 8, done: 1, total: 2 });
    expect(nextEvent([], TODAY)).toBeNull();
  });

  it("quadro: tarefas abertas por situação, atrasadas primeiro", () => {
    const e = event({
      tasks: [task({ title: "B", dueDate: "2026-11-24" }), task({ title: "A", dueDate: "2026-11-18" }), task({ status: "blocked" }), task({ status: "done" })],
    });
    const board = taskBoard([e, event({ date: "2026-10-01", tasks: [task({})] })], TODAY);
    expect(board.todo.map((b) => b.task.title)).toEqual(["A", "B"]);
    expect(board.todo[0].overdue).toBe(true);
    expect(board.blocked).toHaveLength(1);
    expect(board.doing).toHaveLength(0);
  });

  it("números do mês", () => {
    const s = eventNumbers(
      [
        event({ status: "confirmed", tasks: [task({ dueDate: "2026-11-01" }), task({ status: "blocked" })], suppliers: [{ id: "s", name: "S", service: "x", status: "quoted" }] }),
        event({ date: "2026-11-05", status: "done" }),
        event({ date: "2026-11-06", status: "cancelled" }),
      ],
      TODAY,
    );
    expect(s).toEqual({ monthEvents: 2, monthConfirmed: 2, openTasks: 2, blocked: 1, overdue: 1, suppliersToClose: 1 });
  });

  it("contagem regressiva", () => {
    expect(eventCountdown(0)).toBe("É hoje!");
    expect(eventCountdown(1)).toBe("É amanhã");
    expect(eventCountdown(3)).toBe("Faltam 3 dias");
  });
});

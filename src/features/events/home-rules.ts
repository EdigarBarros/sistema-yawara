/**
 * Tela do(a) Diretor(a) de Eventos: próximo evento, quadro de tarefas e
 * números do mês. Funções puras (testadas em home-rules.test.ts).
 */
import type { AtleticaEvent, DateOnly, EventTask, TaskStatus } from "@/types";
import { daysBetween } from "@/lib/format";

const isOpen = (e: AtleticaEvent) => e.status === "planning" || e.status === "confirmed";

export interface NextEvent {
  event: AtleticaEvent;
  inDays: number;
  done: number;
  total: number;
}

/** Próximo evento em planejamento ou confirmado (de hoje em diante). */
export function nextEvent(events: AtleticaEvent[], today: DateOnly): NextEvent | null {
  const event = events
    .filter((e) => isOpen(e) && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
  if (!event) return null;
  return { event, inDays: daysBetween(today, event.date), done: event.tasks.filter((t) => t.status === "done").length, total: event.tasks.length };
}

export interface BoardTask {
  task: EventTask;
  event: AtleticaEvent;
  overdue: boolean;
}

export type BoardColumn = Exclude<TaskStatus, "done">;

/**
 * Tarefas em aberto dos eventos que ainda vão acontecer, por situação. Dentro
 * de cada coluna: atrasadas primeiro, depois pelo prazo e pela data do evento.
 */
export function taskBoard(events: AtleticaEvent[], today: DateOnly): Record<BoardColumn, BoardTask[]> {
  const board: Record<BoardColumn, BoardTask[]> = { todo: [], doing: [], blocked: [] };
  for (const event of events) {
    if (!isOpen(event) || event.date < today) continue;
    for (const task of event.tasks) {
      if (task.status === "done") continue;
      board[task.status].push({ task, event, overdue: !!task.dueDate && task.dueDate < today });
    }
  }
  const key = (b: BoardTask) => `${b.overdue ? 0 : 1}${b.task.dueDate ?? "9999-99-99"}${b.event.date}`;
  for (const col of Object.keys(board) as BoardColumn[]) board[col].sort((a, b) => key(a).localeCompare(key(b)));
  return board;
}

export interface EventNumbers {
  /** Eventos do mês atual que não foram cancelados. */
  monthEvents: number;
  monthConfirmed: number;
  openTasks: number;
  blocked: number;
  overdue: number;
  /** Fornecedores só com orçamento (ainda não contratados) em eventos que vão acontecer. */
  suppliersToClose: number;
}

export function eventNumbers(events: AtleticaEvent[], today: DateOnly): EventNumbers {
  const month = today.slice(0, 7);
  const monthList = events.filter((e) => e.date.startsWith(month) && e.status !== "cancelled");
  const board = taskBoard(events, today);
  const open = [...board.todo, ...board.doing, ...board.blocked];
  return {
    monthEvents: monthList.length,
    monthConfirmed: monthList.filter((e) => e.status === "confirmed" || e.status === "done").length,
    openTasks: open.length,
    blocked: board.blocked.length,
    overdue: open.filter((b) => b.overdue).length,
    suppliersToClose: events.filter((e) => isOpen(e) && e.date >= today).reduce((n, e) => n + e.suppliers.filter((s) => s.status === "quoted").length, 0),
  };
}

/** "É hoje!", "Amanhã", "Faltam 5 dias". */
export function eventCountdown(inDays: number) {
  return inDays <= 0 ? "É hoje!" : inDays === 1 ? "É amanhã" : `Faltam ${inDays} dias`;
}

import type { AtleticaEvent, Campaign, DateOnly, Meeting } from "@/types";

export type AgendaKind = "event" | "meeting" | "raffle" | "deadline";

export interface AgendaItem {
  id: string;
  date: DateOnly;
  time?: string;
  title: string;
  /** Linha de apoio: local, campanha ou evento de origem. */
  detail?: string;
  kind: AgendaKind;
  href: string;
}

export const AGENDA_KINDS: Record<AgendaKind, { label: string; color: string }> = {
  event: { label: "Eventos", color: "#e1af37" },
  meeting: { label: "Reuniões", color: "#5b86d9" },
  raffle: { label: "Rifas", color: "#3fcf8e" },
  deadline: { label: "Prazos", color: "#e88ab5" },
};

/**
 * Junta o que tem data na Central em uma agenda única. Recebe apenas os
 * registros que o usuário já pode ver (as listas vêm filtradas pelo serviço).
 */
export function buildAgenda({ events = [], meetings = [], campaigns = [] }: { events?: AtleticaEvent[]; meetings?: Meeting[]; campaigns?: Campaign[] }): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const e of events) {
    if (e.status === "cancelled") continue;
    items.push({ id: `event:${e.id}`, date: e.date, time: e.time || undefined, title: e.name, detail: e.location || undefined, kind: "event", href: `/eventos/${e.id}` });
    for (const t of e.tasks) {
      if (!t.dueDate || t.status === "done") continue;
      items.push({ id: `task:${e.id}:${t.id}`, date: t.dueDate, title: t.title, detail: `Tarefa de ${e.name}`, kind: "deadline", href: `/eventos/${e.id}?aba=tarefas` });
    }
  }
  for (const m of meetings) {
    items.push({ id: `meeting:${m.id}`, date: m.date, time: m.startTime || undefined, title: m.title, detail: m.location || undefined, kind: "meeting", href: `/secretaria/${m.id}` });
  }
  for (const c of campaigns) {
    if (c.status !== "active") continue;
    if (c.drawDate) items.push({ id: `draw:${c.id}`, date: c.drawDate, title: `Sorteio: ${c.name}`, detail: c.prize || undefined, kind: "raffle", href: `/campanhas/${c.id}` });
    if (c.endDate && c.endDate !== c.drawDate) items.push({ id: `end:${c.id}`, date: c.endDate, title: `Fim das vendas: ${c.name}`, kind: "deadline", href: `/campanhas/${c.id}` });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99") || a.title.localeCompare(b.title));
}

/** Agrupa por dia ("yyyy-mm-dd" → itens). */
export function groupByDay(items: AgendaItem[]) {
  const map = new Map<string, AgendaItem[]>();
  for (const it of items) {
    const list = map.get(it.date);
    if (list) list.push(it);
    else map.set(it.date, [it]);
  }
  return map;
}

/** Dias de um mês para a grade (semana começando no domingo), com dias vizinhos em branco. */
export function monthGrid(year: number, monthIndex: number): (DateOnly | null)[] {
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const days = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  const cells: (DateOnly | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` as DateOnly);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Os 7 dias da semana (domingo a sábado) que contém a data. */
export function weekOf(date: DateOnly): DateOnly[] {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  base.setUTCDate(base.getUTCDate() - base.getUTCDay());
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(base);
    x.setUTCDate(base.getUTCDate() + i);
    return x.toISOString().slice(0, 10) as DateOnly;
  });
}

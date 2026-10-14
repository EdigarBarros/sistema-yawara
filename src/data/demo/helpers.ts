import type { Audience, DateOnly, HistoryAction, HistoryEntry, ID, ISODateTime } from "@/types";
import { toDateOnly } from "@/lib/format";

/** Gerador pseudoaleatório determinístico: a mesma semente gera sempre os mesmos dados. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)],
  };
}

export type Rng = ReturnType<typeof createRng>;

/** Relógio da semente: datas relativas ao momento em que a demonstração foi criada. */
export function createClock(now: Date) {
  const base = now.getTime();
  return {
    /** Data/hora a `days` dias de hoje, no horário local de Brasília informado. */
    at(days: number, hour = 10, minute = 0): ISODateTime {
      const d = new Date(base + days * 86_400_000);
      const day = toDateOnly(d);
      // -03:00 = horário de Brasília
      return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`).toISOString();
    },
    date(days: number): DateOnly {
      return toDateOnly(new Date(base + days * 86_400_000));
    },
  };
}

export type Clock = ReturnType<typeof createClock>;

let historyCounter = 0;
export function h(at: ISODateTime, actorId: ID, action: HistoryAction, summary: string): HistoryEntry {
  historyCounter += 1;
  return { id: `hst-seed-${historyCounter}`, at, actorId, action, summary };
}

export const audience = {
  all: (): Audience => ({ scope: "all", roleIds: [], userIds: [] }),
  board: (): Audience => ({ scope: "board", roleIds: [], userIds: [] }),
  directors: (): Audience => ({ scope: "directors", roleIds: [], userIds: [] }),
  directorsAdvisors: (): Audience => ({ scope: "directors_advisors", roleIds: [], userIds: [] }),
  department: (departmentId: ID): Audience => ({ scope: "department", departmentId, roleIds: [], userIds: [] }),
  roles: (...roleIds: ID[]): Audience => ({ scope: "roles", roleIds, userIds: [] }),
  people: (...userIds: ID[]): Audience => ({ scope: "people", roleIds: [], userIds }),
};

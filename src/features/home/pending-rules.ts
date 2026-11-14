/**
 * "Precisa de você": regras que transformam os dados da Central em cartões
 * curtos, cada um com UMA ação que resolve a situação. Funções puras (sem
 * React) para poderem ser testadas e reaproveitadas na tela inicial e em Avisos.
 */
import type { AtleticaEvent, Campaign, DateOnly, Meeting, Sale, SportTeam } from "@/types";
import { daysBetween, formatDate, formatTime, toDateOnly } from "@/lib/format";
import { summarize } from "@/lib/raffle";

/** Venda sem pagamento (ou reserva) parada há este tanto de dias já pede atenção. */
export const STALE_SALE_DAYS = 7;
/** Sorteio a esta distância (em dias) com muitos números livres vira alerta. */
const DRAW_ALERT_DAYS = 7;
/** Fração de números ainda livres que torna o alerta do sorteio relevante. */
const DRAW_ALERT_FREE_RATIO = 0.25;
/** Compromissos (eventos e reuniões) nos próximos dias. */
const SOON_DAYS = 2;
/** Jogos a esta distância (em dias) já aparecem: dá tempo de avisar o time. */
const MATCH_SOON_DAYS = 3;
/** Competição começando nesta janela (em dias). */
const COMPETITION_SOON_DAYS = 7;

export type PendingKind = "meeting" | "unpaid" | "reserved" | "draw" | "task" | "event" | "meeting-soon" | "match-result" | "match-soon" | "competition-soon" | "empty-roster";

export interface PendingItem {
  id: string;
  kind: PendingKind;
  href: string;
  /** Rótulo curto em caixa alta (o tipo da situação). */
  label: string;
  title: string;
  detail: string;
  /** Verbo do botão que resolve a situação. */
  action: string;
  urgent?: boolean;
  /** Quanto menor, mais acima na lista. */
  rank: number;
}

export interface PendingInput {
  today: DateOnly;
  userId?: string;
  /** Presidência acompanha a Atlética inteira (não só as próprias tarefas). */
  oversight: boolean;
  meetings?: Meeting[];
  canApproveMeetings: boolean;
  events?: AtleticaEvent[];
  campaigns?: Campaign[];
  sales?: Sale[];
  /** Quem confirma recebimentos acompanha as cobranças e reservas paradas. */
  followsPayments: boolean;
  /** Modalidades que a pessoa acompanha (é responsável ou dirige Esportes). */
  teams?: SportTeam[];
}

function when(today: DateOnly, date: DateOnly) {
  const d = daysBetween(today, date);
  return d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`;
}

export function buildPending(input: PendingInput): PendingItem[] {
  const { today } = input;
  const items: PendingItem[] = [];

  if (input.canApproveMeetings) {
    for (const m of input.meetings ?? []) {
      if (m.status !== "pending_approval") continue;
      items.push({
        id: `m:${m.id}`,
        kind: "meeting",
        href: `/secretaria/${m.id}`,
        label: "Ata para aprovar",
        title: m.title,
        detail: `Reunião de ${formatDate(m.date)}`,
        action: "Revisar e aprovar",
        rank: 20,
      });
    }
  }

  if (input.followsPayments) {
    for (const c of input.campaigns ?? []) {
      const sales = (input.sales ?? []).filter((s) => s.campaignId === c.id);
      const age = (s: Sale) => daysBetween(toDateOnly(new Date(s.createdAt)), today);
      const unpaid = sales.filter((s) => s.status === "pending" && age(s) >= STALE_SALE_DAYS);
      if (unpaid.length > 0) {
        const numbers = unpaid.reduce((n, s) => n + s.numbers.length, 0);
        items.push({
          id: `u:${c.id}`,
          kind: "unpaid",
          href: `/campanhas/${c.id}?ver=pendentes`,
          label: "Pagamento atrasado",
          title: unpaid.length === 1 ? "1 venda ainda sem pagamento" : `${unpaid.length} vendas ainda sem pagamento`,
          detail: `${c.name} · ${numbers} número(s) há mais de ${STALE_SALE_DAYS} dias`,
          action: "Cobrar",
          urgent: true,
          rank: 10,
        });
      }
      const reserved = sales.filter((s) => s.status === "reserved" && age(s) >= STALE_SALE_DAYS);
      if (reserved.length > 0 && c.status === "active") {
        const numbers = reserved.reduce((n, s) => n + s.numbers.length, 0);
        items.push({
          id: `r:${c.id}`,
          kind: "reserved",
          href: `/campanhas/${c.id}?ver=reservados`,
          label: "Reserva parada",
          title: numbers === 1 ? "1 número reservado há muito tempo" : `${numbers} números reservados há muito tempo`,
          detail: `${c.name} · confirme a venda ou libere o número`,
          action: "Resolver",
          rank: 30,
        });
      }
    }
  }

  for (const c of input.campaigns ?? []) {
    if (c.status !== "active" || !c.drawDate) continue;
    const d = daysBetween(today, c.drawDate);
    if (d < 0 || d > DRAW_ALERT_DAYS) continue;
    const s = summarize(c, (input.sales ?? []).filter((x) => x.campaignId === c.id));
    if (s.available / s.total < DRAW_ALERT_FREE_RATIO) continue;
    items.push({
      id: `d:${c.id}`,
      kind: "draw",
      href: `/campanhas/${c.id}?ver=divulgar`,
      label: "Sorteio chegando",
      title: `${s.available} números ainda livres`,
      detail: `${c.name} · sorteio ${when(today, c.drawDate)}`,
      action: "Divulgar tabela",
      rank: 25,
    });
  }

  for (const e of input.events ?? []) {
    if (e.status === "done" || e.status === "cancelled") continue;
    for (const t of e.tasks) {
      if (t.status === "done" || !t.dueDate) continue;
      const mine = !!input.userId && t.responsibleId === input.userId;
      const late = t.dueDate < today;
      // Tarefas próprias com prazo nos próximos 7 dias; para a presidência, também as atrasadas de qualquer pessoa.
      if (!(mine && daysBetween(today, t.dueDate) <= 7) && !(input.oversight && late)) continue;
      items.push({
        id: `t:${t.id}`,
        kind: "task",
        href: `/eventos/${e.id}?aba=tarefas`,
        label: late ? "Tarefa atrasada" : "Tarefa sua",
        title: t.title,
        detail: `${e.name} · prazo ${formatDate(t.dueDate)}`,
        action: "Ver tarefa",
        urgent: late,
        rank: late ? 15 : 40,
      });
    }
    const d = daysBetween(today, e.date);
    if (d >= 0 && d <= SOON_DAYS) {
      items.push({
        id: `e:${e.id}`,
        kind: "event",
        href: `/eventos/${e.id}`,
        label: d === 0 ? "Evento hoje" : "Evento chegando",
        title: e.name,
        detail: `${when(today, e.date)}${e.location ? ` · ${e.location}` : ""}`,
        action: "Ver detalhes",
        rank: d === 0 ? 12 : 35,
      });
    }
  }

  for (const m of input.meetings ?? []) {
    const d = daysBetween(today, m.date);
    if (d < 0 || d > SOON_DAYS || m.status === "archived") continue;
    items.push({
      id: `ms:${m.id}`,
      kind: "meeting-soon",
      href: `/secretaria/${m.id}`,
      label: d === 0 ? "Reunião hoje" : "Reunião chegando",
      title: m.title,
      detail: `${when(today, m.date)} · ${m.startTime}`,
      action: "Ver detalhes",
      rank: d === 0 ? 13 : 36,
    });
  }

  for (const team of input.teams ?? []) {
    if (team.status === "archived") continue;
    const href = (tab: string) => `/esportes/${team.id}?aba=${tab}`;
    for (const m of team.matches) {
      if (m.status !== "scheduled") continue;
      const d = daysBetween(today, m.date);
      const title = `${team.name} × ${m.opponent}`;
      if (d < 0) {
        items.push({
          id: `mr:${m.id}`,
          kind: "match-result",
          href: href("jogos"),
          label: "Placar pendente",
          title,
          detail: `Jogo de ${formatDate(m.date)} · conte como foi`,
          action: "Marcar placar",
          rank: 18,
        });
      } else if (d <= MATCH_SOON_DAYS) {
        items.push({
          id: `mj:${m.id}`,
          kind: "match-soon",
          href: href("jogos"),
          label: d === 0 ? "Jogo hoje" : "Jogo chegando",
          title,
          detail: `${when(today, m.date)}${m.time ? ` às ${formatTime(m.time)}` : ""} · ${m.location}`,
          action: "Ver jogo",
          rank: d === 0 ? 11 : 33,
        });
      }
    }
    for (const c of team.competitions) {
      if (c.status !== "upcoming") continue;
      const d = daysBetween(today, c.startDate);
      if (d < 0 || d > COMPETITION_SOON_DAYS) continue;
      items.push({
        id: `cs:${c.id}`,
        kind: "competition-soon",
        href: href("competicoes"),
        label: "Competição chegando",
        title: c.name,
        detail: `${team.name} · começa ${when(today, c.startDate)}`,
        action: "Ver competição",
        rank: 37,
      });
    }
    if (team.status === "active" && team.athletes.length === 0) {
      items.push({
        id: `er:${team.id}`,
        kind: "empty-roster",
        href: href("elenco"),
        label: "Elenco vazio",
        title: team.name,
        detail: "Ninguém no elenco ainda",
        action: "Montar elenco",
        rank: 45,
      });
    }
  }

  return items.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

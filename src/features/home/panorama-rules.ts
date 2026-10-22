/**
 * Panorama da Atlética: um "sinal" por área (verde, amarelo ou vermelho) com o
 * motivo em português simples e o número principal. Funções puras, testadas
 * em panorama-rules.test.ts.
 *
 * Regras (as mesmas para todos, sem depender do nome dos cargos):
 * - vermelho ("Precisa agir"): algo já passou do prazo ou o caixa está negativo;
 * - amarelo ("Atenção"): algo vai precisar de alguém em breve;
 * - verde ("Tudo certo"): nada pendente;
 * - cinza ("Parado"): a área não tem nada acontecendo agora.
 */
import type { AtleticaEvent, Campaign, ContentItem, DateOnly, ExtensionProject, FinanceEntry, Meeting, Sale } from "@/types";
import { daysBetween, formatDayMonth, formatMoneyCompact, toDateOnly } from "@/lib/format";
import { summarize } from "@/lib/raffle";
import { summarizeFinance } from "@/features/finance/utils";
import { STALE_SALE_DAYS } from "./pending-rules";

export type Health = "ok" | "warn" | "alert" | "idle";

export type AreaKey = "campaigns" | "finance" | "events" | "marketing" | "meetings" | "extension";

export interface AreaStatus {
  key: AreaKey;
  title: string;
  href: string;
  health: Health;
  /** Número ou frase principal (grande no cartão). */
  headline: string;
  /** Legenda do número principal. */
  caption: string;
  /** Por que o sinal está desta cor. */
  reason: string;
}

export const HEALTH_LABELS: Record<Health, string> = {
  ok: "Tudo certo",
  warn: "Atenção",
  alert: "Precisa agir",
  idle: "Parado",
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function rafflesArea(today: DateOnly, campaigns: Campaign[], sales: Sale[]): AreaStatus {
  const base = { key: "campaigns" as const, title: "Rifas", href: "/campanhas" };
  const active = campaigns.filter((c) => c.status === "active");
  if (active.length === 0) return { ...base, health: "idle", headline: "—", caption: "nenhuma rifa em andamento", reason: "Quando uma rifa for criada, ela aparece aqui." };

  let sold = 0;
  let total = 0;
  let pending = 0;
  let stale = 0;
  let drawSoon: string | null = null;
  for (const c of active) {
    const own = sales.filter((s) => s.campaignId === c.id);
    const s = summarize(c, own);
    sold += s.sold;
    total += s.total;
    pending += own.filter((x) => x.status === "pending").length;
    stale += own.filter((x) => x.status === "pending" && daysBetween(toDateOnly(new Date(x.createdAt)), today) >= STALE_SALE_DAYS).length;
    if (c.drawDate) {
      const d = daysBetween(today, c.drawDate);
      if (d >= 0 && d <= 7 && s.available / s.total >= 0.25) drawSoon = d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`;
    }
  }
  const headline = `${sold}/${total}`;
  const caption = `vendidos em ${plural(active.length, "rifa", "rifas")}`;
  if (stale > 0) return { ...base, health: "alert", headline, caption, reason: `${plural(stale, "venda", "vendas")} sem pagamento há mais de ${STALE_SALE_DAYS} dias.` };
  if (drawSoon) return { ...base, health: "warn", headline, caption, reason: `Sorteio ${drawSoon} e ainda há muitos números livres.` };
  if (pending > 0) return { ...base, health: "warn", headline, caption, reason: `${plural(pending, "venda ainda não paga", "vendas ainda não pagas")}.` };
  return { ...base, health: "ok", headline, caption, reason: "Vendas e pagamentos em dia." };
}

export function financeArea(today: DateOnly, entries: FinanceEntry[]): AreaStatus {
  const base = { key: "finance" as const, title: "Financeiro", href: "/financeiro" };
  const s = summarizeFinance(entries);
  const headline = formatMoneyCompact(s.balance);
  const caption = "no caixa";
  const open = entries.filter((e) => e.status === "pending");
  const overduePay = open.filter((e) => e.type === "expense" && e.date < today).length;
  const overdueReceive = open.filter((e) => e.type === "income" && e.date < today).length;
  if (entries.length === 0) return { ...base, health: "idle", headline, caption, reason: "Nenhuma entrada ou saída registrada ainda." };
  if (s.balance < 0) return { ...base, health: "alert", headline, caption, reason: "O caixa está negativo." };
  if (overduePay > 0) return { ...base, health: "alert", headline, caption, reason: `${plural(overduePay, "conta vencida", "contas vencidas")} para pagar.` };
  if (s.payable > s.balance) return { ...base, health: "warn", headline, caption, reason: `Contas a pagar (${formatMoneyCompact(s.payable)}) maiores que o caixa.` };
  if (overdueReceive > 0) return { ...base, health: "warn", headline, caption, reason: `${plural(overdueReceive, "valor atrasado", "valores atrasados")} para receber.` };
  return { ...base, health: "ok", headline, caption, reason: s.receivable > 0 ? `${formatMoneyCompact(s.receivable)} ainda para receber, sem atrasos.` : "Contas em dia." };
}

export function eventsArea(today: DateOnly, events: AtleticaEvent[]): AreaStatus {
  const base = { key: "events" as const, title: "Eventos", href: "/eventos" };
  const running = events.filter((e) => e.status !== "done" && e.status !== "cancelled");
  const upcoming = running.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const tasks = running.flatMap((e) => e.tasks.filter((t) => t.status !== "done").map((t) => ({ t, e })));
  const late = tasks.filter(({ t }) => t.dueDate && t.dueDate < today).length;
  const blocked = tasks.filter(({ t }) => t.status === "blocked").length;
  const next = upcoming[0];
  const headline = next ? formatDayMonth(next.date) : "—";
  const caption = next ? `próximo: ${next.name}` : "nenhum evento marcado";
  if (late > 0) return { ...base, health: "alert", headline, caption, reason: `${plural(late, "tarefa atrasada", "tarefas atrasadas")}.` };
  if (blocked > 0) return { ...base, health: "warn", headline, caption, reason: `${plural(blocked, "tarefa travada", "tarefas travadas")} esperando alguém.` };
  if (next && daysBetween(today, next.date) <= 7) {
    const open = next.tasks.filter((t) => t.status !== "done").length;
    if (open > 0) return { ...base, health: "warn", headline, caption, reason: `Faltam ${plural(open, "tarefa", "tarefas")} e o evento é em ${daysBetween(today, next.date)} dia(s).` };
  }
  if (!next && tasks.length === 0) return { ...base, health: "idle", headline, caption, reason: "Nada planejado por enquanto." };
  return { ...base, health: "ok", headline, caption, reason: "Tarefas dentro do prazo." };
}

export function marketingArea(today: DateOnly, contents: ContentItem[]): AreaStatus {
  const base = { key: "marketing" as const, title: "Marketing", href: "/marketing" };
  const active = contents.filter((c) => c.status !== "published" && c.status !== "cancelled");
  const late = active.filter((c) => c.publishDate && c.publishDate < today).length;
  const review = active.filter((c) => c.status === "review").length;
  const week = active.filter((c) => c.publishDate && c.publishDate >= today && daysBetween(today, c.publishDate) <= 7).length;
  const headline = String(week);
  const caption = week === 1 ? "publicação nos próximos 7 dias" : "publicações nos próximos 7 dias";
  if (late > 0) return { ...base, health: "alert", headline, caption, reason: `${plural(late, "publicação passou", "publicações passaram")} da data sem sair.` };
  if (review > 0) return { ...base, health: "warn", headline, caption, reason: `${plural(review, "arte esperando", "artes esperando")} aprovação.` };
  if (active.length === 0) return { ...base, health: "idle", headline, caption, reason: "Nenhuma arte ou post em produção." };
  return { ...base, health: "ok", headline, caption, reason: "Produção dentro do prazo." };
}

export function meetingsArea(today: DateOnly, meetings: Meeting[]): AreaStatus {
  const base = { key: "meetings" as const, title: "Secretaria", href: "/secretaria" };
  const toApprove = meetings.filter((m) => m.status === "pending_approval");
  const oldApproval = toApprove.filter((m) => daysBetween(m.date, today) > 7).length;
  const noMinutes = meetings.filter((m) => m.status === "draft" && m.date < today).length;
  const next = meetings.filter((m) => m.date >= today && m.status !== "archived").sort((a, b) => a.date.localeCompare(b.date))[0];
  const headline = next ? formatDayMonth(next.date) : "—";
  const caption = next ? `próxima reunião: ${next.title}` : "nenhuma reunião marcada";
  if (oldApproval > 0) return { ...base, health: "alert", headline, caption, reason: `${plural(oldApproval, "ata espera", "atas esperam")} aprovação há mais de 7 dias.` };
  if (toApprove.length > 0) return { ...base, health: "warn", headline, caption, reason: `${plural(toApprove.length, "ata para aprovar", "atas para aprovar")}.` };
  if (noMinutes > 0) return { ...base, health: "warn", headline, caption, reason: `${plural(noMinutes, "reunião já feita", "reuniões já feitas")} sem ata finalizada.` };
  if (!next && meetings.length === 0) return { ...base, health: "idle", headline, caption, reason: "Nenhuma reunião registrada." };
  return { ...base, health: "ok", headline, caption, reason: "Atas em dia." };
}

export function extensionArea(today: DateOnly, projects: ExtensionProject[]): AreaStatus {
  const base = { key: "extension" as const, title: "Ensino e Extensão", href: "/extensao" };
  const running = projects.filter((p) => p.status === "open" || p.status === "planning");
  const certificates = projects.filter((p) => p.status === "done" && p.certificateStatus !== "issued").length;
  const next = running.filter((p) => p.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const headline = String(running.length);
  const caption = running.length === 1 ? `projeto em andamento${next ? ` · ${formatDayMonth(next.date)}` : ""}` : `projetos em andamento${next ? ` · próximo ${formatDayMonth(next.date)}` : ""}`;
  if (certificates > 0) return { ...base, health: "warn", headline, caption, reason: `${plural(certificates, "atividade", "atividades")} já feita(s) sem certificado emitido.` };
  if (running.length === 0) return { ...base, health: "idle", headline, caption, reason: "Nenhuma atividade acadêmica agora." };
  return { ...base, health: "ok", headline, caption, reason: "Atividades em dia." };
}

import type { Cents, DateOnly, ISODateTime } from "@/types";

const TZ = "America/Sao_Paulo";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const longDateFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Converte "yyyy-mm-dd" em Date ao meio-dia UTC (evita trocar de dia por fuso). */
export function parseDateOnly(value: DateOnly) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
}

export function toDateOnly(date: Date): DateOnly {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts as DateOnly;
}

export function todayDateOnly(): DateOnly {
  return toDateOnly(new Date());
}

/** 14/10/2026 */
export function formatDate(value?: DateOnly | ISODateTime | null) {
  if (!value) return "—";
  const date = value.length === 10 ? parseDateOnly(value) : new Date(value);
  return value.length === 10
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date)
    : dateFmt.format(date);
}

/** 15h32 */
export function formatTime(value?: ISODateTime | string | null) {
  if (!value) return "—";
  if (/^\d{2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(":");
    return `${h}h${m}`;
  }
  return timeFmt.format(new Date(value)).replace(":", "h");
}

/** 14/10/2026, às 15h32 */
export function formatDateTime(value?: ISODateTime | null) {
  if (!value) return "—";
  return `${formatDate(value)}, às ${formatTime(value)}`;
}

/** 14/10/2026 15:32 (forma compacta para tabelas e histórico) */
export function formatDateTimeShort(value?: ISODateTime | null) {
  if (!value) return "—";
  return `${formatDate(value)} ${timeFmt.format(new Date(value))}`;
}

/** quarta-feira, 14 de outubro */
export function formatLongDate(value: Date | DateOnly) {
  const date = typeof value === "string" ? parseDateOnly(value) : value;
  return typeof value === "string"
    ? new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date)
    : longDateFmt.format(date);
}

/** outubro de 2026 */
export function formatMonth(year: number, monthIndex: number) {
  return monthFmt.format(new Date(Date.UTC(year, monthIndex, 1, 12)));
}

export function formatShortMonth(year: number, monthIndex: number) {
  return shortMonthFmt.format(new Date(Date.UTC(year, monthIndex, 1, 12))).replace(".", "");
}

/** 14 out */
export function formatDayMonth(value: DateOnly) {
  const d = parseDateOnly(value);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${formatShortMonth(d.getUTCFullYear(), d.getUTCMonth())}`;
}

export function formatMoney(cents: Cents) {
  return moneyFmt.format(cents / 100);
}

/** Valor compacto para indicadores: R$ 1.410 em vez de R$ 1.410,00 quando inteiro. */
export function formatMoneyCompact(cents: Cents) {
  const value = cents / 100;
  if (Number.isInteger(value)) return `R$ ${value.toLocaleString("pt-BR")}`;
  return moneyFmt.format(value);
}

/** Converte "1.234,56" ou "1234.56" em centavos. Retorna null quando inválido. */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.replace(/[R$\s]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Formata centavos para edição em campo: 1234,50 */
export function centsToInput(cents?: Cents | null) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function fileExtension(name: string) {
  const ext = name.split(".").pop();
  return ext && ext !== name ? ext.toUpperCase() : "ARQUIVO";
}

/** "há 5 min", "há 3 dias", "em 2 dias" */
export function formatRelative(value: ISODateTime | DateOnly) {
  const date = value.length === 10 ? parseDateOnly(value) : new Date(value);
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (value.length === 10) {
    const days = daysBetween(todayDateOnly(), value);
    if (Math.abs(days) < 30) return rtf.format(days, "day");
    return rtf.format(Math.round(days / 30), "month");
  }
  if (abs < hour) return rtf.format(Math.round(diffMs / min), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), "day");
  return rtf.format(Math.round(diffMs / (30 * day)), "month");
}

/** Diferença em dias entre duas datas "yyyy-mm-dd" (b - a). */
export function daysBetween(a: DateOnly, b: DateOnly) {
  return Math.round((parseDateOnly(b).getTime() - parseDateOnly(a).getTime()) / 86_400_000);
}

export function greeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(date));
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** Primeiro nome, para saudações. */
export function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

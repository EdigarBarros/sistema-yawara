"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Download,
  Gift,
  History,
  Hourglass,
  Info,
  ListOrdered,
  Lock,
  LockOpen,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Campaign, CampaignSummary, NumberSlot, NumberStatus, Sale } from "@/types";
import { useDirectory } from "@/hooks/use-data";
import { useCountUp } from "@/hooks/use-count-up";
import { formatDate, formatDateTime, formatMoney, formatMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dialog, BigSheetContent } from "@/components/ui/dialog";
import { DetailList } from "@/components/shared/page";
import { HistoryTimeline } from "@/components/shared/history";
import { SalesTable } from "../sales-table";
import { CampaignAccessSummary } from "../access-config";
import { RelatedEventLabel } from "../event-field";
import { ShareSheet } from "./share-sheet";
import { UnpaidSheet, type UnpaidView } from "./unpaid-sheet";
import { BatchSheet } from "./batch-sheet";
import { NumberPad, SimpleLegend } from "./number-pad";

/** Aberturas diretas vindas do "Precisa de você" (?ver=...). */
export type RaffleMobileView = "pendentes" | "reservados" | "divulgar" | null;

type GridFilter = "all" | "available" | "sold" | "reserved";

const GRID_FILTERS: { value: GridFilter; label: string; match: (s: NumberStatus) => boolean }[] = [
  { value: "all", label: "Todos", match: () => true },
  { value: "available", label: "Livres", match: (s) => s === "available" },
  { value: "sold", label: "Vendidos", match: (s) => s === "pending" || s === "paid" },
  { value: "reserved", label: "Reservados", match: (s) => s === "reserved" },
];

interface RaffleMobileProps {
  campaign: Campaign;
  sales: Sale[];
  slots: NumberSlot[];
  summary: CampaignSummary;
  canSell: boolean;
  canManage: boolean;
  canClose: boolean;
  initialView: RaffleMobileView;
  onOpenNumber: (n: number) => void;
  /** Abre o passo a passo de venda (vazio = escolher os números no primeiro passo). */
  onStartSale: (numbers: number[]) => void;
  onExport: () => void;
  onEdit: (tab: "dados" | "acesso") => void;
  onClose: () => void;
  onReopen: () => void;
  onConflict: () => void;
}

function delay(ms: number) {
  return { animationDelay: `${ms}ms` };
}

/* ---------------------------------- Resumo ---------------------------------- */

function SummaryCard({ campaign, summary }: { campaign: Campaign; summary: CampaignSummary }) {
  const sold = useCountUp(summary.sold);
  const free = useCountUp(summary.available);
  const pct = summary.total ? Math.round((summary.sold / summary.total) * 100) : 0;
  return (
    <section aria-label="Como está a rifa" className="anim-rise rounded-[26px] border border-line bg-surface p-5" style={delay(60)}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[13px] font-semibold text-fg-muted">Vendidos</p>
          <p className="font-display text-[44px] leading-none font-extrabold text-gold-fg tnum">{sold}</p>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-fg-muted">Livres</p>
          <p className="font-display text-[44px] leading-none font-extrabold tnum">{free}</p>
        </div>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Números vendidos">
        <span className="anim-grow block h-full rounded-full bg-gradient-to-r from-[#c9921f] to-gold" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[13px] text-fg-muted tnum">
        {pct}% de {summary.total} números{summary.reserved > 0 ? ` · ${summary.reserved} reservados` : ""}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
            <span className="size-2 rounded-full bg-ok" /> Já recebido
          </p>
          <p className="font-display text-[22px] font-bold tnum">{formatMoneyCompact(summary.receivedCents)}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
            <span className="size-2 rounded-full bg-warn" /> Falta receber
          </p>
          <p className="font-display text-[22px] font-bold tnum">{formatMoneyCompact(summary.receivableCents)}</p>
        </div>
      </div>
      <p className="sr-only">{campaign.name}</p>
    </section>
  );
}

/* ------------------------------- Botões grandes ------------------------------- */

interface ActionTileProps {
  icon: LucideIcon;
  color: string;
  title: string;
  info: string;
  onClick: () => void;
  badge?: number;
  index: number;
}

function ActionTile({ icon: Icon, color, title, info, onClick, badge, index }: ActionTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press anim-rise group relative flex min-h-[118px] flex-col justify-between rounded-[22px] border border-line bg-surface p-4 text-left hover:border-line-strong"
      style={delay(160 + index * 60)}
    >
      <span className="flex items-start justify-between">
        <span
          className="grid size-11 place-items-center rounded-[14px] text-[#06102e] transition-transform duration-300 group-active:scale-110 group-active:-rotate-12"
          style={{ background: `linear-gradient(145deg, ${color}, ${color}b8)`, boxShadow: `0 8px 18px -6px ${color}80` }}
        >
          <Icon className="size-[22px]" strokeWidth={2.2} aria-hidden />
        </span>
        {!!badge && (
          <span className="anim-pop grid h-6 min-w-6 place-items-center rounded-full bg-danger px-1.5 text-[12px] font-bold text-white tnum" style={delay(520 + index * 60)}>
            {badge}
          </span>
        )}
      </span>
      <span className="mt-3 block">
        <strong className="block text-[16.5px] leading-tight font-semibold">{title}</strong>
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-fg-muted">{info}</span>
      </span>
    </button>
  );
}

/* ---------------------------------- Opções ---------------------------------- */

function OptionRow({ icon: Icon, title, description, onClick, tone }: { icon: LucideIcon; title: string; description?: string; onClick: () => void; tone?: "danger" }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="press flex min-h-[64px] w-full items-center gap-3.5 rounded-2xl px-2 py-2 text-left hover:bg-surface-2 active:bg-surface-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-[14px]", tone === "danger" ? "bg-danger/15 text-danger" : "bg-surface-2 text-fg")}>
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[16px] font-semibold", tone === "danger" && "text-danger")}>{title}</span>
          {description && <span className="block text-[13px] text-fg-muted">{description}</span>}
        </span>
        <ChevronRight className="size-5 shrink-0 text-fg-subtle" aria-hidden />
      </button>
    </li>
  );
}

type InfoSheet = "vendas" | "detalhes" | "historico" | null;

/* ---------------------------------- Tela ---------------------------------- */

/**
 * A rifa no celular: o resumo em números grandes, as quatro coisas que se faz
 * no dia a dia em botões grandes e a grade logo abaixo. Tudo o que existe no
 * computador continua acessível em "Mais opções".
 */
export function RaffleMobile(props: RaffleMobileProps) {
  const { campaign, sales, slots, summary, canSell, canManage, canClose, initialView, onOpenNumber } = props;
  const dir = useDirectory();
  const active = campaign.status === "active";

  const [shareOpen, setShareOpen] = useState(initialView === "divulgar");
  const [unpaidView, setUnpaidView] = useState<UnpaidView>(initialView === "reservados" ? "reservados" : "pendentes");
  const [unpaidOpen, setUnpaidOpen] = useState(initialView === "pendentes" || initialView === "reservados");
  const [batchOpen, setBatchOpen] = useState(false);
  const [info, setInfo] = useState<InfoSheet>(null);
  const [filter, setFilter] = useState<GridFilter>("all");

  const counts = useMemo(() => Object.fromEntries(GRID_FILTERS.map((f) => [f.value, slots.filter((s) => f.match(s.status)).length])) as Record<GridFilter, number>, [slots]);
  const visibleSlots = useMemo(() => {
    const rule = GRID_FILTERS.find((f) => f.value === filter)!;
    return filter === "all" ? slots : slots.filter((s) => rule.match(s.status));
  }, [slots, filter]);

  const showFree = () => {
    setFilter("available");
    document.getElementById("numeros")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const tapNumber = (n: number) => {
    const slot = slots[n - 1];
    if (slot?.status === "available" && canSell) props.onStartSale([n]);
    else onOpenNumber(n);
  };

  const pendingSales = sales.filter((s) => s.status === "pending").length;
  const tiles: Omit<ActionTileProps, "index">[] = [
    { icon: ListOrdered, color: "#94b6d0", title: "Números livres", info: summary.available === 0 ? "Todos vendidos 🎉" : `${summary.available} para vender`, onClick: showFree },
    { icon: MessageCircle, color: "#3fcf8e", title: "Mandar no WhatsApp", info: "Tabela ou lista de livres", onClick: () => setShareOpen(true) },
    {
      icon: Hourglass,
      color: "#f2a93b",
      title: "Quem não pagou",
      info: pendingSales === 0 ? "Ninguém devendo" : `${formatMoneyCompact(summary.receivableCents)} para receber`,
      onClick: () => {
        setUnpaidView("pendentes");
        setUnpaidOpen(true);
      },
      badge: pendingSales,
    },
  ];
  if (canSell && canManage) tiles.push({ icon: BookOpen, color: "#e88ab5", title: "Passar vendas antigas", info: "Do caderno para o sistema", onClick: () => setBatchOpen(true) });

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-5">
      <header className="anim-rise">
        <Link href="/campanhas" className="press -ml-1 inline-flex h-10 items-center gap-1.5 rounded-full pr-3 pl-1 text-[15px] font-medium text-fg-muted">
          <ArrowLeft className="size-5" aria-hidden /> Rifas
        </Link>
        <h1 className="mt-1 font-display text-[30px] leading-[1.05] font-extrabold tracking-[-0.01em]">{campaign.name}</h1>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <Gift className="size-4 text-gold-fg" aria-hidden /> {campaign.prize}
          </span>
          <span className="font-semibold text-fg">{formatMoney(campaign.unitPrice)} cada</span>
          {campaign.drawDate && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden /> Sorteio {formatDate(campaign.drawDate)}
            </span>
          )}
        </p>
      </header>

      {!active && (
        <div className="anim-rise flex gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-[14px]">
          <Lock className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <p>
            <b>Rifa encerrada</b>
            {campaign.closedAt && ` em ${formatDateTime(campaign.closedAt)}`}. Não dá mais para vender, mas ainda dá para confirmar pagamentos.
          </p>
        </div>
      )}

      <SummaryCard campaign={campaign} summary={summary} />

      {canSell && (
        <button
          type="button"
          onClick={() => props.onStartSale([])}
          className="press anim-rise relative flex min-h-[72px] items-center justify-center gap-3 overflow-hidden rounded-[22px] bg-gold text-[19px] font-extrabold text-gold-ink shadow-[0_14px_30px_-10px_rgba(225,175,55,0.7)]"
          style={delay(120)}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -top-[30%] -left-1/2 h-[160%] w-[30%] opacity-0 mix-blend-overlay"
            style={{
              background: "linear-gradient(90deg, rgba(255,250,230,0) 0%, rgba(255,250,230,.4) 50%, rgba(255,250,230,0) 100%)",
              animation: "shine-sweep 6s cubic-bezier(.45,0,.25,1) 2s infinite",
            }}
          />
          <span className="grid size-10 place-items-center rounded-full bg-gold-ink text-gold">
            <Plus className="size-6" strokeWidth={2.6} aria-hidden />
          </span>
          Registrar venda
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t, i) => (
          <ActionTile key={t.title} {...t} index={i} />
        ))}
      </div>

      <section id="numeros" aria-labelledby="numeros-titulo" className="anim-rise scroll-mt-20 rounded-[26px] border border-line bg-surface p-4" style={delay(380)}>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="numeros-titulo" className="font-display text-[22px] leading-none font-bold">
            Números
          </h2>
          <span className="text-[13px] text-fg-muted">{canSell && active ? "Toque num livre para vender" : "Toque para ver detalhes"}</span>
        </div>
        <div role="tablist" aria-label="Mostrar números" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {GRID_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "press h-10 shrink-0 rounded-full border px-4 text-[14px] font-semibold transition-colors",
                filter === f.value ? "border-gold bg-gold text-gold-ink" : "border-line-strong text-fg-muted",
              )}
            >
              {f.label} <span className="tnum opacity-75">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        {visibleSlots.length === 0 ? (
          <p className="rounded-2xl border border-line bg-sunken p-5 text-center text-[15px] text-fg-muted">Nenhum número aqui.</p>
        ) : (
          <NumberPad key={filter} slots={visibleSlots} total={campaign.quantity} onTap={tapNumber} />
        )}
        <div className="mt-4 border-t border-line pt-3">
          <SimpleLegend />
        </div>
      </section>

      <section aria-labelledby="mais-opcoes" className="anim-rise rounded-[26px] border border-line bg-surface p-3" style={delay(440)}>
        <h2 id="mais-opcoes" className="px-2 pt-1 pb-2 font-display text-[20px] font-bold">
          Mais opções
        </h2>
        <ul>
          <OptionRow icon={ListOrdered} title="Todas as vendas" description={`${sales.length} registradas, com busca`} onClick={() => setInfo("vendas")} />
          <OptionRow icon={Download} title="Baixar PDF ou planilha" description="Relatório completo da rifa" onClick={props.onExport} />
          <OptionRow icon={Info} title="Detalhes da rifa" description="Prêmio, datas e valores" onClick={() => setInfo("detalhes")} />
          <OptionRow icon={History} title="Histórico" description="Tudo o que mudou nesta rifa" onClick={() => setInfo("historico")} />
          {canManage && <OptionRow icon={Pencil} title="Editar rifa" description="Nome, prêmio, datas" onClick={() => props.onEdit("dados")} />}
          {canManage && <OptionRow icon={ShieldCheck} title="Quem pode ver e vender" onClick={() => props.onEdit("acesso")} />}
          {canClose &&
            (active ? (
              <OptionRow icon={Lock} title="Encerrar rifa" description="Bloqueia novas vendas" onClick={props.onClose} tone="danger" />
            ) : (
              <OptionRow icon={LockOpen} title="Reabrir rifa" description="Volta a aceitar vendas" onClick={props.onReopen} />
            ))}
        </ul>
      </section>

      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} campaign={campaign} slots={slots} />
      <UnpaidSheet
        open={unpaidOpen}
        onOpenChange={setUnpaidOpen}
        campaign={campaign}
        sales={sales}
        view={unpaidView}
        onViewChange={setUnpaidView}
        onOpenNumber={(n) => {
          setUnpaidOpen(false);
          onOpenNumber(n);
        }}
      />
      <BatchSheet open={batchOpen} onOpenChange={setBatchOpen} campaign={campaign} slots={slots} onConflict={props.onConflict} />

      <Dialog open={info !== null} onOpenChange={(o) => !o && setInfo(null)}>
        {info === "vendas" && (
          <BigSheetContent title="Todas as vendas" description={campaign.name}>
            <SalesTable
              campaign={campaign}
              sales={sales}
              onOpen={(n) => {
                setInfo(null);
                onOpenNumber(n);
              }}
            />
          </BigSheetContent>
        )}
        {info === "detalhes" && (
          <BigSheetContent title="Detalhes da rifa" description={campaign.code}>
            {campaign.description && <p className="mb-4 text-[15px] leading-relaxed text-fg-muted">{campaign.description}</p>}
            <DetailList
              items={[
                { label: "Prêmio", value: campaign.prize },
                { label: "Quantidade", value: `${campaign.quantity} números` },
                { label: "Valor de cada número", value: formatMoney(campaign.unitPrice) },
                { label: "Se vender tudo", value: formatMoney(campaign.quantity * campaign.unitPrice) },
                { label: "Início", value: formatDate(campaign.startDate) },
                { label: "Encerramento", value: formatDate(campaign.endDate) },
                { label: "Sorteio", value: formatDate(campaign.drawDate) },
                { label: "Evento relacionado", value: <RelatedEventLabel eventId={campaign.eventId} /> },
                { label: "Criada por", value: `${dir.memberName(campaign.createdBy)} · ${formatDate(campaign.createdAt)}` },
              ]}
            />
            {campaign.notes && <p className="mt-4 rounded-2xl border border-line bg-sunken px-4 py-3 text-[14px] text-fg-muted">{campaign.notes}</p>}
            <div className="mt-5 rounded-2xl border border-line bg-sunken p-4">
              <p className="mb-2 text-[15px] font-semibold">Quem pode ver e vender</p>
              <CampaignAccessSummary access={campaign.access} creatorId={campaign.createdBy} />
            </div>
          </BigSheetContent>
        )}
        {info === "historico" && (
          <BigSheetContent title="Histórico" description="O histórico de cada venda fica no detalhe do número.">
            <HistoryTimeline entries={campaign.history} limit={20} />
          </BigSheetContent>
        )}
      </Dialog>
    </div>
  );
}

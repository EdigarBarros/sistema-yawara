"use client";

import { useEffect, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ColumnSeries {
  name: string;
  /** Variável CSS da cor (tokens --chart-*, validados para daltonismo). */
  color: string;
}

export interface ColumnGroup {
  label: string;
  values: number[];
}

interface Props {
  title: string;
  series: ColumnSeries[];
  groups: ColumnGroup[];
  format: (v: number) => string;
  /** Linha extra opcional no tooltip (ex.: saldo do mês). */
  extra?: (g: ColumnGroup) => { label: string; value: string } | null;
  height?: number;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function compact(v: number) {
  if (v >= 1000) return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR");
}

/**
 * Colunas agrupadas simples: barras finas (até 24px) com ponta arredondada,
 * 2px de respiro entre barras vizinhas, grade discreta, legenda, tooltip por
 * grupo e visualização em tabela.
 */
export function ColumnChart({ title, series, groups, format, extra, height = 240 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padL = 52;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const max = niceMax(Math.max(0, ...groups.flatMap((g) => g.values)) / 100) * 100; // valores em centavos
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const band = groups.length ? plotW / groups.length : plotW;
  const barW = Math.min(24, Math.max(6, (band * 0.6 - (series.length - 1) * 2) / series.length));
  const groupW = barW * series.length + (series.length - 1) * 2;
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const r = 4;
  const columnPath = (x: number, top: number, w: number) => {
    const h = padT + plotH - top;
    if (h <= 0) return "";
    const rr = Math.min(r, h, w / 2);
    const base = padT + plotH;
    return `M${x},${base} L${x},${top + rr} Q${x},${top} ${x + rr},${top} L${x + w - rr},${top} Q${x + w},${top} ${x + w},${top + rr} L${x + w},${base} Z`;
  };

  return (
    <div ref={wrapRef}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-4 text-[12.5px] text-fg-muted" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.name} className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: `var(${s.color})` }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          <Table2 /> {showTable ? "Ver gráfico" : "Ver tabela"}
        </Button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] tracking-wide text-fg-subtle uppercase">
                <th className="py-2 pr-4 font-semibold">Período</th>
                {series.map((s) => (
                  <th key={s.name} className="py-2 pr-4 text-right font-semibold">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.label} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4">{g.label}</td>
                  {g.values.map((v, i) => (
                    <td key={i} className="tnum py-2 pr-4 text-right font-mono">
                      {format(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg width={width} height={height} role="img" aria-label={title} className="block max-w-full">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--fg-subtle)" className="tnum">
                  {compact(t / 100)}
                </text>
              </g>
            ))}
            {groups.map((g, gi) => {
              const x0 = padL + gi * band + (band - groupW) / 2;
              return (
                <g key={g.label}>
                  {hover === gi && <rect x={padL + gi * band} y={padT} width={band} height={plotH} fill="var(--fg)" opacity={0.04} />}
                  {g.values.map((v, si) => (
                    <path key={si} d={columnPath(x0 + si * (barW + 2), y(v), barW)} fill={`var(${series[si].color})`} />
                  ))}
                  <text x={padL + gi * band + band / 2} y={height - 8} textAnchor="middle" fontSize={11.5} fill="var(--fg-muted)">
                    {g.label}
                  </text>
                  <rect
                    x={padL + gi * band}
                    y={padT}
                    width={band}
                    height={plotH + padB}
                    fill="transparent"
                    onMouseEnter={() => setHover(gi)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(gi)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${g.label}: ${g.values.map((v, i) => `${series[i].name} ${format(v)}`).join(", ")}`}
                  />
                </g>
              );
            })}
          </svg>
          {hover !== null && groups[hover] && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-10 min-w-[180px] rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-[12.5px] shadow-pop"
              style={{ left: Math.min(Math.max(padL + hover * band + band / 2 - 90, 0), width - 190) }}
            >
              <p className="mb-1.5 font-semibold">{groups[hover].label}</p>
              {groups[hover].values.map((v, i) => (
                <p key={i} className="flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-fg-muted">
                    <span className="size-2 rounded-sm" style={{ background: `var(${series[i].color})` }} />
                    {series[i].name}
                  </span>
                  <span className="tnum font-mono">{format(v)}</span>
                </p>
              ))}
              {extra?.(groups[hover]) && (
                <p className="mt-1.5 flex justify-between gap-4 border-t border-line pt-1.5">
                  <span className="text-fg-muted">{extra(groups[hover])!.label}</span>
                  <span className="tnum font-mono font-semibold">{extra(groups[hover])!.value}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

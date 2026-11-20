"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { SportModality } from "@/types";
import { inkOn, SPORT_RULES } from "@/lib/sports";
import { clampToCourt, FLOOR, type CourtPlayer } from "./court-geometry";

/**
 * Quadra vista de cima (SVG): usada no celular, sem WebGL ou com "reduzir
 * movimento". Mesmas coordenadas da quadra 3D; tocar e arrastar move o jogador.
 */
export function Court2D({
  modality,
  color,
  players,
  selectedId,
  editable,
  onSelect,
  onMove,
}: {
  modality: SportModality;
  color: string;
  players: CourtPlayer[];
  selectedId: string | null;
  editable: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}) {
  const r = SPORT_RULES[modality];
  const f = FLOOR[modality];
  const pad = 1.5;
  const L = r.length;
  const W = r.width;
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // SVG: x → comprimento, y → largura (z). Origem no canto da área externa.
  const toSvg = (x: number, z: number) => ({
    cx: x + L / 2 + pad,
    cy: z + W / 2 + pad,
  });
  const fromEvent = (e: PointerEvent) => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return clampToCourt(modality, p.x - pad - L / 2, p.y - pad - W / 2);
  };

  const line = { stroke: f.line, strokeWidth: 0.1, fill: "none" };
  const ox = pad;
  const oy = pad;
  const parts = [];
  if (modality === "futsal" || modality === "handebol") {
    for (const s of [-1, 1]) {
      const gx = s === -1 ? ox : ox + L;
      parts.push(
        <path
          key={`a${s}`}
          d={`M ${gx} ${oy + W / 2 - 6} A 6 6 0 0 ${s === -1 ? 1 : 0} ${gx} ${oy + W / 2 + 6}`}
          {...line}
          fill={f.zone}
          fillOpacity={0.6}
        />,
      );
      parts.push(
        <rect
          key={`g${s}`}
          x={s === -1 ? gx - 0.8 : gx}
          y={oy + W / 2 - 1.5}
          width={0.8}
          height={3}
          fill="#f4f6fb"
          opacity={0.85}
        />,
      );
    }
    parts.push(
      <circle key="c" cx={ox + L / 2} cy={oy + W / 2} r={3} {...line} />,
    );
  }
  if (modality === "basquete") {
    for (const s of [-1, 1]) {
      const kx = s === -1 ? ox : ox + L - 5.8;
      parts.push(
        <rect
          key={`k${s}`}
          x={kx}
          y={oy + W / 2 - 2.45}
          width={5.8}
          height={4.9}
          {...line}
          fill={f.zone}
          fillOpacity={0.6}
        />,
      );
      const hx = s === -1 ? ox + 1.575 : ox + L - 1.575;
      parts.push(
        <path
          key={`t${s}`}
          d={`M ${hx} ${oy + W / 2 - 6.75} A 6.75 6.75 0 0 ${s === -1 ? 1 : 0} ${hx} ${oy + W / 2 + 6.75}`}
          {...line}
        />,
      );
      parts.push(
        <circle
          key={`h${s}`}
          cx={hx}
          cy={oy + W / 2}
          r={0.3}
          stroke="#e5571f"
          strokeWidth={0.1}
          fill="none"
        />,
      );
    }
    parts.push(
      <circle key="c" cx={ox + L / 2} cy={oy + W / 2} r={1.8} {...line} />,
    );
  }
  if (modality === "volei") {
    parts.push(
      <line
        key="a1"
        x1={ox + L / 2 - 3}
        y1={oy}
        x2={ox + L / 2 - 3}
        y2={oy + W}
        {...line}
      />,
    );
    parts.push(
      <line
        key="a2"
        x1={ox + L / 2 + 3}
        y1={oy}
        x2={ox + L / 2 + 3}
        y2={oy + W}
        {...line}
      />,
    );
    parts.push(
      <line
        key="net"
        x1={ox + L / 2}
        y1={oy - 0.8}
        x2={ox + L / 2}
        y2={oy + W + 0.8}
        stroke="#0b1a55"
        strokeWidth={0.25}
      />,
    );
  }

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${L + pad * 2} ${W + pad * 2}`}
      className="block h-full w-full touch-none select-none"
      role="img"
      aria-label={`Quadra de ${r.label.toLowerCase()} vista de cima com ${players.length} titulares`}
      onPointerMove={(e) => {
        if (!dragging) return;
        const p = fromEvent(e);
        onMove(dragging, p.x, p.z);
      }}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
      onClick={(e) => {
        if (e.target === svg.current) onSelect(null);
      }}
    >
      <rect
        x={0}
        y={0}
        width={L + pad * 2}
        height={W + pad * 2}
        rx={0.6}
        fill={f.outer}
      />
      <rect
        x={ox}
        y={oy}
        width={L}
        height={W}
        fill={f.court}
        {...{ stroke: f.line, strokeWidth: 0.1 }}
      />
      <line x1={ox + L / 2} y1={oy} x2={ox + L / 2} y2={oy + W} {...line} />
      {parts}
      {players.map((p, i) => {
        const { cx, cy } = toSvg(p.x, p.z);
        const selected = p.id === selectedId;
        return (
          <g
            key={p.id}
            transform={`translate(${cx} ${cy})`}
            style={{ cursor: editable ? "grab" : "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(p.id);
              if (editable) {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDragging(p.id);
              }
            }}
          >
            {/* A animação fica num grupo interno: no SVG, o "transform" do CSS substituiria a posição. */}
            <g
              className="anim-pop"
              style={{
                animationDelay: `${i * 50}ms`,
                transformBox: "fill-box",
                transformOrigin: "center",
              }}
            >
              <circle r={1.25} fill="transparent" />
              {selected && (
                <circle
                  r={1.05}
                  fill="none"
                  stroke="#e1af37"
                  strokeWidth={0.18}
                />
              )}
              <circle
                r={0.78}
                fill={color}
                stroke="#030f45"
                strokeWidth={0.12}
              />
              <text
                y={0.3}
                textAnchor="middle"
                fontSize={0.85}
                fontWeight={800}
                fill={inkOn(color)}
                style={{ pointerEvents: "none" }}
              >
                {p.number}
              </text>
              <text
                y={1.75}
                textAnchor="middle"
                fontSize={0.6}
                fontWeight={600}
                fill="#f4f6fb"
                style={{ pointerEvents: "none" }}
              >
                {p.short}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

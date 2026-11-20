"use client";

import type { CSSProperties } from "react";
import type { Board, PieceData } from "./boards";

/** Camadas do escudo, uma atrás da outra: dão a borda de moeda quando ele balança. */
const LAYERS = 10;
/** Alturas desencontradas das peças em volta do escudo (px). */
const DY = [-58, 40, -24, 62, -50, 26, -12, 54];

export function Piece({ p }: { p: PieceData }) {
  return (
    <div className="pc" data-tone={p.tone ?? "gold"}>
      <div className="pc-head">
        <span className="pc-icon">{p.icon}</span>
        <span>{p.title}</span>
      </div>
      {p.body}
    </div>
  );
}

export function Coin() {
  return (
    <div className="orb-coin-arrive">
      <div className="orb-coin">
        <div className="orb-coin-shadow" />
        {Array.from({ length: LAYERS }, (_, k) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={k} src="/brand/escudo.png" alt="" draggable={false} className={k === 0 ? "front" : undefined} style={{ "--k": k } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

/**
 * O escudo da Yawara no centro e as peças de UMA diretoria girando em volta.
 * Quando a diretoria troca, as peças antigas voltam para dentro do escudo
 * (`leaving`) e as novas saem dele.
 */
export function Orbit({ board, leaving }: { board: Board; leaving: Board | null }) {
  const n = board.pieces.length;
  const slots = (b: Board, mode: "in" | "out") =>
    b.pieces.map((p, i) => (
      <div key={`${b.key}-${i}`} className="orb-slot" style={{ "--a": `${(360 / n) * i}deg`, "--dy": `${DY[i % DY.length]}px`, "--i": i } as CSSProperties}>
        <div className={mode === "in" ? "orb-enter" : "orb-leave"}>
          <div className="orb-face">
            <div className="orb-float">
              <Piece p={p} />
            </div>
          </div>
        </div>
      </div>
    ));
  // Cada diretoria tem o seu próprio anel, que começa a girar quando ela entra: o giro do anel e o das peças
  // (que se viram para quem olha) começam juntos, sem precisar acertar o passo com o anel anterior.
  return (
    <div className="orb-tilt">
      {leaving && (
        <div key={`ring-${leaving.key}`} className="orb-ring">
          {slots(leaving, "out")}
        </div>
      )}
      <div key={`ring-${board.key}`} className="orb-ring">
        {slots(board, "in")}
      </div>
      <Coin />
    </div>
  );
}

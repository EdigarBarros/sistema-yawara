"use client";

import type { CSSProperties, ReactNode } from "react";
import { CalendarDays, Check, ClipboardList, GraduationCap, Megaphone, Trophy, Wallet } from "lucide-react";
import "./emblem-orbit.css";

/**
 * Cena 3D da tela de entrada (inspirada na abertura do OpusCash): o escudo da
 * Yawara, com espessura, balança no centro; em volta, peças da Central giram
 * em órbita, passando por trás e pela frente dele, sempre viradas para quem
 * olha. Tudo é transform e opacidade (a placa de vídeo desenha), sem filtros
 * em camadas grandes. As peças são fictícias: só ilustram o que a Central faz.
 *
 * A palavra de "Para a diretoria de …" troca junto com a peça que passa na
 * frente (mesma duração de giro: ORBIT_SECONDS; ver `DiretoriaWord`).
 */

export const ORBIT_SECONDS = 30;
/** Camadas do escudo, uma atrás da outra: dão a borda de moeda quando ele balança. */
const LAYERS = 9;

interface Piece {
  key: string;
  dy: number;
  node: ReactNode;
}

function Card({ icon, title, children, tone = "gold" }: { icon: ReactNode; title: string; children: ReactNode; tone?: "gold" | "ok" | "info" | "rose" }) {
  return (
    <div className="orb-card" data-tone={tone}>
      <div className="orb-card-head">
        <span className="orb-card-icon">{icon}</span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Uma peça por diretoria, na mesma ordem das palavras da frase "Para a
 * diretoria de …" (DiretoriaWord): a palavra troca quando a peça dela passa na frente.
 */
const PIECES: (Piece & { word: string })[] = [
  {
    key: "eventos",
    word: "Eventos",
    dy: -44,
    node: (
      <Card icon={<CalendarDays />} title="Agenda" tone="info">
        <div className="orb-date">
          <b>22</b>
          <span>
            NOV
            <em>Recepção aos calouros</em>
          </span>
        </div>
      </Card>
    ),
  },
  {
    key: "secretaria",
    word: "Secretaria",
    dy: 34,
    node: (
      <Card icon={<ClipboardList />} title="Ata da reunião" tone="ok">
        <div className="orb-pill">
          <Check /> Aprovada
        </div>
      </Card>
    ),
  },
  {
    key: "financeiro",
    word: "Financeiro",
    dy: -26,
    node: (
      <Card icon={<Wallet />} title="Financeiro" tone="ok">
        <div className="orb-big orb-ok">+ R$ 912,00</div>
        <div className="orb-cols">
          {[38, 62, 44, 80, 56, 92].map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      </Card>
    ),
  },
  {
    key: "comunicacao",
    word: "Comunicação",
    dy: 46,
    node: (
      <Card icon={<Megaphone />} title="Post agendado" tone="rose">
        <div className="orb-file">
          <span className="orb-post">IG</span>
          Arte da Calourada
        </div>
      </Card>
    ),
  },
  {
    key: "esportes",
    word: "Esportes",
    dy: -40,
    node: (
      <Card icon={<Trophy />} title="Futsal">
        <div className="orb-score">
          Yawara <b>3 × 1</b>
        </div>
      </Card>
    ),
  },
  {
    key: "extensao",
    word: "Ensino e Extensão",
    dy: 30,
    node: (
      <Card icon={<GraduationCap />} title="Palestra" tone="info">
        <div className="orb-big">
          48<small> certificados</small>
        </div>
      </Card>
    ),
  },
];

export const ORBIT_KEYS = PIECES.map((p) => p.key);

/**
 * "Para a diretoria de <palavra>": a palavra vira em 3D (como um letreiro) e
 * troca quando a peça da diretoria dela passa na frente do escudo.
 * A peça i fica na frente quando o anel girou 360° − i·(360°/n); o atraso
 * negativo de i/n do ciclo põe a palavra "de pé" (0% e 100%) nesse instante.
 */
export function DiretoriaWord({ className }: { className?: string }) {
  const n = PIECES.length;
  return (
    <span className={className}>
      <span className="sr-only">Para as diretorias de {PIECES.map((p) => p.word).join(", ")}.</span>
      <span aria-hidden className="orb-line">
        Para a diretoria de{" "}
        <span className="orb-words">
          {PIECES.map((p, i) => (
            <span key={p.key} className="orb-word" style={{ animationDelay: `${-(ORBIT_SECONDS * i) / n}s` } as CSSProperties}>
              {p.word}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export function EmblemOrbit() {
  const n = PIECES.length;
  return (
    <div className="orb-stage" aria-hidden style={{ "--T": `${ORBIT_SECONDS}s` } as CSSProperties}>
      <div className="orb-glow" />
      <div className="orb-scene">
        <div className="orb-tilt">
          <div className="orb-ring">
            {PIECES.map((p, i) => (
              <div key={p.key} className="orb-slot" style={{ "--a": `${(360 / n) * i}deg`, "--dy": `${p.dy}px`, "--i": i, "--phase": `${-(ORBIT_SECONDS * i) / n}s` } as CSSProperties}>
                <div className="orb-enter">
                  <div className="orb-face">
                    <div className="orb-float">
                      <div className="orb-depth">{p.node}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="orb-coin-arrive">
            <div className="orb-coin">
              <div className="orb-coin-shadow" />
              {Array.from({ length: LAYERS }, (_, k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={k} src="/brand/escudo.png" alt="" draggable={false} className={k === 0 ? "front" : undefined} style={{ "--k": k } as CSSProperties} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

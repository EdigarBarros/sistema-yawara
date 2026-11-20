"use client";

import type { CSSProperties } from "react";
import { Check, CloudUpload, Heart, MousePointer2, Stamp, Ticket, Trophy, Wallet } from "lucide-react";

/**
 * Cenas 3D da tela de entrada, uma por recurso da Central. Cada cena dura
 * SCENE_MS (showcase.tsx) e toca a sua animação uma vez do começo ao fim.
 * Tudo é CSS 3D (transform e opacidade nas últimas camadas).
 */

const v = (o: Record<string, string | number>) => o as CSSProperties;

/* ------------------------------ Documentos ------------------------------ */

export function DocsScene() {
  const docs = [
    { tag: "PDF", name: "Estatuto 2026", c: "#e0485e" },
    { tag: "ATA", name: "Ata · 27/11", c: "#2f9e6e" },
    { tag: "DOC", name: "Ofício nº 12", c: "#3b82f6" },
  ];
  return (
    <div className="dc">
      {/* o servidor: um bloco com frente, laterais e tampa */}
      <div className="dc-server">
        <div className="dc-face dc-front">
          <div className="dc-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/escudo.png" alt="" />
            <span>YAWARA · ARQUIVO</span>
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="dc-unit">
              <i style={v({ "--d": `${i * 0.37}s` })} />
              <i style={v({ "--d": `${i * 0.21 + 0.5}s` })} />
              <span />
            </div>
          ))}
          <div className="dc-slot" />
        </div>
        <div className="dc-face dc-back" />
        <div className="dc-face dc-right" />
        <div className="dc-face dc-left" />
        <div className="dc-face dc-top" />
      </div>
      {/* arquivos voando para dentro do servidor */}
      {docs.map((d, i) => (
        <div key={d.name} className="dc-doc" style={v({ "--i": i })}>
          <span style={{ background: d.c }}>{d.tag}</span>
          {d.name}
        </div>
      ))}
      {/* cartão de envio */}
      <div className="sc-card dc-upload">
        <div className="sc-card-head">
          <CloudUpload /> Enviar documento
        </div>
        <p>Estatuto 2026.pdf</p>
        <div className="sc-bar">
          <i className="dc-fill" />
        </div>
        <div className="dc-done">
          <Check /> Guardado no banco da Atlética
        </div>
      </div>
      <div className="sc-chip dc-count">
        <b>128</b> documentos guardados
      </div>
    </div>
  );
}

/* -------------------------------- Rifas --------------------------------- */

/** Ordem em que os números "vendem" (parece aleatória, mas é sempre a mesma). */
const SOLD_ORDER = [7, 22, 3, 31, 15, 38, 11, 26, 1, 34, 19, 9, 28, 5, 36, 13, 24, 17];
const PRE_SOLD = new Set([0, 2, 4, 8, 10, 12, 14, 16, 18, 20, 23, 25, 27, 29, 32, 35, 37, 39].filter((n) => !SOLD_ORDER.includes(n)));

export function RaffleScene() {
  return (
    <div className="rf">
      <div className="rf-board">
        {Array.from({ length: 40 }, (_, n) => {
          const order = SOLD_ORDER.indexOf(n);
          return (
            <div key={n} className={order >= 0 ? "rf-n rf-sell" : PRE_SOLD.has(n) ? "rf-n rf-sold" : "rf-n"} style={order >= 0 ? v({ "--d": `${1.4 + order * 0.22}s` }) : undefined}>
              {String(n + 1).padStart(2, "0")}
            </div>
          );
        })}
      </div>
      <div className="sc-card rf-new">
        <div className="sc-card-head">
          <Ticket /> Nova rifa
        </div>
        <div className="rf-field">
          <small>Nome</small>
          <span className="sc-type" style={v({ "--w": "11ch", "--d": "0.5s" })}>
            Rifa Yawara
          </span>
        </div>
        <div className="rf-row">
          <div className="rf-field">
            <small>Número</small>
            <span>R$ 5,00</span>
          </div>
          <div className="rf-field">
            <small>Números</small>
            <span>40</span>
          </div>
        </div>
        <div className="sc-btn rf-btn">Criar rifa</div>
      </div>
      <div className="sc-toast rf-toast">
        <Check /> Venda registrada · nº 37 · Pix
      </div>
    </div>
  );
}

/* ------------------------------- Esportes ------------------------------- */

/** Do banco (fora do campo) para a posição no 3-1 do futsal. Coordenadas em px no campo (380 × 240). */
const PLAYERS = [
  { n: 1, name: "Bia", from: [-60, 40], to: [26, 120] },
  { n: 4, name: "Lu", from: [-60, 90], to: [110, 60] },
  { n: 5, name: "Jo", from: [-60, 140], to: [110, 180] },
  { n: 8, name: "Ana", from: [-60, 190], to: [190, 120] },
  { n: 10, name: "Mel", from: [-60, 240], to: [270, 120] },
];

export function SportsScene() {
  return (
    <div className="es">
      <div className="es-field">
        <div className="es-mid" />
        <div className="es-circle" />
        <div className="es-area es-area-l" />
        <div className="es-area es-area-r" />
        <div className="es-goal es-goal-l" />
        <div className="es-goal es-goal-r" />
        {PLAYERS.map((p, i) => (
          <div key={p.n} className="es-p" style={v({ "--fx": `${p.from[0]}px`, "--fy": `${p.from[1]}px`, "--tx": `${p.to[0]}px`, "--ty": `${p.to[1]}px`, "--d": `${0.8 + i * 0.45}s` })}>
            <div className="es-stand">
              <span className="es-shirt">{p.n}</span>
              <span className="es-name">{p.name}</span>
              {i === 3 && <MousePointer2 className="es-cursor" />}
            </div>
          </div>
        ))}
        <div className="es-ball" />
      </div>
      <div className="sc-card es-card">
        <div className="sc-card-head">
          <Trophy /> Futsal feminino
        </div>
        <p>Escalação · sábado 10h</p>
        <div className="es-count">
          <b className="es-num" /> de 5 em campo
        </div>
        <div className="sc-btn es-btn">Salvar time</div>
      </div>
    </div>
  );
}

/* ------------------------------ Comunicação ----------------------------- */

export function CommsScene() {
  return (
    <div className="cm">
      <div className="cm-phone">
        <div className="cm-layer" style={v({ "--k": 3 })} />
        <div className="cm-layer" style={v({ "--k": 2 })} />
        <div className="cm-layer" style={v({ "--k": 1 })} />
        <div className="cm-screen">
          <div className="cm-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/escudo.png" alt="" />
            <b>atleticayawara</b>
          </div>
          <div className="cm-art">
            <span className="cm-art-a">CALOURADA</span>
            <span className="cm-art-b">2026</span>
            <span className="cm-art-c">22 · NOV · 20H</span>
          </div>
          <div className="cm-actions">
            <Heart className="cm-heart" />
          </div>
          <div className="cm-caption">
            <span className="sc-type" style={v({ "--w": "24ch", "--d": "1.6s" })}>
              Chegou a hora, calouros! 🐆
            </span>
            <span className="sc-type" style={v({ "--w": "22ch", "--d": "2.6s" })}>
              Ingressos com a diretoria.
            </span>
          </div>
          <div className="sc-btn cm-btn">
            <span className="cm-btn-a">Agendar post</span>
            <span className="cm-btn-b">
              <Check /> Agendado · sex 18h
            </span>
          </div>
        </div>
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <Heart key={i} className="cm-float" style={v({ "--i": i })} />
      ))}
      <div className="sc-chip cm-chip">
        <b>Instagram</b> · sexta, 18h
      </div>
    </div>
  );
}

/* ------------------------------ Financeiro ------------------------------ */

const BARS = [42, 58, 50, 74, 66, 92];

export function FinanceScene() {
  return (
    <div className="fn">
      <div className="fn-chart">
        <div className="fn-floor" />
        {BARS.map((h, i) => (
          <div key={i} className="fn-bar" style={v({ "--h": `${h * 1.9}px`, "--x": `${i * 52}px`, "--d": `${0.4 + i * 0.12}s` })}>
            <div className="fn-face fn-front" />
            <div className="fn-face fn-side" />
            <div className="fn-face fn-top" />
          </div>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="fn-coin" style={v({ "--i": i })}>
            R$
          </div>
        ))}
      </div>
      <div className="sc-card fn-card">
        <div className="sc-card-head">
          <Wallet /> Saldo da Atlética
        </div>
        <div className="fn-total">R$ 4.454,70</div>
        <div className="fn-pill">+ R$ 912,00 em setembro</div>
      </div>
      <div className="sc-toast fn-toast">
        <Check /> Pix recebido · Rifa Yawara
      </div>
    </div>
  );
}

/* ------------------------------ Secretaria ------------------------------ */

export function SecretaryScene() {
  // Novembro de 2026 começa num domingo; a semana do calendário começa na segunda (6 casas vazias antes do dia 1).
  const days = Array.from({ length: 35 }, (_, i) => i - 5);
  return (
    <div className="sr">
      <div className="sr-cal">
        <div className="sr-back" />
        <div className="sr-head">
          <b>Novembro</b> 2026
        </div>
        <div className="sr-week">
          {["S", "T", "Q", "Q", "S", "S", "D"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="sr-grid">
          {days.map((d, i) => (
            <span key={i} className={d === 27 ? "sr-day sr-target" : "sr-day"}>
              {d > 0 && d <= 30 ? d : ""}
            </span>
          ))}
        </div>
        <div className="sr-meet">
          <b>Reunião da diretoria</b>
          <span>Sex, 27 · 18h · Sala 3</span>
        </div>
      </div>
      <div className="sr-faces">
        {["RL", "HP", "CM", "LM", "BT"].map((x, i) => (
          <i key={x} style={v({ "--i": i })}>
            {x}
          </i>
        ))}
        <span className="sr-ok">
          <Check /> 11 confirmados
        </span>
      </div>
      <div className="sr-stamp">
        <Stamp />
        ATA APROVADA
      </div>
    </div>
  );
}

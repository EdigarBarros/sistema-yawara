"use client";

import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { motionReduced } from "@/stores/ui";
import { BOARDS } from "./boards";
import { Orbit } from "./orbit";
import { CommsScene, DocsScene, FinanceScene, RaffleScene, SecretaryScene, SportsScene } from "./scenes";
import "./showcase.css";

/**
 * Vitrine 3D da tela de entrada (a tela aparece antes do login; tudo aqui é
 * ilustrativo). Um ciclo:
 *  1. Órbita: o escudo e 8 peças de UMA diretoria girando; a cada BOARD_MS a
 *     diretoria troca (peças e a palavra de "Para a diretoria de …").
 *  2. Uma cena 3D por recurso (documentos, rifas, esportes, comunicação,
 *     financeiro, secretaria), SCENE_MS cada, com a sua frase.
 *  3. Volta para a órbita.
 * Com "Animações reduzidas", fica parada na primeira diretoria.
 */

const BOARD_MS = 5200;
const SCENE_MS = 7200;
/** Tempo da saída (a cena/diretoria anterior continua na tela enquanto sai). */
const LEAVE_MS = 900;

interface Feature {
  key: string;
  /** Frase em duas partes: a primeira menor, a segunda grande e dourada. */
  lines: [string, string];
  Scene: ComponentType;
}

const FEATURES: Feature[] = [
  { key: "docs", lines: ["Guarde os documentos", "da Atlética"], Scene: DocsScene },
  { key: "rifas", lines: ["Crie rifas e registre", "cada venda"], Scene: RaffleScene },
  { key: "esportes", lines: ["Monte os times", "da Atlética"], Scene: SportsScene },
  { key: "comunicacao", lines: ["Prepare os posts", "do Instagram"], Scene: CommsScene },
  { key: "financeiro", lines: ["Acompanhe as finanças", "real por real"], Scene: FinanceScene },
  { key: "secretaria", lines: ["Marque reuniões", "e aprove as atas"], Scene: SecretaryScene },
];

/** 0 = órbita; 1..n = FEATURES[i - 1]. */
type Step = { scene: number; board: number };

function next({ scene, board }: Step): Step {
  if (scene === 0 && board < BOARDS.length - 1) return { scene: 0, board: board + 1 };
  return { scene: (scene + 1) % (FEATURES.length + 1), board: 0 };
}

export function useShowcase() {
  const [step, setStep] = useState<Step>({ scene: 0, board: 0 });
  const [prev, setPrev] = useState<Step | null>(null);

  useEffect(() => {
    if (motionReduced()) return;
    const t = window.setTimeout(
      () => {
        setPrev(step);
        setStep(next(step));
      },
      step.scene === 0 ? BOARD_MS : SCENE_MS,
    );
    return () => window.clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (!prev) return;
    const t = window.setTimeout(() => setPrev(null), LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [prev]);

  return { step, prev };
}

/** Texto em letras soltas: cada letra chega voando do fundo, uma depois da outra. */
function Letters({ text, from = 0, className }: { text: string; from?: number; className?: string }) {
  return (
    <span className={className}>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="cp-ch" style={{ "--i": from + i } as CSSProperties}>
          {ch === " " ? "\u00a0" : ch}
        </span>
      ))}
    </span>
  );
}

/**
 * A frase dentro do palco 3D, logo abaixo do escudo (ou do objeto da cena):
 * as peças passam na frente e atrás dela. Na órbita, a palavra da diretoria
 * se monta de novo a cada troca.
 */
function Caption({ step }: { step: Step }) {
  if (step.scene === 0) {
    const intro = "Para a diretoria de";
    return (
      <div className="cp cp-orbit">
        <Letters key="intro" text={intro} className="cp-small" />
        <Letters key={BOARDS[step.board].key} text={BOARDS[step.board].word} from={6} className="cp-big" />
      </div>
    );
  }
  const f = FEATURES[step.scene - 1];
  const [a, b] = f.lines;
  return (
    <div className={`cp cp-${f.key}`}>
      <Letters text={a} className="cp-small" />
      <Letters text={b} from={a.length * 0.5} className="cp-big" />
    </div>
  );
}

function SceneLayer({ step, leaving, prevBoard }: { step: Step; leaving?: boolean; prevBoard?: number | null }) {
  const Feature = step.scene > 0 ? FEATURES[step.scene - 1].Scene : null;
  return (
    <div className={leaving ? "sw-scene sw-out" : "sw-scene sw-in"}>
      <div className="sw-root">
        {Feature ? <Feature /> : <Orbit board={BOARDS[step.board]} leaving={prevBoard != null ? BOARDS[prevBoard] : null} />}
        <Caption step={step} />
      </div>
    </div>
  );
}

/** O palco 3D. Recebe o estado de `useShowcase` (a frase usa o mesmo estado). */
export function ShowcaseStage({ step, prev }: ReturnType<typeof useShowcase>) {
  // Troca de diretoria dentro da órbita: o palco é o mesmo, só as peças saem e entram.
  const boardSwap = prev && prev.scene === 0 && step.scene === 0 ? prev.board : null;
  const sceneSwap = prev && prev.scene !== step.scene ? prev : null;
  return (
    <div className="sw-stage" aria-hidden>
      <div className="sw-glow" />
      <div className="sw-scale">
        {sceneSwap && <SceneLayer key={`s-${sceneSwap.scene}`} step={sceneSwap} leaving />}
        <SceneLayer key={`s-${step.scene}`} step={step} prevBoard={boardSwap} />
      </div>
    </div>
  );
}

/** Resumo para leitores de tela (o palco é decorativo e muda sozinho). */
export function ShowcaseSummary() {
  return (
    <p className="sr-only">
      Para as diretorias de {BOARDS.map((b) => b.word).join(", ")}. {FEATURES.map((f) => f.lines.join(" ")).join(". ")}.
    </p>
  );
}

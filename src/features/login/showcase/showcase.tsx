"use client";

import { useEffect, useState, type ComponentType } from "react";
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
  text: string;
  Scene: ComponentType;
}

const FEATURES: Feature[] = [
  { key: "docs", text: "Guarde os documentos da Atlética", Scene: DocsScene },
  { key: "rifas", text: "Crie rifas e registre cada venda", Scene: RaffleScene },
  { key: "esportes", text: "Monte os times da Atlética", Scene: SportsScene },
  { key: "comunicacao", text: "Prepare os posts do Instagram", Scene: CommsScene },
  { key: "financeiro", text: "Acompanhe cada real da Atlética", Scene: FinanceScene },
  { key: "secretaria", text: "Marque reuniões e aprove as atas", Scene: SecretaryScene },
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

function SceneLayer({ step, leaving, prevBoard }: { step: Step; leaving?: boolean; prevBoard?: number | null }) {
  const Feature = step.scene > 0 ? FEATURES[step.scene - 1].Scene : null;
  return (
    <div className={leaving ? "sw-scene sw-out" : "sw-scene sw-in"}>
      <div className="sw-root">
        {Feature ? <Feature /> : <Orbit board={BOARDS[step.board]} leaving={prevBoard != null ? BOARDS[prevBoard] : null} />}
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

/** A frase que acompanha o palco: "Para a diretoria de …" na órbita, e a frase de cada cena depois. */
export function ShowcaseLine({ step }: { step: Step }) {
  const all = `Para as diretorias de ${BOARDS.map((b) => b.word).join(", ")}. ${FEATURES.map((f) => f.text).join(". ")}.`;
  return (
    <span className="sw-line">
      <span className="sr-only">{all}</span>
      <span aria-hidden>
        {step.scene === 0 ? (
          <span key="orbit" className="sw-flip">
            Para a diretoria de{" "}
            <span key={BOARDS[step.board].key} className="sw-word sw-flip">
              {BOARDS[step.board].word}
            </span>
          </span>
        ) : (
          <span key={FEATURES[step.scene - 1].key} className="sw-flip">
            {FEATURES[step.scene - 1].text}
          </span>
        )}
      </span>
    </span>
  );
}

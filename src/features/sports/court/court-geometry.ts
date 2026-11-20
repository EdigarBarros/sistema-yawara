import type { SportModality } from "@/types";
import { SPORT_RULES } from "@/lib/sports";

/** Peça da quadra exibida em 3D e em 2D. Coordenadas em metros a partir do centro. */
export interface CourtPlayer {
  id: string;
  x: number;
  z: number;
  number: number;
  name: string;
  short: string;
}

export type CameraPreset = "top" | "side" | "bench";

/** Cores do piso por modalidade (madeira para vôlei/basquete, sintético para futsal/handebol). */
export const FLOOR: Record<SportModality, { court: string; outer: string; line: string; zone?: string }> = {
  futsal: { court: "#2c6fb8", outer: "#1d4f86", line: "#f4f6fb", zone: "#245f9e" },
  handebol: { court: "#2e7d5b", outer: "#1d5a40", line: "#f4f6fb", zone: "#e9a63c" },
  volei: { court: "#d8894a", outer: "#3a6fb6", line: "#f4f6fb", zone: "#c97a3f" },
  basquete: { court: "#c98d55", outer: "#a8703c", line: "#f4f6fb", zone: "#2b4f9c" },
};

/** Limites onde um jogador pode ficar (a quadra inteira). */
export function bounds(modality: SportModality) {
  const r = SPORT_RULES[modality];
  return { halfL: r.length / 2, halfW: r.width / 2 };
}

export function clampToCourt(modality: SportModality, x: number, z: number) {
  const { halfL, halfW } = bounds(modality);
  return { x: Math.max(-halfL, Math.min(halfL, x)), z: Math.max(-halfW, Math.min(halfW, z)) };
}

/** Testa se o navegador consegue desenhar WebGL (sem isso, usamos a quadra 2D). */
export function hasWebGL() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

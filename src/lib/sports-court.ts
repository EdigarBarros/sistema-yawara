/**
 * QUADRA DA ÁREA DE ESPORTES: regras puras (sem banco), usadas pela tela,
 * pelo serviço de demonstração e pelo servidor (functions/src/modules/sports.ts).
 * Testadas em sports-court.test.ts.
 *
 * Coordenadas em metros a partir do centro: x = comprimento (negativo = lado
 * do nosso gol/cesta/rede), z = largura.
 */
import type { Athlete, LineupSlot, SportTeam, TeamLineup } from "@/types";

/** Esportes que têm quadra desenhada. */
export type CourtModality = "futsal" | "volei" | "basquete" | "handebol";

export interface FormationDef {
  key: string;
  label: string;
  /** Uma vaga por titular; `position` é a posição sugerida (comparada sem acento). */
  spots: { x: number; z: number; position: string }[];
}

export interface CourtRules {
  label: string;
  starters: number;
  length: number;
  width: number;
  formations: FormationDef[];
}

export const COURT_RULES: Record<CourtModality, CourtRules> = {
  futsal: {
    label: "Futsal",
    starters: 5,
    length: 40,
    width: 20,
    formations: [
      {
        key: "1-2-1",
        label: "1-2-1 (losango)",
        spots: [
          { x: -18, z: 0, position: "goleiro" },
          { x: -12, z: 0, position: "fixo" },
          { x: -7, z: -6, position: "ala" },
          { x: -7, z: 6, position: "ala" },
          { x: -2, z: 0, position: "pivo" },
        ],
      },
      {
        key: "2-2",
        label: "2-2 (quadrado)",
        spots: [
          { x: -18, z: 0, position: "goleiro" },
          { x: -12, z: -4, position: "fixo" },
          { x: -12, z: 4, position: "fixo" },
          { x: -4, z: -5, position: "ala" },
          { x: -4, z: 5, position: "pivo" },
        ],
      },
      {
        key: "3-1",
        label: "3-1",
        spots: [
          { x: -18, z: 0, position: "goleiro" },
          { x: -11, z: -6.5, position: "ala" },
          { x: -12, z: 0, position: "fixo" },
          { x: -11, z: 6.5, position: "ala" },
          { x: -3, z: 0, position: "pivo" },
        ],
      },
    ],
  },
  volei: {
    label: "Vôlei",
    starters: 6,
    length: 18,
    width: 9,
    formations: [
      {
        key: "5-1",
        label: "5-1 (rodízio 1)",
        spots: [
          { x: -7, z: 3, position: "levantador" },
          { x: -2, z: 3, position: "ponteiro" },
          { x: -2, z: 0, position: "central" },
          { x: -2, z: -3, position: "oposto" },
          { x: -7, z: -3, position: "ponteiro" },
          { x: -7, z: 0, position: "libero" },
        ],
      },
      {
        key: "4-2",
        label: "4-2",
        spots: [
          { x: -2, z: 3, position: "levantador" },
          { x: -2, z: 0, position: "central" },
          { x: -2, z: -3, position: "ponteiro" },
          { x: -7, z: -3, position: "levantador" },
          { x: -7, z: 0, position: "central" },
          { x: -7, z: 3, position: "ponteiro" },
        ],
      },
    ],
  },
  basquete: {
    label: "Basquete",
    starters: 5,
    length: 28,
    width: 15,
    formations: [
      {
        key: "2-3",
        label: "Zona 2-3",
        spots: [
          { x: -7.5, z: -2.5, position: "armador" },
          { x: -7.5, z: 2.5, position: "ala-armador" },
          { x: -11, z: -5, position: "ala" },
          { x: -12, z: 0, position: "pivo" },
          { x: -11, z: 5, position: "ala-pivo" },
        ],
      },
      {
        key: "1-3-1",
        label: "Zona 1-3-1",
        spots: [
          { x: -5.5, z: 0, position: "armador" },
          { x: -9, z: -5, position: "ala-armador" },
          { x: -9, z: 0, position: "ala-pivo" },
          { x: -9, z: 5, position: "ala" },
          { x: -12.5, z: 0, position: "pivo" },
        ],
      },
      {
        key: "individual",
        label: "Individual (ataque aberto)",
        spots: [
          { x: 4, z: 0, position: "armador" },
          { x: 7, z: -5.5, position: "ala-armador" },
          { x: 7, z: 5.5, position: "ala" },
          { x: 11, z: -2.5, position: "ala-pivo" },
          { x: 11.5, z: 2.5, position: "pivo" },
        ],
      },
    ],
  },
  handebol: {
    label: "Handebol",
    starters: 7,
    length: 40,
    width: 20,
    formations: [
      {
        key: "6-0",
        label: "Defesa 6-0",
        spots: [
          { x: -19, z: 0, position: "goleiro" },
          { x: -13.5, z: -7.5, position: "ponta" },
          { x: -12.8, z: -4.5, position: "armador" },
          { x: -12.5, z: -1.5, position: "central" },
          { x: -12.5, z: 1.5, position: "pivo" },
          { x: -12.8, z: 4.5, position: "armador" },
          { x: -13.5, z: 7.5, position: "ponta" },
        ],
      },
      {
        key: "5-1",
        label: "Defesa 5-1",
        spots: [
          { x: -19, z: 0, position: "goleiro" },
          { x: -13.5, z: -7, position: "ponta" },
          { x: -12.8, z: -3.5, position: "armador" },
          { x: -12.5, z: 0, position: "pivo" },
          { x: -12.8, z: 3.5, position: "armador" },
          { x: -13.5, z: 7, position: "ponta" },
          { x: -9, z: 0, position: "central" },
        ],
      },
    ],
  },
};


/** Tira acentos e caixa: "Vôlei de Quadra" → "volei de quadra". */
function plain(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Qual quadra desenhar para o esporte da modalidade (texto livre). `null` = sem quadra. */
export function courtModalityOf(sport: string): CourtModality | null {
  const s = plain(sport);
  if (s.includes("futsal") || s.includes("futebol de salao")) return "futsal";
  if (s.includes("volei") || s.includes("voleibol")) return "volei";
  if (s.includes("basquete") || s.includes("basket")) return "basquete";
  if (s.includes("handebol") || s.includes("handball")) return "handebol";
  return null;
}

/** Posição em 3 letras para a etiqueta ("Goleira" → "GOL", sem posição → "—"). */
export function positionShort(position?: string) {
  const p = plain(position ?? "").replace(/[^a-z]/g, "");
  return p ? p.slice(0, 3).toUpperCase() : "—";
}

/** A posição do atleta combina com a sugerida pela formação? ("Goleira" combina com "goleiro"). */
export function samePosition(athletePosition: string | undefined, spot: string) {
  const a = plain(athletePosition ?? "");
  return !!a && a.slice(0, 4) === plain(spot).slice(0, 4);
}

/**
 * Confere e ajusta a escalação: só atletas do elenco, sem repetir, no máximo o
 * número de titulares e dentro da quadra (posições arredondadas a 10 cm).
 */
export function cleanLineup(
  team: Pick<SportTeam, "sport" | "athletes">,
  lineup: Pick<TeamLineup, "formation" | "slots">,
): { lineup: Pick<TeamLineup, "formation" | "slots"> } | { error: string } {
  const modality = courtModalityOf(team.sport);
  if (!modality) return { error: "Este esporte ainda não tem quadra para escalação." };
  const rules = COURT_RULES[modality];
  if (lineup.slots.length > rules.starters) return { error: `No ${rules.label.toLowerCase()} entram no máximo ${rules.starters} titulares.` };
  const seen = new Set<string>();
  const halfL = rules.length / 2;
  const halfW = rules.width / 2;
  const round = (n: number) => Math.round(n * 10) / 10;
  const slots: LineupSlot[] = [];
  for (const slot of lineup.slots) {
    const athlete = team.athletes.find((a) => a.id === slot.athleteId);
    if (!athlete) return { error: "A escalação tem alguém que não está no elenco." };
    if (seen.has(slot.athleteId)) return { error: `${athlete.name} aparece duas vezes na escalação.` };
    if (!Number.isFinite(slot.x) || !Number.isFinite(slot.z)) return { error: "Posição inválida na quadra." };
    seen.add(slot.athleteId);
    slots.push({ athleteId: slot.athleteId, x: round(Math.max(-halfL, Math.min(halfL, slot.x))), z: round(Math.max(-halfW, Math.min(halfW, slot.z))) });
  }
  return { lineup: { formation: (lineup.formation ?? "").trim().slice(0, 40) || "livre", slots } };
}

/** Escalação sem quem saiu do elenco. */
export function lineupWithout(lineup: TeamLineup | undefined, athleteId: string): TeamLineup | undefined {
  return lineup ? { ...lineup, slots: lineup.slots.filter((s) => s.athleteId !== athleteId) } : lineup;
}

/** Ordem do banco: pela camisa e depois pelo nome. */
export function byShirt(a: Athlete, b: Athlete) {
  return Number(a.number ?? 9999) - Number(b.number ?? 9999) || a.name.localeCompare(b.name, "pt-BR");
}

/** Cor do texto sobre a cor do uniforme: escuro em cores claras, branco em cores escuras. */
export function inkOn(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? "#06102e" : "#ffffff";
}

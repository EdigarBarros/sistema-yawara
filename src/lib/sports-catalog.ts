/**
 * CATÁLOGO DAS MODALIDADES
 * ---------------------------------------------------------------------------
 * Os esportes que a Central conhece por nome: quantos jogam ao mesmo tempo, as
 * posições de cada um e a forma de contar o placar. A prancheta (escalação no
 * campo) e a escolha de posição do elenco leem daqui.
 *
 * A modalidade guarda o esporte como texto (`SportTeam.sport`), então dados
 * antigos e esportes fora da lista ("Xadrez", "Bateria") continuam valendo:
 * `findSport` reconhece o nome (com ou sem acento, "vôlei de praia" = areia) e
 * devolve `null` quando o esporte não está no catálogo.
 */

export type SportKey = "futsal" | "society" | "campo" | "volei" | "areia" | "handebol" | "basquete";

/** Como o placar é contado: gols (com quem marcou), sets ou pontos. */
export type ScoreKind = "goals" | "sets" | "points";

export interface SportPosition {
  /** Nome por extenso (o que aparece no elenco). */
  name: string;
  /** Sigla curta para a bolinha na prancheta. */
  short: string;
  /** Goleiro(a) ou líbero: cor diferente na prancheta. */
  special?: boolean;
}

export interface SportDefinition {
  key: SportKey;
  /** Nome gravado na modalidade (ex.: "Futebol society"). */
  label: string;
  /** Quantos começam jogando. */
  starters: number;
  /** Se tem goleiro(a). */
  goalkeeper: boolean;
  /** Vôlei de quadra: líbero além dos titulares. */
  libero?: boolean;
  /** Vôlei de quadra: os titulares giram de posição. */
  rotation?: boolean;
  scoring: ScoreKind;
  positions: SportPosition[];
  /** Outros nomes que as pessoas usam para o mesmo esporte. */
  aliases: string[];
}

export const SPORTS: readonly SportDefinition[] = [
  {
    key: "futsal",
    label: "Futsal",
    starters: 5,
    goalkeeper: true,
    scoring: "goals",
    positions: [
      { name: "Goleiro(a)", short: "GOL", special: true },
      { name: "Fixo", short: "FIX" },
      { name: "Ala", short: "ALA" },
      { name: "Pivô", short: "PIV" },
    ],
    aliases: ["futebol de salao", "salao"],
  },
  {
    key: "society",
    label: "Futebol society",
    starters: 7,
    goalkeeper: true,
    scoring: "goals",
    positions: [
      { name: "Goleiro(a)", short: "GOL", special: true },
      { name: "Zagueiro(a)", short: "ZAG" },
      { name: "Lateral", short: "LAT" },
      { name: "Meio-campo", short: "MEI" },
      { name: "Atacante", short: "ATA" },
    ],
    aliases: ["society", "fut7", "fut 7", "futebol 7", "futebol de 7", "futebol sete"],
  },
  {
    key: "campo",
    label: "Futebol de campo",
    starters: 11,
    goalkeeper: true,
    scoring: "goals",
    positions: [
      { name: "Goleiro(a)", short: "GOL", special: true },
      { name: "Zagueiro(a)", short: "ZAG" },
      { name: "Lateral", short: "LAT" },
      { name: "Volante", short: "VOL" },
      { name: "Meio-campo", short: "MEI" },
      { name: "Ponta", short: "PON" },
      { name: "Atacante", short: "ATA" },
    ],
    aliases: ["futebol", "campo", "futebol 11", "futebol de 11", "fut11"],
  },
  {
    key: "volei",
    label: "Vôlei",
    starters: 6,
    goalkeeper: false,
    libero: true,
    rotation: true,
    scoring: "sets",
    positions: [
      { name: "Levantador(a)", short: "LEV" },
      { name: "Oposto(a)", short: "OPO" },
      { name: "Ponteiro(a)", short: "PON" },
      { name: "Central", short: "CEN" },
      { name: "Líbero", short: "LIB", special: true },
    ],
    aliases: ["volei de quadra", "voleibol", "volleyball"],
  },
  {
    key: "areia",
    label: "Vôlei de areia",
    starters: 2,
    goalkeeper: false,
    scoring: "sets",
    positions: [
      { name: "Bloqueio", short: "BLO" },
      { name: "Defesa", short: "DEF" },
    ],
    aliases: ["volei de praia", "volei praia", "beach volley", "volei na areia"],
  },
  {
    key: "handebol",
    label: "Handebol",
    starters: 7,
    goalkeeper: true,
    scoring: "goals",
    positions: [
      { name: "Goleiro(a)", short: "GOL", special: true },
      { name: "Armador(a) central", short: "ARC" },
      { name: "Armador(a)", short: "ARM" },
      { name: "Ponta", short: "PON" },
      { name: "Pivô", short: "PIV" },
    ],
    aliases: ["handball", "handebal"],
  },
  {
    key: "basquete",
    label: "Basquete",
    starters: 5,
    goalkeeper: false,
    scoring: "points",
    positions: [
      { name: "Armador(a)", short: "ARM" },
      { name: "Ala-armador(a)", short: "AAR" },
      { name: "Ala", short: "ALA" },
      { name: "Ala-pivô", short: "APV" },
      { name: "Pivô", short: "PIV" },
    ],
    aliases: ["basquetebol", "basketball", "basket"],
  },
];

/** Minúsculas, sem acento e sem espaços repetidos (para comparar nomes). */
export function normalizeSportName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BY_NAME = new Map<string, SportDefinition>();
for (const s of SPORTS) for (const name of [s.key, s.label, ...s.aliases]) BY_NAME.set(normalizeSportName(name), s);

/** O esporte do catálogo com esse nome, ou `null` se for outro esporte. */
export function findSport(name: string | undefined | null): SportDefinition | null {
  if (!name) return null;
  return BY_NAME.get(normalizeSportName(name)) ?? null;
}

export function sportByKey(key: SportKey): SportDefinition {
  return SPORTS.find((s) => s.key === key)!;
}

/** "5 em quadra · com goleiro(a)" — o resumo que aparece ao escolher o esporte. */
export function sportSummary(s: SportDefinition) {
  const field = s.key === "campo" || s.key === "society" ? "em campo" : "em quadra";
  const extra = s.goalkeeper ? " · com goleiro(a)" : s.libero ? " + líbero" : s.key === "areia" ? " · dupla" : "";
  return `${s.starters} ${field}${extra}`;
}

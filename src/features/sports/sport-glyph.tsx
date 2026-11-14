import type { SportKey } from "@/lib/sports-catalog";
import { cn } from "@/lib/utils";

/**
 * Miniatura do campo ou da quadra de cada esporte (vista de cima), em traço
 * da cor atual. Serve de ícone no cadastro e nos cartões da modalidade.
 */
export function SportGlyph({ sport, className }: { sport: SportKey | null; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 32 24" className={cn("size-8", className)} aria-hidden {...common}>
      {sport === "volei" || sport === "areia" ? (
        <>
          <rect x="3" y="4" width="26" height="16" rx="1.5" strokeDasharray={sport === "areia" ? "2 1.6" : undefined} />
          <path d="M16 2.5v19" strokeWidth={2.2} />
          {sport === "volei" && <path d="M11 4v16M21 4v16" strokeOpacity={0.55} />}
        </>
      ) : sport === "basquete" ? (
        <>
          <rect x="3" y="4" width="26" height="16" rx="1.5" />
          <path d="M16 4v16" />
          <circle cx="16" cy="12" r="2.6" />
          <path d="M3 9h4.5v6H3M29 9h-4.5v6H29" />
          <path d="M3 6.5a6 6 0 0 1 0 11M29 6.5a6 6 0 0 0 0 11" strokeOpacity={0.55} />
        </>
      ) : sport === "handebol" ? (
        <>
          <rect x="3" y="4" width="26" height="16" rx="1.5" />
          <path d="M16 4v16" />
          <path d="M3 7.5a5 4.5 0 0 1 0 9M29 7.5a5 4.5 0 0 0 0 9" />
        </>
      ) : sport === "campo" || sport === "society" ? (
        <>
          <rect x="3" y="4" width="26" height="16" rx="1.5" />
          <path d="M16 4v16" />
          <circle cx="16" cy="12" r={sport === "campo" ? 3 : 2.4} />
          <path d={sport === "campo" ? "M3 8h4v8H3M29 8h-4v8h4" : "M3 9.5h3v5H3M29 9.5h-3v5h3"} />
        </>
      ) : sport === "futsal" ? (
        <>
          <rect x="3" y="4" width="26" height="16" rx="1.5" />
          <path d="M16 4v16" />
          <circle cx="16" cy="12" r="2.4" />
          <path d="M3 8.5a4 3.5 0 0 1 0 7M29 8.5a4 3.5 0 0 0 0 7" />
        </>
      ) : (
        <>
          <circle cx="16" cy="12" r="7" />
          <path d="M16 5v14M9 12h14" strokeOpacity={0.55} />
        </>
      )}
    </svg>
  );
}

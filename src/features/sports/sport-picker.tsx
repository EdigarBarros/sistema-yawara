"use client";

import { useState } from "react";
import { findSport, SPORTS, sportSummary } from "@/lib/sports-catalog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/form";
import { SportGlyph } from "./sport-glyph";
import { SPORTS_COLOR } from "./utils";

/**
 * Escolha do esporte em botões com a miniatura da quadra. "Outro" abre um campo
 * de texto para esportes fora do catálogo (ex.: Xadrez); nesses a prancheta não
 * aparece, mas treinos, elenco e jogos funcionam igual.
 */
export function SportPicker({ value, onChange, invalid }: { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  const known = findSport(value);
  const [other, setOther] = useState(!known && value.trim().length > 0);
  const selectedKey = other ? "outro" : (known?.key ?? null);

  const option = (key: string, label: string, hint: string, glyph: React.ReactNode, onPick: () => void) => {
    const selected = selectedKey === key;
    return (
      <button
        key={key}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onPick}
        className={cn(
          "press flex min-h-[88px] flex-col items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
          selected ? "border-transparent text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
          invalid && !selectedKey && "border-danger/50",
        )}
        style={selected ? { background: `${SPORTS_COLOR}1f`, boxShadow: `inset 0 0 0 1.5px ${SPORTS_COLOR}` } : undefined}
      >
        <span style={selected ? { color: SPORTS_COLOR } : undefined}>{glyph}</span>
        <span className="min-w-0">
          <span className="block text-[13.5px] leading-tight font-semibold text-fg">{label}</span>
          <span className="block text-[11.5px] leading-snug text-fg-subtle">{hint}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2.5">
      <div role="radiogroup" aria-label="Esporte" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SPORTS.map((s) =>
          option(s.key, s.label, sportSummary(s), <SportGlyph sport={s.key} />, () => {
            setOther(false);
            onChange(s.label);
          }),
        )}
        {option("outro", "Outro", "Xadrez, natação…", <SportGlyph sport={null} />, () => {
          setOther(true);
          if (known) onChange("");
        })}
      </div>
      {other && <Input autoFocus aria-label="Nome do esporte" placeholder="Qual esporte? Ex.: Xadrez" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

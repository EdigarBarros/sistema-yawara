"use client";

import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "primary" | "secondary" | "whatsapp" | "danger";

const TONES: Record<Tone, string> = {
  primary: "bg-gold text-gold-ink shadow-[0_10px_24px_-10px_rgba(225,175,55,0.7)]",
  secondary: "border border-line-strong bg-surface-2 text-fg",
  whatsapp: "bg-[#25d366] text-[#052e16] shadow-[0_10px_24px_-10px_rgba(37,211,102,0.6)]",
  danger: "border border-danger/40 bg-danger/10 text-danger",
};

export function bigButtonClasses(tone: Tone = "primary", className?: string) {
  return cn(
    "press inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 text-[16px] font-bold select-none [&_svg]:size-5 [&_svg]:shrink-0",
    "disabled:pointer-events-none disabled:opacity-45",
    TONES[tone],
    className,
  );
}

interface BigButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  loading?: boolean;
}

/** Botão grande, de largura total, para o celular. */
export function BigButton({ tone = "primary", loading, disabled, className, children, type = "button", ...props }: BigButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={bigButtonClasses(tone, className)} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

interface ChoiceRowProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  onClick: () => void;
  selected?: boolean;
  disabled?: boolean;
  color?: string;
  index?: number;
}

/** Opção grande de toque único (ex.: "Sim, no Pix"). */
export function ChoiceRow({ icon, title, description, onClick, selected, disabled, color = "#e1af37", index = 0 }: ChoiceRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "press anim-rise flex min-h-[68px] w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left disabled:opacity-45",
        selected ? "border-gold bg-gold/10 ring-2 ring-gold/40" : "border-line-strong bg-surface-2/60 hover:border-line-strong",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-[14px] text-[#06102e] [&_svg]:size-[22px]" style={{ background: `linear-gradient(145deg, ${color}, ${color}b8)` }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        {description && <span className="block text-[13px] leading-snug text-fg-muted">{description}</span>}
      </span>
    </button>
  );
}

/** Campo de texto grande, com rótulo visível. */
export const BigInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string }>(function BigInput(
  { label, hint, error, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-[15px] font-semibold">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={!!error || undefined}
        className="h-14 w-full rounded-2xl border border-line-strong bg-sunken px-4 text-[17px] text-fg focus:border-gold/70 focus:shadow-[0_0_0_4px_rgba(225,175,55,0.16)] focus:outline-none aria-[invalid=true]:border-danger/70"
        {...props}
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-[13px] text-fg-muted">{hint}</p>
      )}
    </div>
  );
});

/** Barrinha de progresso dos passos ("Passo 2 de 4"). */
export function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-5 flex items-center gap-1.5" aria-label={`Passo ${step + 1} de ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i <= step ? "bg-gold" : "bg-line-strong")} />
      ))}
    </div>
  );
}

/** Tela de sucesso animada (check que se desenha + anel que se expande). */
export function SuccessBurst({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <span className="relative grid size-24 place-items-center">
        <span aria-hidden className="anim-ring absolute inset-0 rounded-full border-4 border-ok" />
        <span className="anim-success grid size-24 place-items-center rounded-full bg-ok text-[#04120b] shadow-[0_14px_40px_-10px_rgba(63,207,142,0.7)]">
          <svg viewBox="0 0 24 24" className="size-12" fill="none" aria-hidden>
            <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="anim-check" />
          </svg>
        </span>
      </span>
      <h3 className="anim-rise mt-5 font-display text-[28px] leading-tight font-extrabold" style={{ animationDelay: "250ms" }}>
        {title}
      </h3>
      {description && (
        <div className="anim-rise mt-2 text-[15px] text-fg-muted" style={{ animationDelay: "330ms" }}>
          {description}
        </div>
      )}
    </div>
  );
}

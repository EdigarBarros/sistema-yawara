"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-sunken text-[14px] text-fg transition-[border-color,box-shadow] " +
  "focus:border-gold/60 focus:outline-none focus:ring-[3px] focus:ring-gold/15 " +
  "aria-[invalid=true]:border-danger/70 aria-[invalid=true]:focus:ring-danger/15 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Ícone decorativo à esquerda. */
  icon?: ReactNode;
  /** Elemento à direita (ex.: botão mostrar senha). */
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, icon, trailing, ...props }, ref) {
  const input = <input ref={ref} className={cn(fieldBase, "h-10 px-3", icon && "pl-10", trailing && "pr-11", className)} {...props} />;
  if (!icon && !trailing) return input;
  return (
    <div className="relative">
      {icon && <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-subtle [&_svg]:size-4" aria-hidden>{icon}</span>}
      {input}
      {trailing && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(fieldBase, "min-h-20 px-3 py-2.5 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(fieldBase, "h-10 appearance-none pr-9 pl-3", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
    </div>
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-fg", className)} {...props} />;
}

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  /** Um único controle (Input, Select, Textarea…). Recebe id e aria automaticamente. */
  children: ReactNode;
}

/** Campo de formulário com rótulo, ajuda e mensagem de erro acessíveis. */
export function Field({ label, hint, error, required, optional, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })
    : children;

  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <Label htmlFor={(isValidElement(children) && (children.props as { id?: string }).id) || id}>
          {label}
          {required && <span className="ml-0.5 text-gold-fg" aria-hidden>*</span>}
          {optional && <span className="ml-1.5 text-xs font-normal text-fg-subtle">(opcional)</span>}
        </Label>
      )}
      {control}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={cn("size-4 shrink-0 cursor-pointer rounded accent-[var(--gold)]", className)} {...props} />;
}

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, label, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-gold/60 bg-gold" : "border-line-strong bg-surface-3",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full shadow transition-transform",
          checked ? "translate-x-[18px] bg-gold-ink" : "translate-x-[3px] bg-fg-muted",
        )}
      />
    </button>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface ChoiceCardsProps<T extends string> {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: ChoiceOption<T>[];
  columns?: 1 | 2 | 3;
  ariaLabel?: string;
}

/** Opções em cartões (rádio). Mais fáceis de entender do que uma lista suspensa. */
export function ChoiceCards<T extends string>({ name, value, onChange, options, columns = 2, ariaLabel }: ChoiceCardsProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3")}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <label
            key={opt.value}
            className={cn(
              "group relative flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors",
              selected ? "border-gold/60 bg-gold/[0.07]" : "border-line hover:border-line-strong hover:bg-surface-2",
              opt.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              disabled={opt.disabled}
              onChange={() => onChange(opt.value)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                selected ? "border-gold" : "border-line-strong",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-gold",
              )}
            >
              {selected && <span className="size-2 rounded-full bg-gold" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
                {opt.icon}
                {opt.label}
              </span>
              {opt.description && <span className="mt-0.5 block text-xs leading-snug text-fg-muted">{opt.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Grupo de botões segmentados para alternar visualizações. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("inline-flex rounded-lg border border-line bg-sunken p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors [&_svg]:size-4",
            o.value === value ? "bg-surface-3 text-fg shadow-[0_0_0_1px_var(--line-strong)]" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-gold text-gold-ink hover:bg-gold-hover shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]",
  secondary: "border border-line-strong bg-transparent text-fg hover:bg-surface-2",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
  link: "text-gold-fg underline-offset-4 hover:underline px-0 h-auto",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] rounded-md",
  md: "h-[38px] px-4 text-[13.5px] rounded-lg",
  lg: "h-11 px-5 text-sm rounded-lg",
  icon: "size-9 rounded-lg",
  "icon-sm": "size-8 rounded-md",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant],
    variant !== "link" && SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, disabled, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function ButtonLink({ variant = "secondary", size = "md", className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}

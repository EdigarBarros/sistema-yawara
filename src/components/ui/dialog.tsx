"use client";

import * as RD from "@radix-ui/react-dialog";
import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UploadProgress } from "@/components/shared/upload-progress";

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

const SIZES = {
  sm: "sm:max-w-[420px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[720px]",
  xl: "sm:max-w-[920px]",
};

interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
  /** Impede fechar clicando fora (útil em formulários longos). */
  modal?: boolean;
}

/** Modal centralizado no computador e "folha inferior" no celular. */
export function DialogContent({ title, description, children, footer, size = "md", className, modal }: DialogContentProps) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <RD.Content
        onInteractOutside={modal ? (e) => e.preventDefault() : undefined}
        className={cn(
          "fixed z-50 flex max-h-[92dvh] w-full flex-col border border-line-strong bg-surface shadow-pop outline-none",
          "inset-x-0 bottom-0 rounded-t-2xl sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          "data-[state=open]:animate-pop-in",
          SIZES[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <RD.Title className="font-display text-xl font-semibold leading-tight tracking-[-0.005em]">{title}</RD.Title>
            {description ? (
              <RD.Description className="mt-1 text-[13px] text-fg-muted">{description}</RD.Description>
            ) : (
              <RD.Description className="sr-only">{typeof title === "string" ? title : "Janela"}</RD.Description>
            )}
          </div>
          <RD.Close className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Fechar">
            <X className="size-4" />
          </RD.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        <UploadProgress />
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end sm:px-6">{footer}</div>}
      </RD.Content>
    </RD.Portal>
  );
}

interface SheetContentProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
}

/** Painel lateral para detalhes sem sair da listagem. */
export function SheetContent({ title, description, eyebrow, children, footer, width = "md" }: SheetContentProps) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in" />
      <RD.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line-strong bg-surface shadow-pop outline-none data-[state=open]:animate-slide-in",
          width === "md" ? "sm:max-w-[480px]" : "sm:max-w-[640px]",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
            <RD.Title className="font-display text-xl font-semibold leading-tight">{title}</RD.Title>
            {description ? (
              <RD.Description className="mt-1 text-[13px] text-fg-muted">{description}</RD.Description>
            ) : (
              <RD.Description className="sr-only">Detalhes</RD.Description>
            )}
          </div>
          <RD.Close className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Fechar painel">
            <X className="size-4" />
          </RD.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        <UploadProgress />
        {footer && <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </RD.Content>
    </RD.Portal>
  );
}

export const Sheet = RD.Root;

interface BigSheetContentProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Botão de voltar no lugar do "X" (passos de um fluxo). */
  onBack?: () => void;
  /** Impede fechar tocando fora (fluxos com dados digitados). */
  modal?: boolean;
  className?: string;
}

/**
 * Folha grande para o celular: sobe de baixo e ocupa quase a tela toda, com
 * título grande, botões de fechar/voltar fáceis de tocar e rodapé fixo.
 */
export function BigSheetContent({ title, description, children, footer, onBack, modal, className }: BigSheetContentProps) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <RD.Content
        onInteractOutside={modal ? (e) => e.preventDefault() : undefined}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] w-full max-w-[560px] flex-col rounded-t-[28px] border border-line-strong bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop outline-none [animation:sheet-up_.34s_cubic-bezier(.2,1,.3,1)_both]",
          // Computador: janela centralizada, com a mesma aparência.
          "lg:inset-x-auto lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:max-h-[88dvh] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[28px] lg:pb-0",
          className,
        )}
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-line-strong lg:hidden" />
        <div className="flex items-start gap-3 px-5 pt-3 pb-4 lg:px-6 lg:pt-6">
          {onBack && (
            <button type="button" onClick={onBack} className="press -ml-1.5 grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-fg" aria-label="Voltar">
              <ArrowLeft className="size-5" />
            </button>
          )}
          <div className="min-w-0 flex-1 pt-1">
            <RD.Title className="font-display text-[24px] leading-tight font-bold">{title}</RD.Title>
            {description ? (
              <RD.Description className="mt-1 text-[14px] text-fg-muted">{description}</RD.Description>
            ) : (
              <RD.Description className="sr-only">{typeof title === "string" ? title : "Janela"}</RD.Description>
            )}
          </div>
          <RD.Close className="press -mr-1.5 grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted hover:text-fg" aria-label="Fechar">
            <X className="size-5" />
          </RD.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-col gap-2.5 border-t border-line px-5 py-4">{footer}</div>}
      </RD.Content>
    </RD.Portal>
  );
}

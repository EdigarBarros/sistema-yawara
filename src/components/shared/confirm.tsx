"use client";

import { useState } from "react";
import { create } from "zustand";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** Quando presente, exige que a pessoa escreva um motivo. */
  reason?: { label: string; placeholder?: string };
}

interface ConfirmState {
  request: (ConfirmOptions & { resolve: (value: string | boolean) => void }) | null;
  open: (opts: ConfirmOptions) => Promise<string | boolean>;
  close: (value: string | boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  open: (opts) => new Promise((resolve) => set({ request: { ...opts, resolve } })),
  close: (value) => {
    get().request?.resolve(value);
    set({ request: null });
  },
}));

/** Pede confirmação antes de uma ação importante. */
export async function confirmAction(opts: Omit<ConfirmOptions, "reason">) {
  return (await useConfirmStore.getState().open(opts)) === true;
}

/** Pede confirmação com motivo obrigatório. Retorna o motivo ou null se cancelado. */
export async function askReason(opts: ConfirmOptions & { reason: NonNullable<ConfirmOptions["reason"]> }) {
  const value = await useConfirmStore.getState().open(opts);
  return typeof value === "string" ? value : null;
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  const finish = (value: string | boolean) => {
    setReason("");
    setError(undefined);
    close(value);
  };

  const submit = () => {
    if (request?.reason) {
      if (reason.trim().length < 3) {
        setError("Escreva um motivo com pelo menos 3 caracteres.");
        return;
      }
      finish(reason.trim());
    } else {
      finish(true);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && finish(false)}>
      {request && (
        <DialogContent
          size="sm"
          title={
            <span className="flex items-center gap-2.5">
              {request.tone === "danger" && <AlertTriangle className="size-5 text-danger" aria-hidden />}
              {request.title}
            </span>
          }
          description={request.description}
          footer={
            <>
              <Button variant="ghost" onClick={() => finish(false)}>
                {request.cancelLabel ?? "Voltar"}
              </Button>
              <Button variant={request.tone === "danger" ? "danger" : "primary"} onClick={submit} autoFocus={!request.reason}>
                {request.confirmLabel ?? "Confirmar"}
              </Button>
            </>
          }
        >
          {request.reason ? (
            <Field label={request.reason.label} error={error} required>
              <Textarea
                autoFocus
                rows={3}
                value={reason}
                placeholder={request.reason.placeholder}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError(undefined);
                }}
              />
            </Field>
          ) : (
            <p className="text-[13px] text-fg-muted">Esta ação fica registrada no histórico da demonstração.</p>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Download, Eye, Loader2 } from "lucide-react";
import type { FileRef } from "@/types";
import { services } from "@/services";
import { notifyError } from "@/lib/notify";

/**
 * Botões "visualizar" e "baixar" de um arquivo anexado.
 * Firebase: o download é autenticado e só funciona para quem pode ver o
 * registro (regras do Storage). Demonstração: usa o arquivo escolhido nesta aba.
 * Não renderiza nada quando o arquivo não está disponível neste ambiente.
 */
export function FileActions({ file, label = "arquivo", view = true }: { file: FileRef | null | undefined; label?: string; view?: boolean }) {
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  if (!file || !services.files.isAvailable(file)) return null;
  const run = (mode: "view" | "download") => {
    setBusy(mode);
    services.files
      .open(file, { download: mode === "download" })
      .catch((e) => notifyError(e))
      .finally(() => setBusy(null));
  };
  const cls = "grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50";
  return (
    <>
      {view && (
        <button type="button" className={cls} onClick={() => run("view")} disabled={!!busy} aria-label={`Visualizar ${label}`}>
          {busy === "view" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
        </button>
      )}
      <button type="button" className={cls} onClick={() => run("download")} disabled={!!busy} aria-label={`Baixar ${label}`}>
        {busy === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      </button>
    </>
  );
}

/** URL local para pré-visualização (revogada automaticamente ao desmontar no modo Firebase). */
export function useFileObjectUrl(file: FileRef | null | undefined) {
  const [state, setState] = useState<{ key: string; url: string | null; error: string | null }>({ key: "", url: null, error: null });
  const key = file ? `${file.path ?? ""}|${file.blobId ?? ""}` : "";
  const available = !!file && services.files.isAvailable(file);
  useEffect(() => {
    if (!file || !available) return;
    let cancelled = false;
    let created: string | null = null;
    services.files
      .loadObjectUrl(file)
      .then((url) => {
        created = file.path ? url : null;
        if (!cancelled) setState({ key, url, error: null });
        else if (created) URL.revokeObjectURL(created);
      })
      .catch((e: Error) => !cancelled && setState({ key, url: null, error: e.message }));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave identifica o arquivo
  }, [key, available]);
  const current = state.key === key ? state : { url: null, error: null };
  return { url: current.url, error: current.error, loading: available && !current.url && !current.error };
}

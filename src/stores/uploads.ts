"use client";

import { create } from "zustand";

export interface UploadItem {
  id: string;
  name: string;
  /** 0 a 1: parte confirmada pelo armazenamento, não estimativa. */
  progress: number;
  /** "verifying": todas as partes chegaram; o servidor confere o arquivo ao salvar o registro. */
  state: "uploading" | "verifying" | "done" | "error" | "cancelled";
  cancel?: () => void;
}

interface UploadsState {
  items: UploadItem[];
  upsert(item: UploadItem): void;
  remove(id: string): void;
}

/**
 * Fim da conferência: quando a operação que anexa os envios termina, os que
 * estavam em "verifying" viram "done" (ou "error" se ela falhou) e somem.
 */
export function settleUploads(ids: string[], ok: boolean) {
  const { items, upsert, remove } = useUploads.getState();
  for (const item of items) {
    if (item.state !== "verifying" || !ids.includes(item.id)) continue;
    upsert({ ...item, state: ok ? "done" : "error" });
    setTimeout(() => remove(item.id), ok ? 2500 : 4000);
  }
}

/** Envios de arquivo em andamento (exibidos no indicador de envios). */
export const useUploads = create<UploadsState>()((set) => ({
  items: [],
  upsert: (item) => set((s) => ({ items: [...s.items.filter((i) => i.id !== item.id), item] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

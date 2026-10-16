"use client";

import { create } from "zustand";

export interface UploadItem {
  id: string;
  name: string;
  /** 0 a 1. */
  progress: number;
  state: "uploading" | "done" | "error" | "cancelled";
  cancel?: () => void;
}

interface UploadsState {
  items: UploadItem[];
  upsert(item: UploadItem): void;
  remove(id: string): void;
}

/** Envios de arquivo em andamento (exibidos no indicador de envios). */
export const useUploads = create<UploadsState>()((set) => ({
  items: [],
  upsert: (item) => set((s) => ({ items: [...s.items.filter((i) => i.id !== item.id), item] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

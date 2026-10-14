"use client";

import { useEffect } from "react";
import { create } from "zustand";

/** Permite que páginas de detalhe informem o nome do registro para o breadcrumb. */
const useCrumbStore = create<{ titles: Record<string, string>; set: (path: string, title: string) => void }>((set) => ({
  titles: {},
  set: (path, title) => set((s) => ({ titles: { ...s.titles, [path]: title } })),
}));

export function useCrumbTitles() {
  return useCrumbStore((s) => s.titles);
}

export function useBreadcrumbTitle(path: string, title?: string) {
  const setTitle = useCrumbStore((s) => s.set);
  useEffect(() => {
    if (title) setTitle(path, title);
  }, [path, title, setTitle]);
}

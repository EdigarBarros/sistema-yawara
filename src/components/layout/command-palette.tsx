"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as RD from "@radix-ui/react-dialog";
import { CalendarDays, ClipboardList, CornerDownLeft, FolderOpen, GraduationCap, Loader2, Megaphone, Search, Ticket, Wallet } from "lucide-react";
import type { SearchResult, SearchResultKind } from "@/types";
import { useSearch } from "@/hooks/use-data";
import { useUI } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/misc";

const GROUPS: Record<SearchResultKind, { label: string; icon: React.ReactNode }> = {
  campaign: { label: "Campanhas", icon: <Ticket /> },
  event: { label: "Eventos", icon: <CalendarDays /> },
  document: { label: "Documentos", icon: <FolderOpen /> },
  meeting: { label: "Reuniões", icon: <ClipboardList /> },
  finance: { label: "Lançamentos financeiros", icon: <Wallet /> },
  project: { label: "Ensino e Extensão", icon: <GraduationCap /> },
  content: { label: "Marketing", icon: <Megaphone /> },
};
const ORDER: SearchResultKind[] = ["campaign", "event", "document", "meeting", "finance", "project", "content"];

/** Busca global (Ctrl K) nos dados que o perfil demonstrativo pode ver. */
export function CommandPalette() {
  const router = useRouter();
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { data, isFetching } = useSearch(query);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUI.getState().searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const results = useMemo(() => (query.trim().length >= 2 ? (data ?? []) : []), [data, query]);
  const grouped = useMemo(() => {
    const flat: SearchResult[] = [];
    const groups = ORDER.map((kind) => {
      const items = results.filter((r) => r.kind === kind);
      flat.push(...items);
      return { kind, items };
    }).filter((g) => g.items.length > 0);
    return { groups, flat };
  }, [results]);

  const go = (r: SearchResult) => {
    setOpen(false);
    setQuery("");
    router.push(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, grouped.flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && grouped.flat[active]) {
      e.preventDefault();
      go(grouped.flat[active]);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <RD.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RD.Content className="fixed top-[8vh] left-1/2 z-50 w-[min(94vw,640px)] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop outline-none data-[state=open]:animate-pop-in">
          <RD.Title className="sr-only">Busca global</RD.Title>
          <RD.Description className="sr-only">Procure rifas, eventos, documentos, reuniões, lançamentos, projetos e conteúdos.</RD.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            {isFetching ? <Loader2 className="size-[18px] animate-spin text-gold" /> : <Search className="size-[18px] text-fg-subtle" />}
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Buscar rifas, eventos, documentos, reuniões…"
              aria-label="Buscar na Central"
              className="h-14 flex-1 bg-transparent text-[15px] focus:outline-none"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2" role="listbox">
            {query.trim().length < 2 && (
              <p className="px-3 py-6 text-center text-[13px] text-fg-muted">
                Digite pelo menos 2 letras. A busca considera apenas o que o seu perfil pode ver.
              </p>
            )}
            {query.trim().length >= 2 && !isFetching && grouped.flat.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-fg-muted">Nenhum resultado para “{query}”.</p>
            )}
            {grouped.groups.map((g) => (
              <div key={g.kind} className="mb-1">
                <div className="eyebrow px-3 pt-3 pb-1.5">{GROUPS[g.kind].label}</div>
                {g.items.map((r) => {
                  const index = grouped.flat.indexOf(r);
                  const isActive = index === active;
                  return (
                    <button
                      key={`${r.kind}-${r.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-index={index}
                      onMouseMove={() => setActive(index)}
                      onClick={() => go(r)}
                      className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left", isActive ? "bg-surface-2" : "")}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-fg-muted [&_svg]:size-4">
                        {GROUPS[r.kind].icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{r.title}</span>
                        <span className="block truncate text-[12px] text-fg-subtle">{r.subtitle}</span>
                      </span>
                      {isActive && <CornerDownLeft className="size-4 text-fg-subtle" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11.5px] text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navegar
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Enter</Kbd> abrir
            </span>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

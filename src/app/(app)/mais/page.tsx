"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useUI } from "@/stores/ui";
import { MODULE_MAP } from "@/lib/modules";
import { AREA_COLORS, NAV } from "@/components/layout/nav";
import { BrandEmblem } from "@/components/layout/brand";
import { DemoFootnote } from "@/components/layout/sidebar";
import { HeroCards } from "@/features/home/hero-cards";
import { MemberAvatar } from "@/components/shared/member-avatar";


/** Todas as áreas que o cargo pode acessar, em botões grandes para o celular. */
export default function MaisPage() {
  const access = useAccess();
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  let k = 0;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <header className="anim-rise flex items-center gap-3.5">
        <BrandEmblem size={60} className="drop-shadow-[0_6px_14px_var(--emblem-shadow)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-fg-muted">Você está em</span>
          <h1 className="font-display text-[26px] leading-none font-extrabold">Todas as áreas</h1>
        </span>
      </header>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="press anim-rise flex h-12 items-center gap-2.5 rounded-full border border-line-strong bg-surface px-4 text-left text-[15px] text-fg-subtle"
        style={{ animationDelay: "40ms" }}
      >
        <Search className="size-[18px]" aria-hidden />
        Buscar pessoa, evento, documento…
      </button>

      {access.user && (
        <Link href="/perfil" className="press anim-rise flex items-center gap-3 rounded-3xl border border-line bg-surface p-3.5 hover:border-line-strong" style={{ animationDelay: "60ms" }}>
          <MemberAvatar id={access.user.id} name={access.user.name} size={48} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{access.user.name}</span>
            <span className="block truncate text-[12.5px] text-fg-muted">{access.role?.name} · Meu perfil e foto</span>
          </span>
          <ChevronRight className="size-[18px] shrink-0 text-fg-subtle" aria-hidden />
        </Link>
      )}

      <HeroCards />

      {NAV.filter((g) => g.label).map((group, gi) => {
        const items = group.items.filter((i) => i.module && access.canModule(i.module));
        if (items.length === 0) return null;
        return (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="anim-rise ml-1 text-[12px] font-bold tracking-[0.1em] text-fg-subtle uppercase" style={{ animationDelay: `${200 + gi * 120}ms` }}>
              {group.label}
            </h2>
            <ul className="flex flex-col rounded-[22px] border border-line bg-surface/85 p-1.5">
              {items.map((item) => {
                const color = AREA_COLORS[item.href] ?? "#c5cde6";
                const Icon = item.icon;
                k++;
                return (
                  <li key={item.href} className="anim-row" style={{ animationDelay: `${200 + k * 45}ms` }}>
                    <Link href={item.href} className="group flex min-h-[60px] items-center gap-3 rounded-2xl px-2.5 py-2 transition-[background-color,transform] duration-200 hover:bg-surface-2 active:scale-[0.98] active:bg-surface-3">
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-[13px] text-[#06102e] transition-transform duration-300 group-active:-rotate-12 group-active:scale-110"
                        style={{ background: `linear-gradient(145deg, ${color}, ${color}b3)`, boxShadow: `0 6px 16px ${color}40` }}
                      >
                        <Icon className="size-5" strokeWidth={2.2} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold">{item.label}</span>
                        <span className="block truncate text-[12px] text-fg-muted">{item.module ? MODULE_MAP[item.module].description : ""}</span>
                      </span>
                      <ChevronRight className="size-[18px] shrink-0 text-fg-subtle transition-transform group-active:translate-x-1" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="px-1 pb-2">
        <DemoFootnote />
      </div>
    </div>
  );
}

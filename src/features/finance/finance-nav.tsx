"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/financeiro", label: "Visão geral" },
  { href: "/financeiro/lancamentos", label: "Lançamentos" },
  { href: "/financeiro/relatorios", label: "Relatórios" },
];

/** Navegação interna do Financeiro. */
export function FinanceNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções do Financeiro" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13.5px] font-medium transition-colors",
                  active ? "border-gold text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

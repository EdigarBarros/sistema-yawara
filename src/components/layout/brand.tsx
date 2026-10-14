import Image from "next/image";
import { cn } from "@/lib/utils";

/** Escudo oficial da Atlética (arquivo enviado pela diretoria). */
export function BrandEmblem({ size = 32, className, priority }: { size?: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/escudo.png"
      alt="Escudo da Associação Atlética Acadêmica de Psicologia Yawara"
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0 rounded-full", className)}
    />
  );
}

export function BrandLockup({ collapsed, subtitle = "Atlética de Psicologia" }: { collapsed?: boolean; subtitle?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <BrandEmblem size={32} priority />
      {!collapsed && (
        <span className="min-w-0 leading-none">
          <span className="block truncate font-display text-[15px] font-bold tracking-[0.01em]">Central Yawara</span>
          <span className="mt-1 block truncate text-[11px] text-fg-subtle">{subtitle}</span>
        </span>
      )}
    </span>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, FlaskConical } from "lucide-react";
import { services } from "@/services";
import { useSession } from "@/stores/session";
import { notifyInfo } from "@/lib/notify";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { useAccess } from "@/hooks/use-access";

/**
 * Ferramenta de DEMONSTRAÇÃO para experimentar a interface como outros
 * perfis. Não é um controle de acesso real.
 */
export function ProfileSwitcher() {
  const router = useRouter();
  const { userId, signIn } = useSession();
  const access = useAccess();
  const { data: profiles } = useQuery({ queryKey: ["demo-profiles"], queryFn: () => services.auth.listDemoProfiles(), staleTime: Infinity });
  const current = profiles?.find((p) => p.member.id === userId);
  const label = current?.member.demoProfile?.label ?? access.role?.name ?? "Perfil";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-dashed border-gold/50 px-2.5 text-[12.5px] font-semibold text-gold-fg hover:bg-gold/[0.06] data-[state=open]:bg-gold/[0.08]"
        aria-label={`Perfil de demonstração: ${label}. Trocar perfil`}
      >
        <FlaskConical className="size-4" aria-hidden />
        <span className="hidden max-w-[160px] truncate md:inline">Demo · {label}</span>
        <ChevronDown className="hidden size-3.5 md:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[320px]">
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="text-[13px] font-semibold">Trocar perfil de demonstração</p>
          <p className="mt-1 text-[12px] leading-snug text-fg-muted">
            Ferramenta só para testar a interface com perfis fictícios. Não é login nem controle de acesso real.
          </p>
        </div>
        <DropdownMenuSeparator />
        {profiles?.map((p) => {
          const selected = p.member.id === userId;
          return (
            <DropdownMenuItem
              key={p.member.id}
              icon={selected ? <Check className="text-gold" /> : <span className="block size-4" />}
              hint={`${p.member.name} · ${p.role.name}`}
              onSelect={() => {
                if (selected) return;
                signIn(p.member.id, "demo-profile");
                router.push("/inicio");
                notifyInfo(`Visualizando como ${p.member.demoProfile?.label}`, "Perfil fictício — menus e dados mudam conforme as permissões simuladas.");
              }}
            >
              <span className="font-medium">{p.member.demoProfile?.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

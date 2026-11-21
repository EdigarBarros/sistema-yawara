"use client";

import { useRouter } from "next/navigation";
import { Eye, LogOut } from "lucide-react";
import type { Member } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { isDemoMode } from "@/lib/mode";
import { isSupportRole } from "@/lib/support";
import { useSession } from "@/stores/session";
import { Button } from "@/components/ui/button";

/**
 * "Ver como" (só a conta de Suporte do sistema): a interface passa a usar a
 * identidade da pessoa — mesmas telas, permissões e dados —, sem entrar na
 * conta dela. O servidor confere o suporte a cada operação e registra tudo na
 * auditoria (functions/src/core/actor.ts).
 */
export function ViewAsButton({ member }: { member: Member }) {
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const viewAs = useSession((s) => s.viewAs);
  const start = useAction(() => services.organization.startViewAs(member.id), {
    success: `Você está vendo a Central como ${member.name}`,
  });

  const allowed =
    !viewAs && isSupportRole(access.role?.id) && member.id !== access.user?.id && member.status === "active" && !isSupportRole(member.roleId);
  if (!allowed) return null;

  return (
    <Button
      variant="primary"
      loading={start.pending}
      onClick={async () => {
        const target = await start.runSafe();
        if (!target || !access.user) return;
        const next = {
          uid: target.uid,
          name: target.name,
          roleName: dir.role(target.roleId)?.name,
          realUid: access.user.id,
          returnTo: `${window.location.pathname}${window.location.search}`,
        };
        // Demonstração: troca a identidade aqui. Firebase: a ponte de sessão troca quando o retrato da pessoa chega.
        useSession.setState(isDemoMode ? { viewAs: next, userId: target.uid } : { viewAs: next });
        router.push("/inicio");
      }}
    >
      <Eye /> Ver como {member.name.split(" ")[0]}
    </Button>
  );
}

/** Faixa fixa no topo enquanto o suporte está na visão de outra pessoa. */
export function ViewAsBanner() {
  const router = useRouter();
  const viewAs = useSession((s) => s.viewAs);
  const stop = useAction(async () => {
    if (!viewAs) return;
    // Registro de saída: melhor esforço (a visão termina mesmo se falhar).
    await services.organization.stopViewAs(viewAs.uid).catch(() => undefined);
  });
  if (!viewAs) return null;

  const leave = async () => {
    const returnTo = viewAs.returnTo || "/inicio";
    useSession.setState(isDemoMode ? { viewAs: null, userId: viewAs.realUid } : { viewAs: null });
    await stop.runSafe();
    router.push(returnTo);
  };

  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-[linear-gradient(90deg,#b28413,#e1af37,#b28413)] px-4 py-2 text-center text-[13px] text-[#1a1200] shadow-md">
      <span className="inline-flex items-center gap-2">
        <Eye className="size-4 shrink-0" aria-hidden />
        <span>
          Você está vendo como <b>{viewAs.name}</b>
          {viewAs.roleName ? ` (${viewAs.roleName})` : ""} · tudo o que fizer fica no nome dele(a)
        </span>
      </span>
      <button
        type="button"
        onClick={leave}
        disabled={stop.pending}
        className="press inline-flex items-center gap-1.5 rounded-full bg-[#1a1200] px-3 py-1 text-[12.5px] font-bold text-[#f3d27c] hover:bg-black disabled:opacity-60"
      >
        <LogOut className="size-3.5" aria-hidden /> Sair da visão
      </button>
    </div>
  );
}

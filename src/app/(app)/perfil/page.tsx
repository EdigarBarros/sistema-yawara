"use client";

import { LogOut, Moon, Sun, Trash2 } from "lucide-react";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useSignOut } from "@/hooks/use-sign-out";
import { resolveTheme, useUI } from "@/stores/ui";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/shared/page";
import { AccessCards, PhotoButton, ProfileHero } from "@/features/organization/member-profile";

/** Perfil da própria pessoa: foto, dados do cargo, o que pode fazer e preferências. */
export default function ProfilePage() {
  const access = useAccess();
  const { theme, setTheme } = useUI();
  const leave = useSignOut();
  const removePhoto = useAction(() => services.organization.updateMyPhoto(null), { success: "Foto de perfil removida" });
  const user = access.user;
  if (!user) return null;
  const isDark = resolveTheme(theme) === "dark";

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6">
      <ProfileHero member={user} role={access.role} photoSlot={<PhotoButton hasPhoto={!!user.photo} />} />

      <section className="anim-rise flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 sm:flex-row sm:items-center" style={{ animationDelay: "120ms" }}>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Sua foto de perfil</p>
          <p className="text-[13px] text-fg-muted">
            Toque na câmera para escolher. A foto é recortada em quadrado e reduzida no seu aparelho antes de ser salva{isDemoMode ? " (só neste navegador, na demonstração)" : ""}.
          </p>
        </div>
        {user.photo && (
          <Button variant="secondary" loading={removePhoto.pending} onClick={() => removePhoto.runSafe()}>
            <Trash2 /> Remover foto
          </Button>
        )}
      </section>

      <section className="anim-rise" style={{ animationDelay: "180ms" }}>
        <SectionTitle>O que você pode fazer</SectionTitle>
        <AccessCards permissions={access.role?.permissions ?? []} />
      </section>

      <section className="anim-rise grid gap-2.5 sm:grid-cols-2" style={{ animationDelay: "240ms" }}>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="press flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left hover:border-line-strong"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-gold/15 text-gold-fg">{isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}</span>
          <span>
            <span className="block text-[14px] font-semibold">{isDark ? "Usar modo claro" : "Usar modo escuro"}</span>
            <span className="block text-[12.5px] text-fg-muted">Vale só para este aparelho</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void leave(user.name)}
          className="press flex items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-left hover:bg-danger/10"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-danger/15 text-danger">
            <LogOut className="size-5" />
          </span>
          <span>
            <span className="block text-[14px] font-semibold">{isDemoMode ? "Sair da demonstração" : "Sair da conta"}</span>
            <span className="block text-[12.5px] text-fg-muted">Você volta para a tela de login</span>
          </span>
        </button>
      </section>
    </div>
  );
}

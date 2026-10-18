"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { SCENE_MS, useScene } from "@/stores/scene";
import { BrandEmblem } from "./brand";

/** Cena de tela cheia ao entrar e ao sair da conta; fica acima das trocas de rota. */
export function SceneOverlay() {
  const scene = useScene((s) => s.scene);
  const clear = useScene((s) => s.clear);
  const [leaving, setLeaving] = useState<number | null>(null);

  useEffect(() => {
    if (!scene) return;
    const total = SCENE_MS[scene.kind];
    const t1 = setTimeout(() => setLeaving(scene.id), total - 380);
    const t2 = setTimeout(() => {
      setLeaving(null);
      clear();
    }, total);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [scene, clear]);

  if (!scene) return null;
  const isLogin = scene.kind === "login";
  const out = leaving === scene.id;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-bg"
      style={{ animation: out ? "scene-out .38s ease-in both" : "fade-in .25s ease-out both" }}
    >
      <div aria-hidden className="absolute inset-0">
        <div
          className="absolute top-1/2 left-1/2 size-[90vmax] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: isLogin
              ? "radial-gradient(closest-side, var(--halo-a), var(--halo-b) 45%, transparent)"
              : "radial-gradient(closest-side, var(--aurora-a), transparent)",
            animation: "breathe 2.4s ease-in-out infinite",
          }}
        />
      </div>
      <div className="relative flex flex-col items-center px-6 text-center">
        <div style={{ animation: `${isLogin ? "scene-zoom" : "pop"} .7s cubic-bezier(.2,1.3,.4,1) both` }}>
          <BrandEmblem size={112} className="drop-shadow-[0_18px_40px_var(--emblem-shadow)]" priority />
        </div>
        <p className="anim-rise mt-6 flex items-center gap-2 text-[12px] font-semibold tracking-[0.18em] text-gold-fg uppercase" style={{ animationDelay: "150ms" }}>
          {isLogin ? <LogIn className="size-4" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
          {isLogin ? "Entrando" : "Saindo"}
        </p>
        <h2 className="anim-rise mt-2 font-display text-[30px] leading-tight font-bold sm:text-[36px]" style={{ animationDelay: "230ms" }}>
          {scene.title}
        </h2>
        <p className="anim-rise mt-1 text-[14px] text-fg-muted" style={{ animationDelay: "300ms" }}>
          {scene.subtitle}
        </p>
        <span className="mt-6 h-1 w-44 overflow-hidden rounded-full bg-surface-3">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-[#f0c75a] to-gold"
            style={{ transformOrigin: isLogin ? "left" : "right", animation: `grow-x ${SCENE_MS[scene.kind] - 400}ms cubic-bezier(.4,0,.2,1) both` }}
          />
        </span>
      </div>
    </div>
  );
}

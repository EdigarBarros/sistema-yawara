"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Box, Eye, Map as MapIcon, RotateCcw, Save, Sparkles, UserMinus, UserPlus, Video } from "lucide-react";
import type { LineupSlot, SportTeam, TeamAthlete } from "@/types";
import { services } from "@/services";
import { useAction } from "@/hooks/use-action";
import { useIsDesktop } from "@/hooks/use-media";
import { inkOn, positionLabel, positionShort, SPORT_RULES } from "@/lib/sports";
import { formatDateTimeShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmented, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/misc";
import { Court2D } from "./court-2d";
import { hasWebGL, type CameraPreset, type CourtPlayer } from "./court-geometry";

const Court3D = dynamic(() => import("./court-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const noop = () => () => {};
let webglCache: boolean | null = null;
function cachedWebGL() {
  webglCache ??= hasWebGL();
  return webglCache;
}

/** 3D só com WebGL, tela de computador e sem "reduzir movimento". */
function useCan3D() {
  const desktop = useIsDesktop();
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const webgl = useSyncExternalStore(noop, cachedWebGL, () => true);
  return desktop && !reduced && webgl;
}

/** Primeira vaga livre da formação (ou o meio do nosso lado). */
function freeSpot(team: SportTeam, formation: string, slots: LineupSlot[], position: string) {
  const f = SPORT_RULES[team.modality].formations.find((x) => x.key === formation);
  const taken = (x: number, z: number) => slots.some((s) => Math.abs(s.x - x) < 0.5 && Math.abs(s.z - z) < 0.5);
  const spots = f?.spots.filter((s) => !taken(s.x, s.z)) ?? [];
  const spot = spots.find((s) => s.position === position) ?? spots[0];
  if (spot) return { x: spot.x, z: spot.z };
  return { x: -SPORT_RULES[team.modality].length / 4, z: ((slots.length % 5) - 2) * 1.5 };
}

/** Distribui atletas pelas vagas da formação, priorizando quem joga na posição. */
function applyFormation(team: SportTeam, formation: string, starters: TeamAthlete[], bench: TeamAthlete[]): LineupSlot[] {
  const f = SPORT_RULES[team.modality].formations.find((x) => x.key === formation);
  if (!f) return [];
  const pool = [...starters, ...bench];
  const used = new Set<string>();
  const pick = (position: string) => {
    const a = pool.find((p) => !used.has(p.id) && p.position === position) ?? pool.find((p) => !used.has(p.id));
    if (a) used.add(a.id);
    return a;
  };
  return f.spots.flatMap((spot) => {
    const a = pick(spot.position);
    return a ? [{ athleteId: a.id, x: spot.x, z: spot.z }] : [];
  });
}

export function LineupBoard({ team, editable }: { team: SportTeam; editable: boolean }) {
  const rules = SPORT_RULES[team.modality];
  const can3D = useCan3D();
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [preset, setPreset] = useState<CameraPreset>("side");
  const [slots, setSlots] = useState<LineupSlot[]>(team.lineup.slots);
  const [formation, setFormation] = useState(team.lineup.formation || rules.formations[0].key);
  const [selected, setSelected] = useState<string | null>(null);

  // Volta ao que está salvo quando o time muda (ex.: depois de salvar ou editar o elenco).
  const savedKey = JSON.stringify(team.lineup);
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setSlots(team.lineup.slots);
    setFormation(team.lineup.formation || rules.formations[0].key);
  }

  const athletes = useMemo(() => new Map(team.athletes.map((a) => [a.id, a])), [team.athletes]);
  const onCourt = new Set(slots.map((s) => s.athleteId));
  const bench = team.athletes.filter((a) => a.active && !onCourt.has(a.id)).sort((a, b) => a.number - b.number);
  const dirty = JSON.stringify({ slots, formation }) !== JSON.stringify({ slots: team.lineup.slots, formation: team.lineup.formation || rules.formations[0].key });
  const full = slots.length >= rules.starters;
  const selectedOnCourt = selected && onCourt.has(selected) ? selected : null;

  const players: CourtPlayer[] = slots.flatMap((s) => {
    const a = athletes.get(s.athleteId);
    return a ? [{ id: a.id, x: s.x, z: s.z, number: a.number, name: a.name, short: positionShort(team.modality, a.position) }] : [];
  });

  const save = useAction(() => services.sports.saveLineup(team.id, { formation, slots }), { success: "Escalação salva" });

  const move = (id: string, x: number, z: number) => setSlots((list) => list.map((s) => (s.athleteId === id ? { ...s, x, z } : s)));

  const benchClick = (a: TeamAthlete) => {
    if (!editable) return;
    // Com alguém selecionado na quadra: troca (o reserva entra no lugar dele).
    if (selectedOnCourt) {
      setSlots((list) => list.map((s) => (s.athleteId === selectedOnCourt ? { ...s, athleteId: a.id } : s)));
      setSelected(a.id);
      return;
    }
    if (full) return;
    const spot = freeSpot(team, formation, slots, a.position);
    setSlots((list) => [...list, { athleteId: a.id, ...spot }]);
    setSelected(a.id);
  };

  const removeSelected = () => {
    if (!selectedOnCourt) return;
    setSlots((list) => list.filter((s) => s.athleteId !== selectedOnCourt));
    setSelected(null);
  };

  const chooseFormation = (key: string) => {
    setFormation(key);
    const starters = slots.map((s) => athletes.get(s.athleteId)).filter((a): a is TeamAthlete => !!a);
    setSlots(applyFormation(team, key, starters, bench));
  };

  const selectedAthlete = selected ? athletes.get(selected) : undefined;
  const show3D = can3D && view === "3d";

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            {can3D && (
              <Segmented
                ariaLabel="Visualização da quadra"
                value={view}
                onChange={setView}
                options={[
                  { value: "3d", label: "3D", icon: <Box /> },
                  { value: "2d", label: "De cima", icon: <MapIcon /> },
                ]}
              />
            )}
            {show3D && (
              <Segmented
                ariaLabel="Câmera"
                value={preset}
                onChange={setPreset}
                options={[
                  { value: "side", label: "Arquibancada", icon: <Eye /> },
                  { value: "top", label: "Prancheta", icon: <MapIcon /> },
                  { value: "bench", label: "Do banco", icon: <Video /> },
                ]}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-fg-muted">
            Formação
            <Select value={formation} onChange={(e) => chooseFormation(e.target.value)} disabled={!editable} className="h-8 w-auto py-0 text-[13px]">
              {rules.formations.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
              {!rules.formations.some((f) => f.key === formation) && <option value={formation}>{formation === "livre" ? "Livre" : formation}</option>}
            </Select>
          </label>
        </div>

        <div className={cn("relative bg-[radial-gradient(ellipse_at_top,#11307a,#030f45_70%)]", show3D ? "h-[460px] xl:h-[540px]" : "p-3 sm:p-5")}>
          {show3D ? (
            <Court3D modality={team.modality} color={team.color} players={players} selectedId={selected} editable={editable} preset={preset} onSelect={setSelected} onMove={move} />
          ) : (
            <div className="mx-auto max-w-[760px]">
              <Court2D modality={team.modality} color={team.color} players={players} selectedId={selected} editable={editable} onSelect={setSelected} onMove={move} />
            </div>
          )}
          {show3D && (
            <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/40 px-3 py-1 text-[11.5px] text-white/80 backdrop-blur">
              {editable ? "Arraste um jogador para mover · arraste o fundo para girar · role para aproximar" : "Arraste para girar · role para aproximar"}
            </p>
          )}
          <span className="tnum absolute top-3 right-3 rounded-full bg-black/40 px-3 py-1 font-mono text-[12px] text-white backdrop-blur">
            {slots.length}/{rules.starters} titulares
          </span>
        </div>

        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5 sm:px-4">
            <p className="min-w-0 text-[12.5px] text-fg-muted">
              {team.lineup.updatedAt ? `Salva em ${formatDateTimeShort(team.lineup.updatedAt)}` : "Ainda sem escalação salva."}
              {dirty && <span className="ml-2 font-semibold text-gold-fg">Alterações não salvas</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {dirty && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSlots(team.lineup.slots);
                    setFormation(team.lineup.formation || rules.formations[0].key);
                  }}
                >
                  <RotateCcw /> Desfazer
                </Button>
              )}
              {slots.length === 0 && bench.length > 0 && (
                <Button size="sm" onClick={() => chooseFormation(formation)}>
                  <Sparkles /> Escalar automaticamente
                </Button>
              )}
              <Button size="sm" variant="primary" disabled={!dirty} loading={save.pending} onClick={() => save.runSafe()}>
                <Save /> Salvar escalação
              </Button>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-line bg-surface p-4">
          {selectedAthlete ? (
            <div className="anim-flip flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-full font-display text-[20px] font-extrabold" style={{ background: team.color, color: inkOn(team.color) }}>
                {selectedAthlete.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{selectedAthlete.name}</span>
                <span className="block text-[12px] text-fg-muted">
                  {positionLabel(team.modality, selectedAthlete.position)}
                  {selectedAthlete.course ? ` · ${selectedAthlete.course}` : ""}
                </span>
              </span>
              {editable && selectedOnCourt && (
                <Button size="icon-sm" variant="ghost" aria-label={`Tirar ${selectedAthlete.name} da quadra`} title="Tirar da quadra" onClick={removeSelected}>
                  <UserMinus />
                </Button>
              )}
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-fg-muted">
              {editable ? "Toque num jogador da quadra para ver os dados ou trocar. Toque num reserva para colocá-lo em quadra." : "Toque num jogador para ver os dados."}
            </p>
          )}
          {editable && selectedOnCourt && <p className="mt-3 text-[12px] text-gold-fg">Escolha um reserva abaixo para entrar no lugar.</p>}
        </div>

        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="eyebrow">Banco de reservas</h3>
            <span className="tnum font-mono text-[12px] text-fg-subtle">{bench.length}</span>
          </div>
          {bench.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-fg-muted">{team.athletes.length === 0 ? "O elenco está vazio. Inclua atletas na aba Elenco." : "Todos os atletas ativos estão em quadra."}</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {bench.map((a, i) => (
                <li key={a.id} className="anim-row" style={{ animationDelay: `${i * 35}ms` }}>
                  <button
                    type="button"
                    disabled={!editable || (full && !selectedOnCourt)}
                    onClick={() => benchClick(a)}
                    className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors enabled:hover:bg-surface-2 disabled:cursor-default", selected === a.id && "bg-surface-2")}
                  >
                    <span className="tnum grid size-8 shrink-0 place-items-center rounded-full border-2 font-mono text-[13px] font-bold" style={{ borderColor: team.color }}>
                      {a.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
                      <span className="block text-[11.5px] text-fg-subtle">{positionLabel(team.modality, a.position)}</span>
                    </span>
                    {editable && (!full || selectedOnCourt) && <UserPlus className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {editable && full && !selectedOnCourt && bench.length > 0 && (
            <p className="border-t border-line px-4 py-2.5 text-[12px] text-fg-muted">Quadra completa. Selecione um titular para substituir.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

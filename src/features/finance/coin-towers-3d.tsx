"use client";

/**
 * Torres de moedas (React Three Fiber): por mês, uma pilha dourada (o que
 * entrou) e uma azul (o que saiu). Carregada só na tela do Financeiro
 * (next/dynamic), para o three.js não pesar no resto do sistema.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { formatMoney } from "@/lib/format";
import { monthLabel, type MonthMoney } from "./month-numbers";

const COIN_R = 0.42;
const COIN_H = 0.13;
const MAX_COINS = 34;
const SPACING = 2.3;
const GOLD = "#e1af37";
const BLUE = "#3f74e0";

export interface TowerHover {
  key: string;
  kind: "income" | "expense";
}

/** Quantas moedas cada valor vira (proporcional ao maior mês; ao menos 1 quando há valor). */
function coinsFor(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.round((value / max) * MAX_COINS));
}

/** Uma torre: moedas instanciadas que caem uma a uma e empilham. */
function Tower({
  x,
  count,
  color,
  delay,
  active,
  onHover,
  onLeave,
  onClick,
}: {
  x: number;
  count: number;
  color: string;
  delay: number;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const material = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    done.current = false;
    start.current = null;
  }, [count]);

  useFrame((state) => {
    const mat = material.current;
    if (mat) mat.emissiveIntensity += ((active ? 0.45 : 0.05) - mat.emissiveIntensity) * 0.15;
    const m = mesh.current;
    if (!m || done.current) return;
    start.current ??= state.clock.elapsedTime;
    const t = state.clock.elapsedTime - start.current;
    let finished = true;
    for (let i = 0; i < count; i++) {
      const begin = delay + i * 0.035;
      const p = Math.min(1, Math.max(0, (t - begin) / 0.45));
      if (p < 1) finished = false;
      const fall = (1 - p) * (1 - p) * 7;
      const target = COIN_H / 2 + i * (COIN_H + 0.012);
      tmp.position.set(((i * 7) % 5) * 0.012 - 0.024, target + fall, ((i * 3) % 4) * 0.01 - 0.015);
      tmp.rotation.set(0, i * 0.6 + (1 - p) * 4, 0);
      tmp.scale.setScalar(p === 0 ? 0.0001 : 1);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (finished) done.current = true;
  });

  const height = Math.max(0.2, count * (COIN_H + 0.012));
  return (
    <group position={[x, 0, 0]}>
      {count > 0 && <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]} frustumCulled={false} castShadow receiveShadow>
        <cylinderGeometry args={[COIN_R, COIN_R, COIN_H, 32]} />
        <meshStandardMaterial ref={material} color={color} metalness={0.35} roughness={0.32} emissive={color} emissiveIntensity={0.05} />
      </instancedMesh>}
      {/* Área invisível para passar o mouse e clicar */}
      <mesh
        position={[0, height / 2, 0]}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
          onHover();
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          onLeave();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <cylinderGeometry args={[COIN_R + 0.1, COIN_R + 0.1, height + 0.2, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Rótulo do mês no chão (textura desenhada em canvas, sem fontes externas). */
function MonthTag({ x, text, current }: { x: number; text: string; current: boolean }) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = current ? "rgba(225,175,55,0.95)" : "rgba(197,205,230,0.9)";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, current]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[x, 0.02, 1.25]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.9, 0.72]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

export interface CoinTowers3DProps {
  months: MonthMoney[];
  onPick?: (key: string) => void;
}

export default function CoinTowers3D({ months, onPick }: CoinTowers3DProps) {
  const [hover, setHover] = useState<TowerHover | null>(null);
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const width = (months.length - 1) * SPACING;
  const hovered = hover ? months.find((m) => m.key === hover.key) : undefined;

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 5.6, 13.5], fov: 40 }} onPointerMissed={() => setHover(null)}>
      <hemisphereLight args={["#e9eeff", "#0b1a55", 0.75]} />
      <directionalLight position={[6, 12, 8]} intensity={1.7} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <pointLight position={[0, 6, 3]} intensity={25} distance={20} color="#ffd98a" />

      {/* Piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[width / 2 + 3.2, 64]} />
        <meshStandardMaterial color="#0d1d5c" roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[width / 2 + 3.05, width / 2 + 3.2, 96]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.6} />
      </mesh>

      {months.map((m, i) => {
        const x = i * SPACING - width / 2;
        const isCurrent = i === months.length - 1;
        const pick = () => onPick?.(m.key);
        return (
          <group key={m.key}>
            <Tower
              x={x - 0.48}
              count={coinsFor(m.income, max)}
              color={GOLD}
              delay={i * 0.12}
              active={hover?.key === m.key && hover.kind === "income"}
              onHover={() => setHover({ key: m.key, kind: "income" })}
              onLeave={() => setHover((h) => (h?.key === m.key && h.kind === "income" ? null : h))}
              onClick={pick}
            />
            <Tower
              x={x + 0.48}
              count={coinsFor(m.expense, max)}
              color={BLUE}
              delay={i * 0.12 + 0.06}
              active={hover?.key === m.key && hover.kind === "expense"}
              onHover={() => setHover({ key: m.key, kind: "expense" })}
              onLeave={() => setHover((h) => (h?.key === m.key && h.kind === "expense" ? null : h))}
              onClick={pick}
            />
            <MonthTag x={x} text={monthLabel(m)} current={isCurrent} />
          </group>
        );
      })}

      {hovered && hover && (
        <Html
          position={[months.indexOf(hovered) * SPACING - width / 2 + (hover.kind === "income" ? -0.48 : 0.48), coinsFor(hover.kind === "income" ? hovered.income : hovered.expense, max) * (COIN_H + 0.012) + 0.6, 0]}
          center
          style={{ pointerEvents: "none" }}
        >
          <div className="rounded-xl border border-white/15 bg-[#030f45]/90 px-3 py-2 text-center whitespace-nowrap text-white shadow-lg backdrop-blur">
            <div className="text-[11px] tracking-wider text-white/60 uppercase">{monthLabel(hovered)}</div>
            <div className="text-[14px] font-semibold" style={{ color: hover.kind === "income" ? GOLD : "#8fb0ec" }}>
              {hover.kind === "income" ? "Entrou" : "Saiu"} {formatMoney(hover.kind === "income" ? hovered.income : hovered.expense)}
            </div>
            <div className="text-[11.5px] text-white/70">Sobrou {formatMoney(hovered.balance)}</div>
          </div>
        </Html>
      )}

      <OrbitControls target={[0, 1.7, 0]} enablePan={false} minDistance={7} maxDistance={22} maxPolarAngle={Math.PI / 2 - 0.12} minPolarAngle={0.35} autoRotate={!hover} autoRotateSpeed={0.55} enableDamping />
    </Canvas>
  );
}

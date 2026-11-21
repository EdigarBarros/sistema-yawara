"use client";

/**
 * Mesa da próxima reunião em 3D (React Three Fiber): cadeiras com as iniciais
 * de cada participante e a pauta em folhas sobre a mesa. Carregada só na tela
 * da Secretaria (next/dynamic).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

export interface Seat {
  id: string;
  name: string;
  initials: string;
  /** Convidado externo (sem conta na Central). */
  guest?: boolean;
}

const RX = 3.1; // raio da mesa (comprimento)
const RZ = 1.75; // raio da mesa (largura)
const AVATAR_COLORS = ["#1b3f96", "#134cb6", "#2a3f7a", "#7a5a12", "#1f5f73"];

function colorFor(id: string) {
  const key = id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[key % AVATAR_COLORS.length];
}

function displayFont() {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const probe = document.createElement("span");
  probe.className = "font-display";
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || "system-ui, sans-serif";
}

/** Textura desenhada em canvas; refeita só quando `key` muda. */
function useCanvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, key: string) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o desenho depende só do que está em `key`
  }, [key, w, h]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Placa redonda com as iniciais (fica de pé atrás da cadeira, sempre virada para a câmera). */
function Plate({ seat }: { seat: Seat }) {
  const map = useCanvasTexture(
    (ctx, w, h) => {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
      ctx.fillStyle = seat.guest ? "#5b6481" : colorFor(seat.id);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = seat.guest ? "#c5cde6" : "#e1af37";
      ctx.stroke();
      ctx.fillStyle = seat.guest ? "#ffffff" : "#f3d27c";
      ctx.font = `800 96px ${displayFont()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(seat.initials, w / 2, h / 2 + 4);
    },
    256,
    256,
    `${seat.id}|${seat.initials}|${seat.guest ? 1 : 0}`,
  );
  return (
    <sprite position={[0, 1.45, 0]} scale={[0.62, 0.62, 1]}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  );
}

function Chair({ seat, angle, index, onHover }: { seat: Seat; angle: number; index: number; onHover: (s: Seat | null) => void }) {
  const group = useRef<THREE.Group>(null);
  const x = Math.cos(angle) * (RX + 0.75);
  const z = Math.sin(angle) * (RZ + 0.75);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    // Cadeiras "chegam" uma a uma ao abrir.
    const t = Math.min(1, Math.max(0, (state.clock.elapsedTime - 0.15 - index * 0.06) / 0.5));
    const ease = 1 - Math.pow(1 - t, 3);
    g.position.set(x * (0.6 + 0.4 * ease), 0, z * (0.6 + 0.4 * ease));
    g.scale.setScalar(Math.max(0.001, ease));
  });
  const color = seat.guest ? "#3a4363" : "#152a6b";
  return (
    <group
      ref={group}
      rotation={[0, -angle - Math.PI / 2, 0]}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onHover(seat);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = "";
      }}
    >
      {/* assento */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.55, 0.08, 0.5]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* encosto (do lado de fora da mesa) */}
      <mesh position={[0, 0.8, 0.24]} castShadow>
        <boxGeometry args={[0.55, 0.62, 0.07]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* pés */}
      {[-0.22, 0.22].map((px) =>
        [-0.2, 0.2].map((pz) => (
          <mesh key={`${px}${pz}`} position={[px, 0.21, pz]}>
            <cylinderGeometry args={[0.025, 0.025, 0.42, 6]} />
            <meshStandardMaterial color="#9aa3c0" metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
      <Plate seat={seat} />
    </group>
  );
}

/** Folha da pauta sobre a mesa (texto desenhado em canvas). */
function AgendaSheet({ text, n, x, z, rot, index }: { text: string; n: number; x: number; z: number; rot: number; index: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const map = useCanvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = "#fbfaf5";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#e1af37";
      ctx.fillRect(0, 0, w, 18);
      const font = displayFont();
      ctx.fillStyle = "#b28413";
      ctx.font = `800 64px ${font}`;
      ctx.fillText(`${n}.`, 28, 100);
      ctx.fillStyle = "#0b1a55";
      ctx.font = `700 42px ${font}`;
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > w - 56 && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
      lines.slice(0, 4).forEach((l, i) => ctx.fillText(i === 3 && lines.length > 4 ? `${l}…` : l, 28, 170 + i * 52));
      ctx.fillStyle = "#c5cde6";
      for (let i = 0; i < 3; i++) ctx.fillRect(28, 400 + i * 26, w - 56 - i * 60, 6);
    },
    420,
    512,
    `${n}|${text}`,
  );
  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    // Folhas deslizam do centro para o lugar.
    const t = Math.min(1, Math.max(0, (state.clock.elapsedTime - 0.6 - index * 0.12) / 0.6));
    const ease = 1 - Math.pow(1 - t, 3);
    m.position.set(x * ease, 0.836 + index * 0.002, z * ease);
    m.rotation.z = rot * ease;
    (m.material as THREE.MeshStandardMaterial).opacity = ease;
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[0.82, 1]} />
      <meshStandardMaterial map={map} transparent roughness={0.9} />
    </mesh>
  );
}

function Table() {
  return (
    <group>
      {/* tampo oval */}
      <mesh position={[0, 0.78, 0]} scale={[RX, 1, RZ]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 0.1, 64]} />
        <meshStandardMaterial color="#4a2e1c" roughness={0.45} metalness={0.05} />
      </mesh>
      {/* borda dourada */}
      <mesh position={[0, 0.83, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[RX, RZ, 1]}>
        <torusGeometry args={[1, 0.012, 8, 96]} />
        <meshStandardMaterial color="#e1af37" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* base */}
      <mesh position={[0, 0.38, 0]} scale={[RX * 0.35, 1, RZ * 0.35]}>
        <cylinderGeometry args={[1, 1.2, 0.72, 32]} />
        <meshStandardMaterial color="#2e1c11" roughness={0.6} />
      </mesh>
      {/* tapete */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} scale={[RX + 1.9, RZ + 1.9, 1]} receiveShadow>
        <circleGeometry args={[1, 64]} />
        <meshStandardMaterial color="#13245e" roughness={0.95} />
      </mesh>
    </group>
  );
}

export default function MeetingTable3D({ seats, agenda }: { seats: Seat[]; agenda: string[] }) {
  const [hover, setHover] = useState<Seat | null>(null);
  const shown = seats.slice(0, 14);
  const items = agenda.slice(0, 5);
  // Folhas espalhadas no meio da mesa.
  const sheets = items.map((text, i) => {
    const spread = items.length > 1 ? (i / (items.length - 1) - 0.5) * Math.min(4, items.length * 1) : 0;
    return { text, n: i + 1, x: spread, z: (i % 2 ? 0.25 : -0.2), rot: ((i * 37) % 20 - 10) * 0.012 };
  });
  const angleOf = (i: number) => (i / shown.length) * Math.PI * 2 + Math.PI / 2;
  const hoverIndex = hover ? shown.findIndex((s) => s.id === hover.id) : -1;

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 6.2, 6.4], fov: 40 }}>
      <hemisphereLight args={["#eef2ff", "#0b1a55", 0.7]} />
      <directionalLight position={[3, 9, 4]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
      {/* luminária sobre a mesa */}
      <pointLight position={[0, 4, 0]} intensity={22} distance={12} color="#ffe2a8" />
      <Table />
      {shown.map((seat, i) => (
        <Chair key={seat.id} seat={seat} angle={angleOf(i)} index={i} onHover={setHover} />
      ))}
      {sheets.map((s, i) => (
        <AgendaSheet key={i} index={i} {...s} />
      ))}
      {hover && hoverIndex >= 0 && (
        <Html position={[Math.cos(angleOf(hoverIndex)) * (RX + 0.75), 2.1, Math.sin(angleOf(hoverIndex)) * (RZ + 0.75)]} center style={{ pointerEvents: "none" }}>
          <div className="rounded-lg border border-white/15 bg-[#030f45]/90 px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap text-white backdrop-blur">
            {hover.name}
            {hover.guest ? " · convidado(a)" : ""}
          </div>
        </Html>
      )}
      <OrbitControls target={[0, 0.6, 0]} enablePan={false} enableZoom={false} maxPolarAngle={Math.PI / 2.6} minPolarAngle={0.35} autoRotate={!hover} autoRotateSpeed={0.4} enableDamping />
    </Canvas>
  );
}

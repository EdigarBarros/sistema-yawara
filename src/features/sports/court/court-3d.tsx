"use client";

/**
 * Quadra 3D (React Three Fiber). Carregada só na tela do time (next/dynamic),
 * para o three.js não pesar no resto do sistema.
 *
 * Interação: arrastar um jogador o move pelo piso (a câmera trava enquanto
 * isso); arrastar o fundo gira a câmera; a roda/pinça aproxima.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { CourtModality as SportModality } from "@/lib/sports-court";
import { COURT_RULES as SPORT_RULES } from "@/lib/sports-court";
import { clampToCourt, FLOOR, type CameraPreset, type CourtPlayer } from "./court-geometry";

type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;

const LINE_Y = 0.012;
const LINE_W = 0.08;

/* ------------------------------- marcações ------------------------------- */

function Line({ x, z, length, width = LINE_W, rotation = 0, color }: { x: number; z: number; length: number; width?: number; rotation?: number; color: string }) {
  return (
    <mesh position={[x, LINE_Y, z]} rotation={[-Math.PI / 2, 0, rotation]} receiveShadow>
      <planeGeometry args={[length, width]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  );
}

function Arc({ x, z, radius, start, length, color, fill }: { x: number; z: number; radius: number; start: number; length: number; color: string; fill?: string }) {
  return (
    <group position={[x, LINE_Y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      {fill && (
        <mesh position={[0, 0, -0.004]} receiveShadow>
          <circleGeometry args={[radius, 48, start, length]} />
          <meshStandardMaterial color={fill} roughness={0.8} />
        </mesh>
      )}
      <mesh receiveShadow>
        <ringGeometry args={[radius - LINE_W / 2, radius + LINE_W / 2, 64, 1, start, length]} />
        <meshStandardMaterial color={color} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Rect({ x, z, l, w, color, fill }: { x: number; z: number; l: number; w: number; color: string; fill?: string }) {
  return (
    <group>
      {fill && (
        <mesh position={[x, LINE_Y - 0.004, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[l, w]} />
          <meshStandardMaterial color={fill} roughness={0.8} />
        </mesh>
      )}
      <Line x={x} z={z - w / 2} length={l} color={color} />
      <Line x={x} z={z + w / 2} length={l} color={color} />
      <Line x={x - l / 2} z={z} length={w} rotation={Math.PI / 2} color={color} />
      <Line x={x + l / 2} z={z} length={w} rotation={Math.PI / 2} color={color} />
    </group>
  );
}

function Goal({ side, width, height, halfL }: { side: 1 | -1; width: number; height: number; halfL: number }) {
  const x = side * (halfL + 0.5);
  const post = <meshStandardMaterial color="#f4f6fb" metalness={0.2} roughness={0.35} />;
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, height / 2, -width / 2]} castShadow>
        <boxGeometry args={[0.08, height, 0.08]} />
        {post}
      </mesh>
      <mesh position={[0, height / 2, width / 2]} castShadow>
        <boxGeometry args={[0.08, height, 0.08]} />
        {post}
      </mesh>
      <mesh position={[0, height, 0]} castShadow>
        <boxGeometry args={[0.08, 0.08, width + 0.08]} />
        {post}
      </mesh>
      {/* rede */}
      <mesh position={[side * 0.5, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[width, height, 12, 8]} />
        <meshStandardMaterial color="#ffffff" wireframe transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Hoop({ side, halfL }: { side: 1 | -1; halfL: number }) {
  const boardX = side * (halfL - 1.2);
  const rimX = side * (halfL - 1.575);
  return (
    <group>
      <mesh position={[side * (halfL + 0.6), 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 3.2, 12]} />
        <meshStandardMaterial color="#26304d" />
      </mesh>
      <mesh position={[side * (halfL - 0.2), 3.2, 0]} castShadow>
        <boxGeometry args={[2, 0.08, 0.08]} />
        <meshStandardMaterial color="#26304d" />
      </mesh>
      <mesh position={[boardX, 3.35, 0]} castShadow>
        <boxGeometry args={[0.05, 1.05, 1.8]} />
        <meshStandardMaterial color="#e9eefc" transparent opacity={0.75} />
      </mesh>
      <mesh position={[rimX, 3.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.23, 0.02, 8, 24]} />
        <meshStandardMaterial color="#e5571f" metalness={0.4} roughness={0.4} />
      </mesh>
    </group>
  );
}

function VolleyNet({ halfW }: { halfW: number }) {
  const h = 2.43;
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 1.27, s * (halfW + 0.6)]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 2.55, 12]} />
          <meshStandardMaterial color="#c5cde6" metalness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, h - 0.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[halfW * 2 + 1.2, 1, 48, 10]} />
        <meshBasicMaterial color="#e9eefc" wireframe transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, h, 0]}>
        <boxGeometry args={[0.03, 0.07, halfW * 2 + 1.2]} />
        <meshStandardMaterial color="#f4f6fb" />
      </mesh>
    </group>
  );
}

/** Piso, linhas e equipamentos de cada modalidade. */
function CourtMarkings({ modality }: { modality: SportModality }) {
  const r = SPORT_RULES[modality];
  const f = FLOOR[modality];
  const halfL = r.length / 2;
  const halfW = r.width / 2;
  const c = f.line;
  const parts: ReactNode[] = [];

  if (modality === "futsal" || modality === "handebol") {
    const area = 6;
    for (const s of [-1, 1] as const) {
      // área do goleiro: meia-lua a partir do gol
      parts.push(<Arc key={`a${s}`} x={s * halfL} z={0} radius={area} start={s === 1 ? Math.PI / 2 : -Math.PI / 2} length={Math.PI} color={c} fill={f.zone} />);
      if (modality === "handebol") parts.push(<Arc key={`f${s}`} x={s * halfL} z={0} radius={9} start={s === 1 ? Math.PI / 2 : -Math.PI / 2} length={Math.PI} color={c} />);
      parts.push(<Goal key={`g${s}`} side={s} width={3} height={2} halfL={halfL} />);
    }
    parts.push(<Arc key="cc" x={0} z={0} radius={3} start={0} length={Math.PI * 2} color={c} />);
  }
  if (modality === "basquete") {
    for (const s of [-1, 1] as const) {
      parts.push(<Rect key={`k${s}`} x={s * (halfL - 2.9)} z={0} l={5.8} w={4.9} color={c} fill={f.zone} />);
      parts.push(<Arc key={`t${s}`} x={s * (halfL - 1.575)} z={0} radius={6.75} start={s === 1 ? Math.PI / 2 : -Math.PI / 2} length={Math.PI} color={c} />);
      parts.push(<Arc key={`l${s}`} x={s * (halfL - 5.8)} z={0} radius={1.8} start={0} length={Math.PI * 2} color={c} />);
      parts.push(<Hoop key={`h${s}`} side={s} halfL={halfL} />);
    }
    parts.push(<Arc key="cc" x={0} z={0} radius={1.8} start={0} length={Math.PI * 2} color={c} />);
  }
  if (modality === "volei") {
    parts.push(<Line key="a1" x={-3} z={0} length={r.width} rotation={Math.PI / 2} color={c} />);
    parts.push(<Line key="a2" x={3} z={0} length={r.width} rotation={Math.PI / 2} color={c} />);
    parts.push(<VolleyNet key="net" halfW={halfW} />);
  }

  return (
    <group>
      {/* piso externo e quadra */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[r.length + 8, r.width + 8]} />
        <meshStandardMaterial color={f.outer} roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[r.length, r.width]} />
        <meshStandardMaterial color={f.court} roughness={0.55} metalness={0.05} />
      </mesh>
      <Rect x={0} z={0} l={r.length} w={r.width} color={c} />
      <Line x={0} z={0} length={r.width} rotation={Math.PI / 2} color={c} />
      {parts}
      <Bleachers halfL={halfL} halfW={halfW} />
    </group>
  );
}

/** Arquibancada, para dar a sensação de ginásio. */
function Bleachers({ halfL, halfW }: { halfL: number; halfW: number }) {
  const steps = [0, 1, 2, 3];
  return (
    <group position={[0, 0, -(halfW + 5)]}>
      {steps.map((i) => (
        <mesh key={i} position={[0, 0.25 + i * 0.5, -i * 0.9]} castShadow receiveShadow>
          <boxGeometry args={[halfL * 2 + 4, 0.5 + i * 1, 0.9]} />
          <meshStandardMaterial color={i % 2 ? "#1a2a66" : "#22357a"} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* -------------------------------- jogador -------------------------------- */

/** Etiqueta com número e posição (textura desenhada em canvas, sem fontes externas). */
function useLabelTexture(number: string, short: string, color: string) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(3,15,69,0.88)";
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 112, 30);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(number || "—", 92, 66);
    ctx.fillStyle = color;
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.fillText(short, 186, 66);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [number, short, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Player({
  player,
  color,
  selected,
  editable,
  size,
  onPointerDown,
}: {
  player: CourtPlayer;
  color: string;
  selected: boolean;
  editable: boolean;
  /** Quadras grandes ganham jogadores maiores, para continuarem legíveis. */
  size: number;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  const label = useLabelTexture(player.number, player.short, color);
  const [hover, setHover] = useState(false);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    // Entra em quadra "caindo" e desliza suavemente até a posição.
    born.current ??= state.clock.elapsedTime;
    const t = Math.min(1, (state.clock.elapsedTime - born.current) / 0.6);
    const ease = 1 - Math.pow(1 - t, 3);
    g.scale.setScalar(size * (0.2 + 0.8 * ease));
    g.position.x += (player.x - g.position.x) * 0.25;
    g.position.z += (player.z - g.position.z) * 0.25;
    g.position.y = (1 - ease) * 3 + (selected ? 0.12 + Math.sin(state.clock.elapsedTime * 4) * 0.06 : 0);
    if (ring.current) ring.current.rotation.z += 0.02;
  });

  return (
    <group
      ref={group}
      position={[player.x, 3, player.z]}
      onPointerDown={editable ? onPointerDown : undefined}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = editable ? "grab" : "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
    >
      {/* sombra/anel de seleção no chão */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.5, selected ? 0.66 : 0.56, 32]} />
        <meshBasicMaterial color={selected ? "#e1af37" : hover ? "#ffffff" : "#000000"} transparent opacity={selected ? 0.95 : hover ? 0.6 : 0.25} />
      </mesh>
      {/* corpo */}
      <mesh position={[0, 0.62, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.62, 6, 16]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.1} emissive={color} emissiveIntensity={selected ? 0.35 : hover ? 0.18 : 0.04} />
      </mesh>
      {/* cabeça */}
      <mesh position={[0, 1.38, 0]} castShadow>
        <sphereGeometry args={[0.2, 20, 20]} />
        <meshStandardMaterial color="#f1d3b5" roughness={0.7} />
      </mesh>
      {/* Etiqueta com tamanho fixo na tela (legível de perto e de longe) */}
      <sprite position={[0, 2.1, 0]} scale={[0.062, 0.031, 1]} renderOrder={10}>
        <spriteMaterial map={label} depthTest={false} transparent sizeAttenuation={false} />
      </sprite>
    </group>
  );
}

/* --------------------------------- câmera -------------------------------- */

function cameraFor(preset: CameraPreset, modality: SportModality): [number, number, number] {
  const r = SPORT_RULES[modality];
  const span = Math.max(r.length, r.width * 1.8);
  if (preset === "top") return [0, span * 1.15, 0.01];
  if (preset === "bench") return [-r.length * 0.3, 3.2, r.width * 0.5 + 4.5];
  return [0, span * 0.62, span * 0.98];
}

/** Leva a câmera até a vista escolhida e depois a deixa livre para girar. */
function CameraRig({ preset, modality, controls }: { preset: CameraPreset; modality: SportModality; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(...cameraFor(preset, modality)));
  const moving = useRef(true);
  useEffect(() => {
    target.current.set(...cameraFor(preset, modality));
    moving.current = true;
  }, [preset, modality]);
  useFrame(() => {
    if (!moving.current) return;
    camera.position.lerp(target.current, 0.08);
    controls.current?.target.lerp(new THREE.Vector3(preset === "bench" ? -2 : 0, 0, 0), 0.08);
    controls.current?.update();
    if (camera.position.distanceTo(target.current) < 0.05) moving.current = false;
  });
  return null;
}

/* --------------------------------- cena ---------------------------------- */

export interface Court3DProps {
  modality: SportModality;
  color: string;
  players: CourtPlayer[];
  selectedId: string | null;
  editable: boolean;
  preset: CameraPreset;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}

function Scene({ modality, color, players, selectedId, editable, preset, onSelect, onMove }: Court3DProps) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const r = SPORT_RULES[modality];

  const startDrag = (id: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    onSelect(id);
    setDragging(id);
    document.body.style.cursor = "grabbing";
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    e.stopPropagation();
    const p = clampToCourt(modality, e.point.x, e.point.z);
    onMove(dragging, p.x, p.z);
  };
  const end = () => {
    if (!dragging) return;
    setDragging(null);
    document.body.style.cursor = "";
  };

  return (
    <>
      <color attach="background" args={["#071542"]} />
      <fog attach="fog" args={["#071542", 45, 110]} />
      <hemisphereLight args={["#dfe8ff", "#0b1a55", 0.7]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[12, 26, 14]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      {/* refletores do ginásio */}
      <pointLight position={[-r.length / 3, 14, 0]} intensity={60} distance={40} color="#fff4dc" />
      <pointLight position={[r.length / 3, 14, 0]} intensity={60} distance={40} color="#fff4dc" />

      <CourtMarkings modality={modality} />

      {/* Plano invisível que recebe o arraste (acima do piso, cobre a área toda) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} onPointerMove={move} onPointerUp={end} onPointerLeave={end} onClick={() => !dragging && onSelect(null)} visible={false}>
        <planeGeometry args={[r.length + 8, r.width + 8]} />
        <meshBasicMaterial />
      </mesh>

      {players.map((p) => (
        <Player key={p.id} player={p} color={color} selected={p.id === selectedId} editable={editable} size={Math.max(1, r.length / 24)} onPointerDown={startDrag(p.id)} />
      ))}

      <OrbitControls
        ref={controls}
        makeDefault
        enabled={!dragging}
        enablePan={false}
        minDistance={6}
        maxDistance={70}
        maxPolarAngle={Math.PI / 2 - 0.08}
        enableDamping
        dampingFactor={0.08}
      />
      <CameraRig preset={preset} modality={modality} controls={controls} />
    </>
  );
}

export default function Court3D(props: Court3DProps) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: cameraFor(props.preset, props.modality), fov: 42, near: 0.1, far: 300 }} onPointerMissed={() => props.onSelect(null)}>
      <Scene {...props} />
    </Canvas>
  );
}

"use client";

/**
 * Ingresso 3D do próximo evento (React Three Fiber), flutuando entre confetes.
 * Carregado só na tela do(a) Diretor(a) de Eventos (next/dynamic).
 * O ingresso inclina na direção do mouse; a frente é desenhada em canvas.
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const W = 6.4;
const H = 3;
const STUB = 1.55; // largura do canhoto (à direita)
const CONFETTI = ["#e1af37", "#e88ab5", "#5b86d9", "#3fcf8e", "#f2a93b", "#ffffff"];

export interface TicketInfo {
  eyebrow: string;
  name: string;
  dateLine: string;
  placeLine: string;
  day: string;
  month: string;
  color: string;
}

/** Fonte de títulos do sistema (Barlow), se já estiver carregada na página. */
function displayFont() {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const probe = document.createElement("span");
  probe.className = "font-display";
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || "system-ui, sans-serif";
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines = 2) {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = w;
      if (out.length === lines - 1) break;
    } else line = next;
  }
  const rest = words.slice(out.join(" ").split(/\s+/).filter(Boolean).length).join(" ");
  if (out.length < lines) {
    let last = out.length ? rest : line;
    while (ctx.measureText(last).width > max && last.length > 3) last = `${last.slice(0, -2).trimEnd()}…`;
    out.push(last);
  }
  return out;
}

/** Arte da frente do ingresso. */
function useTicketTexture(info: TicketInfo) {
  const texture = useMemo(() => {
    const px = 260; // pixels por unidade
    const c = document.createElement("canvas");
    c.width = W * px;
    c.height = H * px;
    const ctx = c.getContext("2d")!;
    const font = displayFont();
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, "#0d2a7a");
    g.addColorStop(1, "#030f45");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    // faixa colorida do tipo do evento
    ctx.fillStyle = info.color;
    ctx.fillRect(0, 0, 36, c.height);
    // brilho
    const glow = ctx.createRadialGradient(c.width * 0.75, 0, 10, c.width * 0.75, 0, c.width * 0.6);
    glow.addColorStop(0, `${info.color}55`);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, c.width, c.height);
    // perfuração do canhoto
    const stubX = (W - STUB) * px;
    ctx.setLineDash([22, 18]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(stubX, 40);
    ctx.lineTo(stubX, c.height - 40);
    ctx.stroke();
    ctx.setLineDash([]);
    // textos
    const left = 110;
    const max = stubX - left - 70;
    ctx.fillStyle = info.color;
    ctx.font = `700 54px ${font}`;
    ctx.fillText(info.eyebrow.toUpperCase(), left, 130);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 132px ${font}`;
    wrap(ctx, info.name, max).forEach((l, i) => ctx.fillText(l, left, 290 + i * 140));
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = `600 58px ${font}`;
    ctx.fillText(info.dateLine, left, c.height - 170);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `500 50px ${font}`;
    ctx.fillText(wrap(ctx, info.placeLine, max, 1)[0], left, c.height - 95);
    // canhoto
    const cx = stubX + (STUB * px) / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = info.color;
    ctx.font = `700 56px ${font}`;
    ctx.fillText(info.month.toUpperCase(), cx, 250);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 210px ${font}`;
    ctx.fillText(info.day, cx, 460);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `700 40px ${font}`;
    ctx.fillText("ENTRADA", cx, 600);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    // A geometria extrudada usa as coordenadas da forma como UV: ajusta para cobrir a frente.
    t.repeat.set(1 / W, 1 / H);
    t.offset.set(0.5, 0.5);
    return t;
  }, [info]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Forma do ingresso: retângulo arredondado com os recortes do canhoto. */
function ticketShape() {
  const s = new THREE.Shape();
  const r = 0.22;
  const notch = 0.22;
  const x0 = -W / 2;
  const y0 = -H / 2;
  const nx = W / 2 - STUB;
  s.moveTo(x0 + r, y0);
  s.lineTo(nx - notch, y0);
  s.absarc(nx, y0, notch, Math.PI, 0, false);
  s.lineTo(W / 2 - r, y0);
  s.quadraticCurveTo(W / 2, y0, W / 2, y0 + r);
  s.lineTo(W / 2, H / 2 - r);
  s.quadraticCurveTo(W / 2, H / 2, W / 2 - r, H / 2);
  s.lineTo(nx + notch, H / 2);
  s.absarc(nx, H / 2, notch, 0, Math.PI, false);
  s.lineTo(x0 + r, H / 2);
  s.quadraticCurveTo(x0, H / 2, x0, H / 2 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

function Ticket({ info }: { info: TicketInfo }) {
  const group = useRef<THREE.Group>(null);
  const map = useTicketTexture(info);
  const geometry = useMemo(() => new THREE.ExtrudeGeometry(ticketShape(), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 24 }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    // Entra girando e depois flutua, inclinando para o lado do mouse.
    const intro = Math.min(1, t / 1.2);
    const ease = 1 - Math.pow(1 - intro, 3);
    const targetY = state.pointer.x * 0.35 + Math.sin(t * 0.6) * 0.12;
    const targetX = -state.pointer.y * 0.25 + Math.sin(t * 0.8) * 0.04;
    const desiredY = targetY + (1 - ease) * Math.PI * 1.5;
    g.rotation.y += (desiredY - g.rotation.y) * (intro < 1 ? 0.25 : 0.08);
    g.rotation.x += (targetX - g.rotation.x) * 0.08;
    g.position.y = Math.sin(t * 1.1) * 0.12;
    g.scale.setScalar(0.6 + 0.4 * ease);
  });

  return (
    <group ref={group}>
      <mesh geometry={geometry} position={[0, 0, -0.04]} castShadow>
        <meshStandardMaterial attach="material-0" map={map} roughness={0.45} metalness={0.15} />
        <meshStandardMaterial attach="material-1" color="#e1af37" metalness={0.8} roughness={0.25} />
      </mesh>
    </group>
  );
}

/** Confetes caindo devagar em volta do ingresso. */
function Confetti({ count = 70 }: { count?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: ((i * 37) % 100) / 100 * 14 - 7,
        y: ((i * 53) % 100) / 100 * 9 - 4.5,
        z: ((i * 29) % 100) / 100 * 4 - 3,
        speed: 0.25 + ((i * 17) % 10) / 25,
        spin: 0.5 + ((i * 11) % 10) / 6,
      })),
    [count],
  );
  // Uma cor por confete (cor por instância).
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) m.setColorAt(i, c.set(CONFETTI[i % CONFETTI.length]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count]);

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    seeds.forEach((s, i) => {
      const y = ((((s.y - t * s.speed + 4.5) % 9) + 9) % 9) - 4.5;
      tmp.position.set(s.x + Math.sin(t * 0.7 + i) * 0.25, y, s.z);
      tmp.rotation.set(t * s.spin, t * s.spin * 0.7, i);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <planeGeometry args={[0.12, 0.2]} />
      <meshBasicMaterial side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

export default function EventTicket3D({ info }: { info: TicketInfo }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 6.9], fov: 42 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 6]} intensity={1.6} />
      <pointLight position={[-4, -2, 4]} intensity={18} color={info.color} />
      <Confetti />
      <Ticket info={info} />
    </Canvas>
  );
}

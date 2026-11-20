import type { ReactNode } from "react";
import {
  Award,
  BadgeCheck,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  Camera,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileText,
  Film,
  Flag,
  GraduationCap,
  Heart,
  Image as ImageIcon,
  ListChecks,
  MapPin,
  Megaphone,
  Mic,
  Music,
  PenLine,
  Receipt,
  Shirt,
  Target,
  Ticket,
  Timer,
  Trophy,
  Users,
  Vote,
  Wallet,
} from "lucide-react";

/**
 * Peças fictícias da órbita da tela de entrada, 8 por diretoria. Só ilustram
 * o que cada diretoria faz na Central (a tela aparece antes do login).
 */

export type Tone = "gold" | "ok" | "info" | "rose" | "violet";

export interface PieceData {
  icon: ReactNode;
  title: string;
  tone?: Tone;
  body: ReactNode;
}

export interface Board {
  key: string;
  /** Palavra de "Para a diretoria de …". */
  word: string;
  pieces: PieceData[];
}

/* ---------- miolos das peças ---------- */
const Big = ({ v, s, ok }: { v: string; s?: string; ok?: boolean }) => (
  <div className={ok ? "pc-big pc-ok" : "pc-big"}>
    {v}
    {s && <small> {s}</small>}
  </div>
);
const Bar = ({ pct }: { pct: number }) => (
  <div className="pc-bar">
    <i style={{ width: `${pct}%` }} />
  </div>
);
const Pill = ({ children }: { children: ReactNode }) => <div className="pc-pill">{children}</div>;
const Cols = ({ hs }: { hs: number[] }) => (
  <div className="pc-cols">
    {hs.map((h, i) => (
      <i key={i} style={{ height: `${h}%` }} />
    ))}
  </div>
);
const DateRow = ({ d, m, t }: { d: string; m: string; t: string }) => (
  <div className="pc-date">
    <b>{d}</b>
    <span>
      {m}
      <em>{t}</em>
    </span>
  </div>
);
const Faces = ({ n, more }: { n: string[]; more?: string }) => (
  <div className="pc-faces">
    {n.map((x) => (
      <i key={x}>{x}</i>
    ))}
    {more && <span>{more}</span>}
  </div>
);
const File = ({ tag, name, color }: { tag: string; name: string; color?: string }) => (
  <div className="pc-file">
    <span style={color ? { background: color } : undefined}>{tag}</span>
    {name}
  </div>
);
const Line = ({ children }: { children: ReactNode }) => <div className="pc-line">{children}</div>;

export const BOARDS: Board[] = [
  {
    key: "esportes",
    word: "Esportes",
    pieces: [
      { icon: <Trophy />, title: "Futsal feminino", body: <div className="pc-score">Yawara <b>3 × 1</b></div> },
      { icon: <Timer />, title: "Treino", tone: "info", body: <DateRow d="TER" m="19H" t="Quadra da UEPA" /> },
      { icon: <Users />, title: "Elenco", tone: "ok", body: <Big v="14" s="atletas" /> },
      { icon: <Flag />, title: "Próximo jogo", tone: "rose", body: <Line>Yawara × Medicina · sáb 10h</Line> },
      { icon: <Shirt />, title: "Vôlei", tone: "violet", body: <Pill>Escalação pronta</Pill> },
      { icon: <Target />, title: "Artilheira", body: <Line>Ana Clara · <b>7 gols</b></Line> },
      { icon: <Award />, title: "Interclasses", tone: "gold", body: <Pill>1º lugar 🏆</Pill> },
      { icon: <ListChecks />, title: "Presença no treino", tone: "ok", body: <><Big v="92%" /><Bar pct={92} /></> },
    ],
  },
  {
    key: "financeiro",
    word: "Financeiro",
    pieces: [
      { icon: <Wallet />, title: "Recebido", tone: "ok", body: <Big v="+ R$ 912,00" ok /> },
      { icon: <BarChart3 />, title: "Saldo", body: <><Big v="R$ 4.454" /><Cols hs={[38, 62, 44, 80, 56, 92]} /></> },
      { icon: <Receipt />, title: "Despesa", tone: "rose", body: <Line>Kalunga · <b>− R$ 45,50</b></Line> },
      { icon: <FileText />, title: "Comprovante", tone: "info", body: <File tag="PDF" name="Pix Kalunga" /> },
      { icon: <Target />, title: "Meta da Calourada", tone: "gold", body: <><Big v="R$ 1.420" s="de 2.000" /><Bar pct={71} /></> },
      { icon: <Ticket />, title: "Pix da rifa", tone: "ok", body: <Line>Danilo · <b>+ R$ 5,00</b></Line> },
      { icon: <BadgeCheck />, title: "Prestação de contas", tone: "violet", body: <Pill>Aprovada</Pill> },
      { icon: <FileText />, title: "Relatório do mês", tone: "info", body: <File tag="PDF" name="Setembro 2026" /> },
    ],
  },
  {
    key: "comunicacao",
    word: "Comunicação",
    pieces: [
      { icon: <Megaphone />, title: "Post agendado", tone: "rose", body: <File tag="IG" name="Arte da Calourada" color="linear-gradient(135deg,#f58529,#dd2a7b 55%,#8134af)" /> },
      { icon: <Film />, title: "Reels", tone: "violet", body: <Line>Bastidores do treino · 0:42</Line> },
      { icon: <Camera />, title: "Story", tone: "rose", body: <Pill>Publicado hoje</Pill> },
      { icon: <PenLine />, title: "Briefing", tone: "info", body: <Line>Camisa nova · <b>aprovado</b></Line> },
      { icon: <CalendarDays />, title: "Calendário de posts", tone: "gold", body: <DateRow d="5" m="POSTS" t="nesta semana" /> },
      { icon: <Heart />, title: "Curtidas", tone: "rose", body: <Big v="1,2 mil" /> },
      { icon: <ImageIcon />, title: "Arte nova", tone: "violet", body: <div className="pc-art">CALOURADA</div> },
      { icon: <Users />, title: "Seguidores", tone: "ok", body: <><Big v="+86" s="no mês" /><Cols hs={[30, 42, 38, 60, 72, 88]} /></> },
    ],
  },
  {
    key: "eventos",
    word: "Eventos",
    pieces: [
      { icon: <CalendarDays />, title: "Agenda", tone: "info", body: <DateRow d="22" m="NOV" t="Recepção aos calouros" /> },
      { icon: <Users />, title: "Confirmados", tone: "ok", body: <><Big v="120" s="pessoas" /><Bar pct={80} /></> },
      { icon: <Music />, title: "Fornecedor", tone: "violet", body: <Line>DJ · <b>contratado</b></Line> },
      { icon: <ListChecks />, title: "Tarefas", tone: "gold", body: <><Big v="8" s="de 12 feitas" /><Bar pct={66} /></> },
      { icon: <MapPin />, title: "Local", tone: "rose", body: <Pill>Espaço reservado</Pill> },
      { icon: <Ticket />, title: "Ingressos", tone: "gold", body: <Big v="73" s="vendidos" /> },
      { icon: <ClipboardList />, title: "Programação", tone: "info", body: <Line>20h abertura · 22h show</Line> },
      { icon: <Mic />, title: "Atração", tone: "violet", body: <Line>Banda da Psico</Line> },
    ],
  },
  {
    key: "secretaria",
    word: "Secretaria",
    pieces: [
      { icon: <ClipboardCheck />, title: "Ata da reunião", tone: "ok", body: <Pill>✓ Aprovada</Pill> },
      { icon: <CalendarCheck />, title: "Reunião", tone: "info", body: <DateRow d="27" m="SEX · 18H" t="Diretoria geral" /> },
      { icon: <ListChecks />, title: "Pauta", tone: "gold", body: <Line>4 assuntos · 1 votação</Line> },
      { icon: <Users />, title: "Presença", tone: "ok", body: <Faces n={["RL", "HP", "CM", "LM"]} more="+7" /> },
      { icon: <FileSignature />, title: "Ofício", tone: "violet", body: <Line>Pedido de quadra · <b>enviado</b></Line> },
      { icon: <Vote />, title: "Votação", tone: "info", body: <><Big v="9" s="a favor · 2 contra" /><Bar pct={82} /></> },
      { icon: <FileText />, title: "Estatuto", tone: "rose", body: <File tag="PDF" name="Estatuto 2026" /> },
      { icon: <PenLine />, title: "Assinaturas", tone: "gold", body: <Big v="11" s="de 14" /> },
    ],
  },
  {
    key: "extensao",
    word: "Ensino e Extensão",
    pieces: [
      { icon: <GraduationCap />, title: "Palestra", tone: "info", body: <Big v="48" s="certificados" /> },
      { icon: <BookOpen />, title: "Projeto", tone: "ok", body: <Line>Saúde mental no campus</Line> },
      { icon: <Mic />, title: "Palestrante", tone: "violet", body: <Line>Profa. Helena · <b>confirmada</b></Line> },
      { icon: <Users />, title: "Inscrições", tone: "ok", body: <><Big v="63" s="de 80 vagas" /><Bar pct={79} /></> },
      { icon: <ClipboardCheck />, title: "Lista de presença", tone: "gold", body: <Pill>Assinada</Pill> },
      { icon: <Award />, title: "Certificado", tone: "gold", body: <File tag="PDF" name="Minicurso de TCC" color="#c9971f" /> },
      { icon: <CalendarDays />, title: "Minicurso", tone: "info", body: <DateRow d="30" m="NOV" t="Escrita científica" /> },
      { icon: <Timer />, title: "Horas complementares", tone: "rose", body: <Big v="20h" s="por aluno" /> },
    ],
  },
];

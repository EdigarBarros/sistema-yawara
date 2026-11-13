import { FileArchive, FileImage, FileSpreadsheet, FileText, FileVideo, Link2, Presentation, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileType {
  icon: LucideIcon;
  /** Cor do tipo (a mesma nos dois temas; o fundo é a própria cor bem transparente). */
  color: string;
  label: string;
}

const PDF: FileType = { icon: FileText, color: "#e5534b", label: "PDF" };
const WORD: FileType = { icon: FileText, color: "#4b8bf5", label: "Documento de texto" };
const SHEET: FileType = { icon: FileSpreadsheet, color: "#2fb67c", label: "Planilha" };
const SLIDES: FileType = { icon: Presentation, color: "#f08a3c", label: "Apresentação" };
const IMAGE: FileType = { icon: FileImage, color: "#a77bf3", label: "Imagem" };
const VIDEO: FileType = { icon: FileVideo, color: "#e0679f", label: "Vídeo" };
const ARCHIVE: FileType = { icon: FileArchive, color: "#c9a227", label: "Arquivo compactado" };
const LINK: FileType = { icon: Link2, color: "#3fb6d3", label: "Link externo" };
const OTHER: FileType = { icon: FileText, color: "#8b95b5", label: "Arquivo" };

const BY_EXTENSION: Record<string, FileType> = {
  pdf: PDF,
  doc: WORD, docx: WORD, odt: WORD, rtf: WORD, txt: WORD, md: WORD,
  xls: SHEET, xlsx: SHEET, ods: SHEET, csv: SHEET,
  ppt: SLIDES, pptx: SLIDES, odp: SLIDES,
  png: IMAGE, jpg: IMAGE, jpeg: IMAGE, webp: IMAGE, gif: IMAGE, svg: IMAGE, heic: IMAGE,
  mp4: VIDEO, mov: VIDEO, webm: VIDEO, avi: VIDEO,
  zip: ARCHIVE, rar: ARCHIVE, "7z": ARCHIVE,
};

export function fileTypeOf(name: string | undefined, isLink = false): FileType {
  if (isLink) return LINK;
  const ext = name?.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXTENSION[ext] ?? OTHER;
}

/** Ícone colorido do tipo de arquivo (PDF, Word, planilha, imagem, link…). Sem arquivo, mostra um ícone neutro. */
export function FileTypeIcon({ name, isLink, size = 40, className }: { name?: string; isLink?: boolean; size?: number; className?: string }) {
  const type = name || isLink ? fileTypeOf(name, isLink) : OTHER;
  const Icon = type.icon;
  return (
    <span
      role="img"
      aria-label={type.label}
      title={type.label}
      className={cn("grid shrink-0 place-items-center rounded-lg", className)}
      style={{ width: size, height: size, color: type.color, background: `${type.color}1f` }}
    >
      <Icon style={{ width: size * 0.48, height: size * 0.48 }} strokeWidth={2} aria-hidden />
    </span>
  );
}

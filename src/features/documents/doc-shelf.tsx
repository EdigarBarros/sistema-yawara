"use client";

import type { InstitutionalDocument } from "@/types";
import { AREA_COLORS } from "@/components/layout/nav";
import { DOCUMENT_STATUS } from "@/lib/labels";
import { fileExtension, formatRelative } from "@/lib/format";
import { useCountUp } from "@/hooks/use-count-up";
import { DemoTag, StatusBadge } from "@/components/shared/badges";
import { fileTypeOf } from "@/components/shared/file-type-icon";
import { ShowcaseCard } from "@/components/shared/showcase";

const DOC_COLOR = AREA_COLORS["/documentos"] ?? "#3fcf8e";

/** Pilha de folhas: uma folha a mais por versão (até 4), a da frente mostra o tipo do arquivo. */
export function DocStack({ doc, size = "md" }: { doc: InstitutionalDocument; size?: "sm" | "md" }) {
  const file = doc.versions.at(-1)?.file;
  const isLink = !!file?.url;
  const type = fileTypeOf(file?.name, isLink);
  const color = type.color;
  const Icon = type.icon;
  const ext = isLink ? "LINK" : file ? fileExtension(file.name).slice(0, 4) : "—";
  const behind = Math.min(3, Math.max(0, doc.versions.length - 1));
  const dims = size === "sm" ? "h-[52px] w-[40px]" : "h-[96px] w-[74px]";
  return (
    <span className={`doc-stack block shrink-0 ${dims}`} aria-hidden>
      {Array.from({ length: behind }, (_, k) => behind - k).map((i) => (
        <span key={i} className="sheet border border-line bg-surface-3" style={{ "--i": i } as React.CSSProperties} />
      ))}
      <span className="sheet front grid overflow-hidden border border-line-strong bg-[linear-gradient(160deg,#ffffff,#e9eefc)] shadow-[0_10px_24px_-12px_rgba(3,15,69,0.6)]" style={{ "--i": 0 } as React.CSSProperties}>
        <span className="absolute inset-x-0 top-0 h-[22%]" style={{ background: color }} />
        <span className="absolute top-[30%] right-0 left-0 grid place-items-center">
          <Icon className={size === "sm" ? "size-4" : "size-7"} style={{ color }} strokeWidth={1.8} />
        </span>
        <span className={`absolute right-0 bottom-[8%] left-0 text-center font-mono font-bold ${size === "sm" ? "text-[9px]" : "text-[13px]"}`} style={{ color }}>
          {ext}
        </span>
      </span>
    </span>
  );
}

/** Cartão da estante de documentos. */
export function DocShelfCard({ doc, categoryName }: { doc: InstitutionalDocument; categoryName: string }) {
  return (
    <ShowcaseCard href={`/documentos/${doc.id}`} color={DOC_COLOR} label={`Documento ${doc.name}`} className={doc.status === "archived" ? "opacity-75" : undefined}>
      <span className="flex items-start gap-4">
        <span className="pt-2 pr-3">
          <DocStack doc={doc} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge meta={DOCUMENT_STATUS[doc.status]} />
            {doc.sample && <DemoTag />}
          </span>
          <span className="mt-2 line-clamp-2 block font-display text-[18px] leading-tight font-bold">{doc.name}</span>
          <span className="mt-1 line-clamp-2 block text-[12.5px] text-fg-muted">{doc.description}</span>
        </span>
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 pt-4 text-[12px] text-fg-subtle">
        <span className="truncate">{categoryName}</span>
        <span className="tnum shrink-0 font-mono">
          v{doc.versions.length} · {formatRelative(doc.updatedAt)}
        </span>
      </span>
    </ShowcaseCard>
  );
}

/** Número que conta até o valor (contagens das categorias). */
export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value, 700)}</>;
}

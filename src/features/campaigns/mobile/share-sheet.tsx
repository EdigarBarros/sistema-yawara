"use client";

import { useState } from "react";
import { Copy, Download, ImageIcon, MessageCircle } from "lucide-react";
import type { Campaign, NumberSlot } from "@/types";
import { downloadBlob } from "@/lib/export/common";
import { notifyError, notifySuccess } from "@/lib/notify";
import { whatsappLink } from "@/lib/whatsapp";
import { Dialog, BigSheetContent } from "@/components/ui/dialog";
import { renderPng } from "../export";
import { freeNumbersText } from "../share-text";
import { BigButton, bigButtonClasses } from "./ui";

interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  slots: NumberSlot[];
}

/** "Mandar no WhatsApp": a imagem da tabela ou a lista dos números livres, sem dados de compradores. */
export function ShareSheet({ open, onOpenChange, campaign, slots }: ShareSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ShareSheetBody campaign={campaign} slots={slots} />}
    </Dialog>
  );
}

function ShareSheetBody({ campaign, slots }: { campaign: Campaign; slots: NumberSlot[] }) {
  const [busy, setBusy] = useState(false);
  const text = freeNumbersText(campaign, slots);
  const free = slots.filter((s) => s.status === "available").length;

  const shareImage = async () => {
    setBusy(true);
    try {
      const { blob, fileName } = await renderPng({ campaign, slots, scope: "all" });
      const file = new File([blob], fileName, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: campaign.name });
        } catch (e) {
          // Fechar a janela de compartilhar não é erro.
          if ((e as Error).name !== "AbortError") throw e;
        }
      } else {
        downloadBlob(blob, fileName);
        notifySuccess("Imagem salva", "Agora é só abrir o WhatsApp e enviar a imagem que foi baixada.");
      }
    } catch (e) {
      notifyError(e, "Não foi possível gerar a imagem. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess("Texto copiado", "Cole na conversa ou no grupo do WhatsApp.");
    } catch {
      notifyError(null, "Não foi possível copiar. Use o botão do WhatsApp.");
    }
  };

  return (
    <BigSheetContent title="Mandar no WhatsApp" description="Nada aqui mostra quem comprou: só os números.">
      <div className="space-y-6">
        <section className="anim-rise rounded-[22px] border border-line bg-sunken p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-[14px] bg-gold text-gold-ink">
              <ImageIcon className="size-[22px]" aria-hidden />
            </span>
            <span>
              <strong className="block text-[16px] font-semibold">Imagem da tabela</strong>
              <span className="block text-[13px] text-fg-muted">Todos os números, com cores: livre, reservado, vendido.</span>
            </span>
          </div>
          <BigButton onClick={shareImage} loading={busy}>
            {busy ? "Gerando imagem…" : (
              <>
                <Download /> Gerar e enviar imagem
              </>
            )}
          </BigButton>
        </section>

        <section className="anim-rise rounded-[22px] border border-line bg-sunken p-4" style={{ animationDelay: "80ms" }}>
          <div className="mb-3 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-[14px] bg-[#25d366] text-[#052e16]">
              <MessageCircle className="size-[22px]" aria-hidden />
            </span>
            <span>
              <strong className="block text-[16px] font-semibold">Lista dos números livres</strong>
              <span className="block text-[13px] text-fg-muted">{free === 1 ? "1 número livre" : `${free} números livres`}, em texto para colar no grupo.</span>
            </span>
          </div>
          <pre className="mb-3 max-h-40 overflow-y-auto rounded-2xl border border-line bg-surface p-3.5 font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">{text}</pre>
          <div className="flex flex-col gap-2.5">
            <a href={whatsappLink(text)} target="_blank" rel="noreferrer" className={bigButtonClasses("whatsapp")}>
              <MessageCircle /> Abrir no WhatsApp
            </a>
            <BigButton tone="secondary" onClick={copy}>
              <Copy /> Copiar texto
            </BigButton>
          </div>
        </section>
      </div>
    </BigSheetContent>
  );
}

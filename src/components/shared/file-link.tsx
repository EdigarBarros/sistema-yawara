"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { isSafeLink, makeLinkFile, suggestedLinkName } from "@/lib/file-links";

const LINK_HINT = "Cole o link de compartilhamento (Google Drive, OneDrive…). Quem controla o acesso ao arquivo é o serviço onde ele está: compartilhe só com quem deve ver.";

/**
 * Informar um arquivo por link (implantação gratuita, sem Cloud Storage).
 * Devolve um File do tipo "text/uri-list" — os formulários continuam iguais.
 */
export function LinkPicker({ onChange, hint, submitLabel = "Usar este link" }: { onChange: (file: File) => void; hint?: string; submitLabel?: string }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  const submit = () => {
    if (!isSafeLink(url)) {
      setError("Informe um link válido, começando com https://.");
      return;
    }
    setError(undefined);
    onChange(makeLinkFile(name || suggestedLinkName(url), url));
  };

  return (
    <div className="grid gap-3 rounded-lg border border-dashed border-line-strong bg-sunken p-3">
      <Field label="Link do arquivo" error={error} hint={hint ?? LINK_HINT}>
        <Input
          type="url"
          inputMode="url"
          placeholder="https://drive.google.com/…"
          value={url}
          icon={<Link2 />}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </Field>
      <Field label="Nome do arquivo" optional>
        <Input placeholder={suggestedLinkName(url) || "Ex.: Comprovante Pix 12-10"} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <Button type="button" size="sm" onClick={submit} disabled={!url.trim()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Janela para anexar um arquivo por link (substitui o seletor de arquivos nos botões "Anexar"). */
export function AttachLinkDialog({
  open,
  onOpenChange,
  title,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onSubmit: (file: File) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={title} description="Os arquivos ficam no seu serviço de armazenamento; a Central guarda o nome e o link." size="sm">
          <LinkPicker
            submitLabel="Anexar link"
            onChange={(file) => {
              onSubmit(file);
              onOpenChange(false);
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { FileImage, FileSpreadsheet, FileText, Lock } from "lucide-react";
import type { Campaign, NumberSlot } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useDirectory } from "@/hooks/use-data";
import { canSeeAllBuyers } from "@/lib/policies";
import { notifyError, notifySuccess } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceCards } from "@/components/ui/form";
import { exportCsv, exportPdf, exportPng, filterSlots, SCOPE_LABELS, type ExportAudience, type ExportFormat, type ExportScope } from "./export";
import { CampaignNotice } from "./notice";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: Campaign;
  slots: NumberSlot[];
  initialFormat?: ExportFormat;
}

export function ExportDialog(props: ExportDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ExportDialogBody {...props} />}
    </Dialog>
  );
}

/** Montado a cada abertura: as opções sempre começam pelos valores padrão. */
function ExportDialogBody({ onOpenChange, campaign, slots, initialFormat = "pdf" }: ExportDialogProps) {
  const access = useAccess();
  const dir = useDirectory();
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [scope, setScope] = useState<ExportScope>("all");
  const [audience, setAudience] = useState<ExportAudience>("public");
  const [busy, setBusy] = useState(false);
  const internalAllowed = !!access.ctx && access.can("campaigns.export") && canSeeAllBuyers(access.ctx, campaign);

  const effectiveAudience: ExportAudience = format === "png" || !internalAllowed ? "public" : audience;
  const count = filterSlots(slots, scope).length;

  const run = async () => {
    setBusy(true);
    try {
      const ctx = { campaign, slots, scope, audience: effectiveAudience, memberName: dir.memberName, generatedBy: access.user?.name ?? "—" };
      if (effectiveAudience === "internal") {
        // Registro na auditoria ANTES de gerar e entregar o arquivo (fechar a aba logo após o download não
        // perde o registro). Melhor esforço: nunca lança erro nem impede a exportação. Sem dados pessoais no resumo.
        await services.audit
          .recordExport({
            module: "campaigns",
            resourceType: "campaign",
            resourceId: campaign.id,
            summary: `${format.toUpperCase()} interno com dados dos compradores (${SCOPE_LABELS[scope].toLowerCase()}, ${count} número(s)) da campanha ${campaign.code}`,
            personalData: true,
          })
          .catch(() => undefined);
      }
      const n = format === "csv" ? exportCsv(ctx) : format === "pdf" ? await exportPdf(ctx) : await exportPng(ctx);
      notifySuccess(
        `Arquivo ${format.toUpperCase()} gerado`,
        `${n} número(s) · ${effectiveAudience === "public" ? "sem dados pessoais" : "com dados dos compradores"}. Verifique a pasta de downloads.`,
      );
      onOpenChange(false);
    } catch (e) {
      notifyError(e, isDemoMode ? "Não foi possível gerar o arquivo neste navegador." : "Não foi possível gerar o arquivo. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent
        size="lg"
        title="Exportar campanha"
        description={
          isDemoMode
            ? "O arquivo é gerado neste navegador, a partir dos dados de demonstração."
            : "O arquivo é gerado no navegador a partir dos dados registrados que o seu perfil pode ver."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={run} loading={busy} disabled={count === 0}>
              Gerar {format.toUpperCase()} ({count})
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <section>
            <p className="mb-2 text-[13px] font-medium">Formato</p>
            <ChoiceCards
              name="format"
              columns={3}
              value={format}
              onChange={setFormat}
              options={[
                { value: "pdf", label: "PDF", description: "Grade ou relatório para imprimir.", icon: <FileText className="size-3.5 text-fg-subtle" /> },
                { value: "csv", label: "CSV / Excel", description: "Planilha com um número por linha.", icon: <FileSpreadsheet className="size-3.5 text-fg-subtle" /> },
                { value: "png", label: "Imagem da grade", description: "Para divulgar nas redes.", icon: <FileImage className="size-3.5 text-fg-subtle" /> },
              ]}
            />
          </section>
          <section>
            <p className="mb-2 text-[13px] font-medium">Quais números</p>
            <ChoiceCards
              name="scope"
              value={scope}
              onChange={setScope}
              options={(Object.keys(SCOPE_LABELS) as ExportScope[]).map((s) => ({
                value: s,
                label: SCOPE_LABELS[s],
                description: `${filterSlots(slots, s).length} número(s)`,
              }))}
            />
          </section>
          {format !== "png" && (
            <section>
              <p className="mb-2 text-[13px] font-medium">Conteúdo</p>
              <ChoiceCards
                name="audience"
                value={effectiveAudience}
                onChange={setAudience}
                options={[
                  { value: "public", label: "Divulgação", description: "Apenas números e situação. Sem nomes ou contatos." },
                  {
                    value: "internal",
                    label: "Relatório interno",
                    description: internalAllowed ? "Inclui compradores, contatos e responsáveis." : "Seu perfil não pode exportar dados pessoais.",
                    icon: !internalAllowed ? <Lock className="size-3.5 text-fg-subtle" /> : undefined,
                    disabled: !internalAllowed,
                  },
                ]}
              />
            </section>
          )}
          {format === "png" && (
            <CampaignNotice
              demo="A imagem é sempre a versão de divulgação: nunca mostra dados pessoais dos compradores."
              live="A imagem é sempre a versão de divulgação: nunca mostra dados pessoais dos compradores."
            />
          )}
          {format !== "png" && effectiveAudience === "internal" && (
            <CampaignNotice live="Relatório interno com dados pessoais: a exportação fica registrada na auditoria. Não compartilhe fora da diretoria autorizada." />
          )}
        </div>
      </DialogContent>
  );
}

"use client";

import { useState } from "react";
import type { Campaign, CampaignAccess } from "@/types";
import { services } from "@/services";
import { useAction } from "@/hooks/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Segmented, Textarea } from "@/components/ui/form";
import { errorMessage } from "@/lib/notify";
import { CampaignAccessConfig } from "./access-config";
import { RelatedEventField } from "./event-field";
import { CampaignNotice } from "./notice";

/** Edita dados gerais e acesso. Quantidade e valor não mudam depois das vendas. */
interface CampaignEditDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: Campaign;
  initialTab?: "dados" | "acesso";
}

export function CampaignEditDialog(props: CampaignEditDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <CampaignEditBody {...props} />}
    </Dialog>
  );
}

function CampaignEditBody({ onOpenChange, campaign, initialTab = "dados" }: CampaignEditDialogProps) {
  const [tab, setTab] = useState<"dados" | "acesso">(initialTab);
  const [form, setForm] = useState({
    name: campaign.name,
    prize: campaign.prize,
    description: campaign.description,
    notes: campaign.notes ?? "",
    startDate: campaign.startDate ?? "",
    endDate: campaign.endDate ?? "",
    drawDate: campaign.drawDate ?? "",
    eventId: campaign.eventId ?? "",
  });
  const [access, setAccess] = useState<CampaignAccess>(campaign.access);
  const [error, setError] = useState<string>();

  const save = useAction(
    () =>
      services.campaigns.update(campaign.id, {
        ...form,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        drawDate: form.drawDate || undefined,
        eventId: form.eventId || undefined,
        access,
      }),
    { success: "Campanha atualizada", silentError: true },
  );

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <DialogContent
        size="lg"
        modal
        title="Editar campanha"
        description={`${campaign.code} · quantidade e valor não podem ser alterados depois de criada.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={save.pending}
              onClick={async () => {
                setError(undefined);
                try {
                  await save.run();
                  onOpenChange(false);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Salvar alterações
            </Button>
          </>
        }
      >
        <Segmented
          ariaLabel="Seção"
          value={tab}
          onChange={setTab}
          className="mb-5"
          options={[
            { value: "dados", label: "Dados gerais" },
            { value: "acesso", label: "Acesso e permissões" },
          ]}
        />
        {tab === "dados" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Prêmio" required className="sm:col-span-2">
              <Input value={form.prize} onChange={set("prize")} />
            </Field>
            <Field label="Descrição" optional className="sm:col-span-2">
              <Textarea rows={3} value={form.description} onChange={set("description")} />
            </Field>
            <Field label="Início" optional>
              <Input type="date" value={form.startDate} onChange={set("startDate")} />
            </Field>
            <Field label="Encerramento" optional>
              <Input type="date" value={form.endDate} onChange={set("endDate")} />
            </Field>
            <Field label="Sorteio" optional>
              <Input type="date" value={form.drawDate} onChange={set("drawDate")} />
            </Field>
            <Field label="Observações" optional className="sm:col-span-2">
              <Textarea rows={2} value={form.notes} onChange={set("notes")} />
            </Field>
            <RelatedEventField className="sm:col-span-2" value={form.eventId} onChange={(eventId) => setForm((f) => ({ ...f, eventId }))} />
          </div>
        ) : (
          <div className="space-y-4">
            <CampaignAccessConfig value={access} onChange={setAccess} />
            <CampaignNotice
              demo="A alteração fica registrada no histórico. Permissões simuladas: o controle real será feito pelo backend."
              live="A alteração fica registrada no histórico e na auditoria e vale imediatamente: quem sair do público deixa de ver a campanha (ou os dados dos compradores) na hora."
            />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}
      </DialogContent>
  );
}

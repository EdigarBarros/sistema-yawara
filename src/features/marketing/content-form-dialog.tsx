"use client";

import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import type { Channel, ContentItem, ContentType } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useCampaigns, useEvents } from "@/hooks/use-data";
import { CHANNEL_LABELS, CONTENT_TYPE_LABELS } from "@/lib/labels";
import { requiredText } from "@/lib/validation";
import { liveRegister } from "@/lib/forms";
import { errorMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MemberSelect } from "@/components/shared/pickers";

const schema = z.object({
  title: requiredText("o nome do conteúdo", 3),
  type: z.enum(["arte", "video", "reels", "story", "carrossel", "texto", "outro"]),
  responsibleId: z.string().min(1, "Escolha o responsável."),
  publishDate: z.string().optional(),
  channels: z.array(z.string()).min(1, "Escolha pelo menos um canal."),
  campaignId: z.string().optional(),
  eventId: z.string().optional(),
  briefing: requiredText("o briefing", 10),
  notes: z.string().trim().max(500).optional(),
  links: z.array(
    z.object({
      label: z.string().trim(),
      url: z.string().trim().refine((v) => !v || /^https?:\/\//i.test(v), "O link deve começar com http:// ou https://"),
    }),
  ),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item?: ContentItem;
  onSaved?: (c: ContentItem) => void;
}

export function ContentFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ContentFormBody {...props} />}
    </Dialog>
  );
}

function ContentFormBody({ onOpenChange, item, onSaved }: Props) {
  const access = useAccess();
  const { data: campaigns } = useCampaigns();
  const { data: events } = useEvents(access.canModule("events"));
  const [serverError, setServerError] = useState<string>();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: item
      ? {
          title: item.title,
          type: item.type,
          responsibleId: item.responsibleId,
          publishDate: item.publishDate ?? "",
          channels: item.channels,
          campaignId: item.campaignId ?? "",
          eventId: item.eventId ?? "",
          briefing: item.briefing,
          notes: item.notes ?? "",
          links: item.links,
        }
      : { title: "", type: "arte", responsibleId: access.user?.id ?? "", publishDate: "", channels: ["instagram_feed"], campaignId: "", eventId: "", briefing: "", notes: "", links: [] },
  });
  const register = liveRegister(form);
  const { control, handleSubmit, formState } = form;
  const links = useFieldArray({ control, name: "links" });

  const save = useAction(
    (v: Values) => {
      const input = {
        ...v,
        type: v.type as ContentType,
        channels: v.channels as Channel[],
        publishDate: v.publishDate || undefined,
        campaignId: v.campaignId || undefined,
        eventId: v.eventId || undefined,
        links: v.links.filter((l) => l.url),
      };
      return item ? services.marketing.update(item.id, input) : services.marketing.create(input);
    },
    { success: item ? "Conteúdo atualizado" : "Conteúdo criado na etapa Briefing", silentError: true },
  );

  const onSubmit = handleSubmit(async (v) => {
    setServerError(undefined);
    try {
      const saved = await save.run(v);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  return (
    <DialogContent
      size="lg"
      modal
      title={item ? "Editar conteúdo" : "Novo conteúdo"}
      description={item ? item.code : "Nenhuma publicação é feita automaticamente nas redes."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={save.pending}>
            {item ? "Salvar alterações" : "Criar conteúdo"}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2" error={formState.errors.title?.message}>
            <Input placeholder="Ex.: Arte principal da Calourada" {...register("title")} />
          </Field>
          <Field label="Tipo de conteúdo" required>
            <Select {...register("type")}>
              {Object.entries(CONTENT_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsável" required error={formState.errors.responsibleId?.message}>
            <Controller control={control} name="responsibleId" render={({ field }) => <MemberSelect value={field.value} onChange={field.onChange} />} />
          </Field>
          <Field label="Publicação prevista" optional>
            <Input type="date" {...register("publishDate")} />
          </Field>
          <Field label="Campanha associada" optional>
            <Select {...register("campaignId")}>
              <option value="">Nenhuma</option>
              {campaigns?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Evento relacionado" optional className="sm:col-span-2">
            <Select {...register("eventId")}>
              <option value="">Nenhum</option>
              {events?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium">
            Canais de divulgação <span className="text-gold-fg">*</span>
          </p>
          <Controller
            control={control}
            name="channels"
            render={({ field }) => (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Canais">
                {(Object.keys(CHANNEL_LABELS) as Channel[]).map((ch) => {
                  const on = field.value.includes(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      aria-pressed={on}
                      onClick={() => field.onChange(on ? field.value.filter((c) => c !== ch) : [...field.value, ch])}
                      className={cn("h-8 rounded-lg border px-3 text-[12.5px] font-medium", on ? "border-gold/60 bg-gold/10 text-fg" : "border-line text-fg-muted hover:border-line-strong")}
                    >
                      {on ? "✓ " : ""}
                      {CHANNEL_LABELS[ch]}
                    </button>
                  );
                })}
              </div>
            )}
          />
          {formState.errors.channels && <p className="mt-1.5 text-xs font-medium text-danger">{formState.errors.channels.message}</p>}
        </div>

        <Field label="Briefing" required hint="Objetivo, público, mensagem principal e referências." error={formState.errors.briefing?.message}>
          <Textarea rows={4} {...register("briefing")} />
        </Field>
        <Field label="Observações" optional>
          <Textarea rows={2} {...register("notes")} />
        </Field>

        <div>
          <p className="mb-2 text-[13px] font-medium">Links (pasta de arquivos, roteiro, referências)</p>
          <ul className="space-y-2">
            {links.fields.map((f, i) => (
              <li key={f.id} className="flex gap-2">
                <Input placeholder="Descrição" aria-label={`Descrição do link ${i + 1}`} {...register(`links.${i}.label`)} className="sm:w-48" />
                <Input placeholder="https://" aria-label={`Endereço do link ${i + 1}`} aria-invalid={!!formState.errors.links?.[i]?.url} {...register(`links.${i}.url`)} />
                <Button size="icon" variant="ghost" aria-label={`Remover link ${i + 1}`} onClick={() => links.remove(i)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {formState.errors.links && <p className="mt-1.5 text-xs font-medium text-danger">Verifique os links: devem começar com http:// ou https://</p>}
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => links.append({ label: "", url: "" })}>
            <Plus /> Adicionar link
          </Button>
        </div>
        {serverError && (
          <p role="alert" className="rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {serverError}
          </p>
        )}
      </form>
    </DialogContent>
  );
}

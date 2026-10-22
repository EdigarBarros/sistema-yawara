"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, get, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock, Fingerprint, SlidersHorizontal, UserRound } from "lucide-react";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { formatDate, formatMoney, parseMoney } from "@/lib/format";
import { padNumber } from "@/lib/raffle";
import { cn } from "@/lib/utils";
import { emptyAudience } from "@/lib/permissions";
import { audienceError } from "@/lib/validation";
import { liveRegister } from "@/lib/forms";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Panel, DetailList } from "@/components/shared/page";
import { Stepper } from "@/components/shared/stepper";
import { CAMPAIGN_ADVANCED_FIELDS, CAMPAIGN_STEPS, campaignSchema, type CampaignFormValues } from "./schemas";
import { CampaignAccessConfig, CampaignAccessSummary } from "./access-config";
import { RelatedEventField, useRelatedEventName } from "./event-field";

export function CampaignWizard() {
  const router = useRouter();
  const access = useAccess();
  const [step, setStep] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const create = useAction((v: CampaignFormValues) =>
    services.campaigns.create({
      name: v.name,
      description: v.description,
      prize: v.prize,
      notes: v.notes,
      quantity: Number(v.quantity),
      unitPrice: parseMoney(v.unitPrice)!,
      startDate: v.startDate || undefined,
      endDate: v.endDate || undefined,
      drawDate: v.drawDate || undefined,
      access: v.access,
      eventId: v.eventId || undefined,
    }),
  );

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    mode: "onTouched",
    defaultValues: {
      kind: "raffle",
      name: "",
      description: "",
      prize: "",
      notes: "",
      quantity: "",
      unitPrice: "",
      startDate: "",
      endDate: "",
      drawDate: "",
      access: { view: emptyAudience("all"), sell: emptyAudience("directors_advisors"), buyerData: emptyAudience("board") },
      eventId: "",
    },
  });
  const { control, formState, trigger, handleSubmit } = form;
  const register = liveRegister(form);
  const errors = formState.errors;
  const values = useWatch({ control }) as CampaignFormValues;
  const eventName = useRelatedEventName(values.eventId || undefined);

  const quantity = /^\d+$/.test(values.quantity) ? Number(values.quantity) : 0;
  const price = parseMoney(values.unitPrice ?? "") ?? 0;

  const next = async () => {
    const ok = await trigger(CAMPAIGN_STEPS[step].fields, { shouldFocus: true });
    if (!ok) {
      // Erro escondido em "Opções avançadas": abre a seção para a pessoa ver o que corrigir.
      if (CAMPAIGN_ADVANCED_FIELDS.some((f) => get(form.formState.errors, f))) setAdvancedOpen(true);
      return;
    }
    // Regras entre datas validadas já nesta etapa (o esquema só as verifica no envio final).
    const { startDate, endDate, drawDate } = form.getValues();
    if (startDate && endDate && endDate < startDate) {
      setAdvancedOpen(true);
      form.setError("endDate", { type: "custom", message: "O encerramento não pode ser antes do início." }, { shouldFocus: true });
      return;
    }
    if (drawDate && ((startDate && drawDate < startDate) || (endDate && drawDate < endDate))) {
      form.setError("drawDate", { type: "custom", message: "O sorteio deve ser no dia do encerramento ou depois." }, { shouldFocus: true });
      return;
    }
    setStep((s) => Math.min(s + 1, CAMPAIGN_STEPS.length - 1));
  };

  const onSubmit = handleSubmit(async (v) => {
    try {
      const created = await create.run(v);
      if (created) {
        router.push(`/campanhas/${created.id}`);
      }
    } catch {
      // erro já exibido
    }
  }, () => {
    // Algum campo inválido em etapa anterior: volta para ela.
    const firstStep = CAMPAIGN_STEPS.findIndex((s) => s.fields.some((f) => get(errors, f)));
    if (firstStep >= 0) setStep(firstStep);
    if (CAMPAIGN_ADVANCED_FIELDS.some((f) => get(errors, f))) setAdvancedOpen(true);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-[84px] lg:self-start">
        <Stepper steps={CAMPAIGN_STEPS} current={step} onSelect={setStep} />
      </div>

      <div className="min-w-0 space-y-5">
        {step === 0 && (
          <Panel title="Como é a rifa?" description="Só o essencial. O resto já vem preenchido e pode ser mudado em “Opções avançadas”.">
            <div className="space-y-5">
              <Field label="Nome da rifa" required error={errors.name?.message}>
                <Input className="h-12 text-[16px]" placeholder="Ex.: Rifa do Kit Interatlética" {...register("name")} />
              </Field>
              <Field label="Qual é o prêmio?" required error={errors.prize?.message}>
                <Input className="h-12 text-[16px]" placeholder="Ex.: Kit com camisa, short e caneca" {...register("prize")} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Quantos números?" required hint="De 2 a 10.000." error={errors.quantity?.message}>
                  <Input className="h-12 text-[16px]" inputMode="numeric" placeholder="300" {...register("quantity")} />
                </Field>
                <Field label="Valor de cada (R$)" required hint="Ex.: 10,00" error={errors.unitPrice?.message}>
                  <Input className="h-12 text-[16px]" inputMode="decimal" placeholder="10,00" {...register("unitPrice")} />
                </Field>
              </div>
              {quantity >= 2 && (
                <div className="anim-rise flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-gold/30 bg-gold/[0.07] px-4 py-3 text-[14px] text-fg-muted">
                  <span>
                    Números de <b className="tnum font-mono text-fg">{padNumber(1, quantity)}</b> a <b className="tnum font-mono text-fg">{padNumber(quantity, quantity)}</b>
                  </span>
                  {price > 0 && (
                    <span>
                      Se vender tudo: <b className="tnum font-mono text-fg">{formatMoney(quantity * price)}</b>
                    </span>
                  )}
                </div>
              )}
              <Field label="Data do sorteio" optional hint="A Central não faz o sorteio; a data serve para organizar e divulgar." error={errors.drawDate?.message}>
                <Input className="h-12 text-[16px]" type="date" {...register("drawDate")} />
              </Field>

              <div className="rounded-xl border border-line">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  aria-expanded={advancedOpen}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <SlidersHorizontal className="size-5 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">Opções avançadas</span>
                    <span className="block text-[12.5px] text-fg-muted">Descrição, datas de venda, evento e quem pode ver e vender</span>
                  </span>
                  <ChevronDown className={cn("size-5 shrink-0 text-fg-subtle transition-transform duration-300", advancedOpen && "rotate-180")} aria-hidden />
                </button>
                {advancedOpen && (
                  <div className="anim-rise space-y-5 border-t border-line px-4 py-5">
                    <Field label="Descrição" optional hint="Para que serve a arrecadação." error={errors.description?.message}>
                      <Textarea rows={3} {...register("description")} />
                    </Field>
                    <Field label="Observações" optional error={errors.notes?.message}>
                      <Textarea rows={2} placeholder="Regras internas, combinações com o fornecedor do prêmio…" {...register("notes")} />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Início das vendas" optional error={errors.startDate?.message}>
                        <Input type="date" {...register("startDate")} />
                      </Field>
                      <Field label="Fim das vendas" optional error={errors.endDate?.message}>
                        <Input type="date" {...register("endDate")} />
                      </Field>
                    </div>
                    <Controller
                      control={control}
                      name="eventId"
                      render={({ field }) => <RelatedEventField value={field.value ?? ""} onChange={field.onChange} />}
                    />
                    <div>
                      <p className="mb-1 text-[14px] font-semibold">Quem pode ver e vender</p>
                      <p className="mb-3 text-[12.5px] text-fg-muted">
                        Padrão: todos veem a rifa, diretores e assessores vendem e só a diretoria vê nome e telefone de quem comprou.
                      </p>
                      <Controller
                        control={control}
                        name="access"
                        render={({ field }) => (
                          <CampaignAccessConfig
                            value={field.value}
                            onChange={field.onChange}
                            errors={{
                              view: audienceError(errors.access?.view),
                              sell: audienceError(errors.access?.sell),
                              buyerData: audienceError(errors.access?.buyerData),
                            }}
                          />
                        )}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        )}

        {step === 1 && (
          <>
            <Panel title="Confere?" description="Se algo estiver errado, toque em Voltar.">
              <DetailList
                items={[
                  { label: "Nome", value: values.name },
                  { label: "Prêmio", value: values.prize },
                  { label: "Quantidade", value: quantity ? `${quantity} números (${padNumber(1, quantity)} a ${padNumber(quantity, quantity)})` : "—" },
                  { label: "Valor de cada número", value: price ? formatMoney(price) : "—" },
                  { label: "Se vender tudo", value: quantity && price ? formatMoney(quantity * price) : "—" },
                  { label: "Início", value: values.startDate ? formatDate(values.startDate) : "Não definido" },
                  { label: "Encerramento", value: values.endDate ? formatDate(values.endDate) : "Não definido" },
                  { label: "Sorteio", value: values.drawDate ? formatDate(values.drawDate) : "Não definido" },
                  { label: "Evento relacionado", value: values.eventId ? (eventName ?? "Evento selecionado") : "Nenhum" },
                ]}
              />
            </Panel>
            <Panel title="Quem pode ver e vender" description="Pode mudar depois, em “Mais opções” da rifa.">
              <CampaignAccessSummary access={values.access} creatorId={access.user?.id} />
            </Panel>
            <Panel title="Preenchido automaticamente" description="Você não precisa informar estes dados.">
              <ul className="grid gap-3 text-[13px] sm:grid-cols-3">
                <li className="flex items-start gap-2.5">
                  <UserRound className="mt-0.5 size-4 text-fg-subtle" />
                  <span>
                    <span className="block text-fg-subtle">Criador</span>
                    <b className="font-semibold">{access.user?.name}</b>
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Fingerprint className="mt-0.5 size-4 text-fg-subtle" />
                  <span>
                    <span className="block text-fg-subtle">Identificador</span>
                    <b className="font-semibold">Gerado ao salvar (RIFA-…)</b>
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Clock className="mt-0.5 size-4 text-fg-subtle" />
                  <span>
                    <span className="block text-fg-subtle">Data e horário</span>
                    <b className="font-semibold">Registrados ao salvar</b>
                  </span>
                </li>
              </ul>
            </Panel>
          </>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => (step === 0 ? router.push("/campanhas") : setStep((s) => s - 1))}>
            <ArrowLeft /> {step === 0 ? "Cancelar" : "Voltar"}
          </Button>
          {/* Chaves distintas: sem elas o React reaproveita o botão, que vira "submit" durante o clique em Continuar e cria a rifa antes da revisão. */}
          {step < CAMPAIGN_STEPS.length - 1 ? (
            <Button key="next" variant="primary" onClick={next}>
              Continuar <ArrowRight />
            </Button>
          ) : (
            <Button key="submit" type="submit" variant="primary" loading={create.pending}>
              <Check /> Criar rifa
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

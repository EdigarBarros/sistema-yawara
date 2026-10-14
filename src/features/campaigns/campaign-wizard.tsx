"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, get, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Clock, Dices, Fingerprint, Ticket, UserRound } from "lucide-react";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { formatDate, formatMoney, parseMoney } from "@/lib/format";
import { padNumber } from "@/lib/raffle";
import { emptyAudience } from "@/lib/permissions";
import { audienceError } from "@/lib/validation";
import { liveRegister } from "@/lib/forms";
import { Button } from "@/components/ui/button";
import { ChoiceCards, Field, Input, Textarea } from "@/components/ui/form";
import { Panel, DetailList } from "@/components/shared/page";
import { Stepper } from "@/components/shared/stepper";
import { DemoNotice } from "@/components/shared/states";
import { CAMPAIGN_STEPS, campaignSchema, type CampaignFormValues } from "./schemas";
import { CampaignAccessConfig, CampaignAccessSummary } from "./access-config";

export function CampaignWizard() {
  const router = useRouter();
  const access = useAccess();
  const [step, setStep] = useState(0);
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
    },
  });
  const { control, formState, trigger, handleSubmit } = form;
  const register = liveRegister(form);
  const errors = formState.errors;
  const values = useWatch({ control }) as CampaignFormValues;

  const quantity = /^\d+$/.test(values.quantity) ? Number(values.quantity) : 0;
  const price = parseMoney(values.unitPrice ?? "") ?? 0;

  const next = async () => {
    const ok = await trigger(CAMPAIGN_STEPS[step].fields, { shouldFocus: true });
    if (!ok) return;
    if (step === 1) {
      // Regras entre datas validadas já nesta etapa (o esquema só as verifica no envio final).
      const { startDate, endDate, drawDate } = form.getValues();
      if (startDate && endDate && endDate < startDate) {
        form.setError("endDate", { type: "custom", message: "O encerramento não pode ser antes do início." }, { shouldFocus: true });
        return;
      }
      if (drawDate && ((startDate && drawDate < startDate) || (endDate && drawDate < endDate))) {
        form.setError("drawDate", { type: "custom", message: "O sorteio deve ser no dia do encerramento ou depois." }, { shouldFocus: true });
        return;
      }
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
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-[84px] lg:self-start">
        <Stepper steps={CAMPAIGN_STEPS} current={step} onSelect={setStep} />
      </div>

      <div className="min-w-0 space-y-5">
        {step === 0 && (
          <Panel title="Sobre a campanha" description="Informações que aparecem na página da rifa.">
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-[13px] font-medium">Modalidade</p>
                <ChoiceCards
                  name="kind"
                  value="raffle"
                  onChange={() => undefined}
                  options={[
                    { value: "raffle", label: "Rifa", description: "Números numerados com prêmio sorteado.", icon: <Ticket className="size-3.5 text-fg-subtle" /> },
                    { value: "bingo", label: "Bingo", description: "Disponível em uma próxima etapa.", icon: <Dices className="size-3.5 text-fg-subtle" />, disabled: true },
                  ]}
                />
              </div>
              <Field label="Nome da campanha" required error={errors.name?.message}>
                <Input placeholder="Ex.: Rifa do Kit Interatlética" {...register("name")} />
              </Field>
              <Field label="Prêmio ou item oferecido" required error={errors.prize?.message}>
                <Input placeholder="Ex.: Kit com camisa, short e caneca" {...register("prize")} />
              </Field>
              <Field label="Descrição" optional hint="Para que serve a arrecadação." error={errors.description?.message}>
                <Textarea rows={3} {...register("description")} />
              </Field>
              <Field label="Observações" optional error={errors.notes?.message}>
                <Textarea rows={2} placeholder="Regras internas, combinações com o fornecedor do prêmio…" {...register("notes")} />
              </Field>
            </div>
          </Panel>
        )}

        {step === 1 && (
          <Panel title="Números e datas" description="A grade é gerada automaticamente a partir da quantidade.">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Quantidade de números" required hint="Número inteiro entre 2 e 10.000." error={errors.quantity?.message}>
                  <Input inputMode="numeric" placeholder="300" {...register("quantity")} />
                </Field>
                <Field label="Valor de cada número (R$)" required hint="Ex.: 10,00" error={errors.unitPrice?.message}>
                  <Input inputMode="decimal" placeholder="10,00" {...register("unitPrice")} />
                </Field>
              </div>
              {quantity >= 2 && (
                <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-line bg-sunken px-4 py-3 text-[13px] text-fg-muted">
                  <span>
                    Numeração: <b className="tnum font-mono text-fg">{padNumber(1, quantity)}</b> a <b className="tnum font-mono text-fg">{padNumber(quantity, quantity)}</b>
                  </span>
                  {price > 0 && (
                    <span>
                      Arrecadação máxima: <b className="tnum font-mono text-fg">{formatMoney(quantity * price)}</b>
                    </span>
                  )}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Início das vendas" optional error={errors.startDate?.message}>
                  <Input type="date" {...register("startDate")} />
                </Field>
                <Field label="Encerramento" optional error={errors.endDate?.message}>
                  <Input type="date" {...register("endDate")} />
                </Field>
                <Field label="Data do sorteio" optional error={errors.drawDate?.message}>
                  <Input type="date" {...register("drawDate")} />
                </Field>
              </div>
              <DemoNotice>A Central não realiza sorteios. A data serve apenas para organização e divulgação.</DemoNotice>
            </div>
          </Panel>
        )}

        {step === 2 && (
          <Panel title="Acesso e permissões" description="Defina, uma pergunta por vez, quem vê a campanha, quem registra vendas e quem consulta dados pessoais.">
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
            <DemoNotice className="mt-4">
              Nesta etapa as permissões são simuladas no navegador para demonstrar a experiência. O controle real será aplicado pelo backend.
            </DemoNotice>
          </Panel>
        )}

        {step === 3 && (
          <>
            <Panel title="Resumo da campanha">
              <DetailList
                items={[
                  { label: "Modalidade", value: "Rifa" },
                  { label: "Nome", value: values.name },
                  { label: "Prêmio", value: values.prize },
                  { label: "Quantidade", value: quantity ? `${quantity} números (${padNumber(1, quantity)} a ${padNumber(quantity, quantity)})` : "—" },
                  { label: "Valor unitário", value: price ? formatMoney(price) : "—" },
                  { label: "Arrecadação máxima", value: quantity && price ? formatMoney(quantity * price) : "—" },
                  { label: "Início", value: values.startDate ? formatDate(values.startDate) : "Não definido" },
                  { label: "Encerramento", value: values.endDate ? formatDate(values.endDate) : "Não definido" },
                  { label: "Sorteio", value: values.drawDate ? formatDate(values.drawDate) : "Não definido" },
                ]}
              />
            </Panel>
            <Panel title="Acesso e permissões" description="Confira quem terá acesso antes de salvar.">
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

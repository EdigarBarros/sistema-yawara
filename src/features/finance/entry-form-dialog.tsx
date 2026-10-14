"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { EntryType, FinanceEntry, PaymentMethod } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useCampaigns, useDirectory, useEvents, useFinanceCategories } from "@/hooks/use-data";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { centsToInput, parseMoney } from "@/lib/format";
import { dateField, moneyField, requiredText } from "@/lib/validation";
import { liveRegister } from "@/lib/forms";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceCards, Field, Input, Segmented, Select, Textarea } from "@/components/ui/form";
import { FilePicker, MemberSelect } from "@/components/shared/pickers";

const schema = z.object({
  type: z.enum(["income", "expense"]),
  description: requiredText("a descrição", 3),
  categoryId: z.string().min(1, "Escolha a categoria."),
  amount: moneyField("o valor"),
  date: dateField("a data"),
  responsibleId: z.string().min(1, "Escolha o responsável."),
  departmentId: z.string().min(1, "Escolha o departamento."),
  eventId: z.string().optional(),
  campaignId: z.string().optional(),
  paymentMethod: z.string().optional(),
  status: z.enum(["pending", "settled"]),
  notes: z.string().trim().max(500).optional(),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  type?: EntryType;
  entry?: FinanceEntry;
  onSaved?: (e: FinanceEntry) => void;
}

export function EntryFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <EntryFormBody {...props} />}
    </Dialog>
  );
}

function EntryFormBody({ onOpenChange, type = "income", entry, onSaved }: Props) {
  const access = useAccess();
  const dir = useDirectory();
  const { data: categories } = useFinanceCategories();
  const { data: events } = useEvents(access.canModule("events"));
  const { data: campaigns } = useCampaigns();
  const [receipt, setReceipt] = useState<File | null>(null);
  const [serverError, setServerError] = useState<string>();
  const canSettle = access.can("finance.approve");

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: entry
      ? {
          type: entry.type,
          description: entry.description,
          categoryId: entry.categoryId,
          amount: centsToInput(entry.amount),
          date: entry.date,
          responsibleId: entry.responsibleId,
          departmentId: entry.departmentId,
          eventId: entry.eventId ?? "",
          campaignId: entry.campaignId ?? "",
          paymentMethod: entry.paymentMethod ?? "",
          status: entry.status === "settled" ? "settled" : "pending",
          notes: entry.notes ?? "",
        }
      : {
          type,
          description: "",
          categoryId: "",
          amount: "",
          date: new Date().toISOString().slice(0, 10),
          responsibleId: access.user?.id ?? "",
          departmentId: access.role?.departmentId ?? "",
          eventId: "",
          campaignId: "",
          paymentMethod: "",
          status: "pending",
          notes: "",
        },
  });
  const register = liveRegister(form);
  const { control, handleSubmit, formState, setValue } = form;
  const currentType = useWatch({ control, name: "type" });

  const save = useAction(
    (v: Values) => {
      const input = {
        type: v.type,
        description: v.description,
        categoryId: v.categoryId,
        amount: parseMoney(v.amount)!,
        date: v.date,
        responsibleId: v.responsibleId,
        departmentId: v.departmentId,
        eventId: v.eventId || undefined,
        campaignId: v.campaignId || undefined,
        paymentMethod: (v.paymentMethod || undefined) as PaymentMethod | undefined,
        status: v.status,
        notes: v.notes,
      };
      if (entry) {
        const { status: _status, ...rest } = input;
        void _status;
        return services.finance.update(entry.id, rest);
      }
      return services.finance.create(input, receipt ?? undefined);
    },
    { success: entry ? "Lançamento atualizado" : (e) => `${e.type === "income" ? "Receita" : "Despesa"} registrada (${e.code})`, silentError: true },
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

  const label = currentType === "income" ? "receita" : "despesa";

  return (
    <DialogContent
      size="lg"
      modal
      title={entry ? `Editar lançamento ${entry.code}` : `Nova ${label}`}
      description="Valores de demonstração. Nenhuma transação real é processada."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={save.pending}>
            {entry ? "Salvar alterações" : `Registrar ${label}`}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {!entry && (
          <Segmented
            ariaLabel="Tipo de movimentação"
            value={currentType}
            onChange={(v) => {
              setValue("type", v);
              setValue("categoryId", "");
            }}
            options={[
              { value: "income", label: "Receita" },
              { value: "expense", label: "Despesa" },
            ]}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Descrição" required className="sm:col-span-2" error={formState.errors.description?.message}>
            <Input placeholder={currentType === "income" ? "Ex.: Ingressos do 1º lote" : "Ex.: Locação do espaço"} {...register("description")} />
          </Field>
          <Field label="Categoria" required error={formState.errors.categoryId?.message}>
            <Select {...register("categoryId")}>
              <option value="">Selecione…</option>
              {categories
                ?.filter((c) => c.type === currentType)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Valor (R$)" required error={formState.errors.amount?.message}>
            <Input inputMode="decimal" placeholder="0,00" {...register("amount")} />
          </Field>
          <Field label="Data" required error={formState.errors.date?.message}>
            <Input type="date" {...register("date")} />
          </Field>
          <Field label="Forma de pagamento" optional>
            <Select {...register("paymentMethod")}>
              <option value="">Não definida</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsável" required error={formState.errors.responsibleId?.message}>
            <Controller control={control} name="responsibleId" render={({ field }) => <MemberSelect value={field.value} onChange={field.onChange} />} />
          </Field>
          <Field label="Departamento" required>
            <Select {...register("departmentId")}>
              {dir.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Evento associado" optional>
            <Select {...register("eventId")}>
              <option value="">Nenhum</option>
              {events?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
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
        </div>

        {!entry && (
          <div>
            <p className="mb-2 text-[13px] font-medium">Situação</p>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <ChoiceCards
                  name="entry-status"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: "pending", label: currentType === "income" ? "A receber" : "A pagar", description: "Ainda não confirmado." },
                    {
                      value: "settled",
                      label: currentType === "income" ? "Recebido" : "Pago",
                      description: canSettle ? "Valor já conferido." : "Somente quem confirma lançamentos.",
                      disabled: !canSettle,
                    },
                  ]}
                />
              )}
            />
          </div>
        )}

        {!entry && (
          <div>
            <p className="mb-2 text-[13px] font-medium">
              Comprovante <span className="text-xs font-normal text-fg-subtle">(opcional)</span>
            </p>
            <FilePicker file={receipt} onChange={setReceipt} accept="image/*,application/pdf" hint="Fica apenas neste navegador nesta etapa." />
          </div>
        )}

        <Field label="Observações" optional>
          <Textarea rows={2} {...register("notes")} />
        </Field>
        {serverError && (
          <p role="alert" className="rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {serverError}
          </p>
        )}
      </form>
    </DialogContent>
  );
}

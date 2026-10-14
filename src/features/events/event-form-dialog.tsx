"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AtleticaEvent, EventType } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { centsToInput, parseMoney } from "@/lib/format";
import { emptyAudience } from "@/lib/permissions";
import { liveRegister } from "@/lib/forms";
import { audienceError } from "@/lib/validation";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MemberMultiPicker } from "@/components/shared/pickers";
import { AudiencePicker, AudienceSummary } from "@/components/shared/audience";
import { eventSchema, type EventFormValues } from "./schemas";

export const EVENT_SCOPES = ["department", "board", "all", "roles", "people"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  event?: AtleticaEvent;
}

/** Criação e edição de evento, em seções curtas. */
export function EventFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <EventFormBody {...props} />}
    </Dialog>
  );
}

function EventFormBody({ onOpenChange, event }: Props) {
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const [serverError, setServerError] = useState<string>();
  const editing = !!event;

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: event
      ? {
          name: event.name,
          type: event.type,
          description: event.description,
          objective: event.objective,
          date: event.date,
          time: event.time,
          location: event.location,
          departmentId: event.departmentId,
          responsibleIds: event.responsibleIds,
          notes: event.notes ?? "",
          budget: centsToInput(event.budget),
          access: event.access,
        }
      : {
          name: "",
          type: "festa",
          description: "",
          objective: "",
          date: "",
          time: "",
          location: "",
          departmentId: access.role?.departmentId ?? "",
          responsibleIds: access.user ? [access.user.id] : [],
          notes: "",
          budget: "",
          access: emptyAudience("all"),
        },
  });
  const register = liveRegister(form);
  const { control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const save = useAction(
    (v: EventFormValues) => {
      const input = { ...v, budget: v.budget ? (parseMoney(v.budget) ?? undefined) : undefined };
      return editing ? services.events.update(event!.id, input) : services.events.create(input);
    },
    { success: editing ? "Evento atualizado" : "Evento criado", silentError: true },
  );

  const onSubmit = handleSubmit(async (v) => {
    setServerError(undefined);
    try {
      const saved = await save.run(v);
      onOpenChange(false);
      if (!editing && saved) router.push(`/eventos/${saved.id}`);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  const accessValue = useWatch({ control, name: "access" });
  const departmentId = useWatch({ control, name: "departmentId" });
  const responsibleIds = useWatch({ control, name: "responsibleIds" });

  return (
    <DialogContent
      size="lg"
      modal
      title={editing ? "Editar evento" : "Novo evento"}
      description={editing ? event!.code : "Criador e data de criação são registrados automaticamente."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={save.pending}>
            {editing ? "Salvar alterações" : "Criar evento"}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <Section title="Informações">
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Nome do evento" required error={errors.name?.message}>
              <Input placeholder="Ex.: Calourada 2026.2" {...register("name")} />
            </Field>
            <Field label="Tipo" required>
              <Select {...register("type")}>
                {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Descrição" optional error={errors.description?.message}>
            <Textarea rows={3} {...register("description")} />
          </Field>
          <Field label="Objetivo" optional error={errors.objective?.message}>
            <Textarea rows={2} placeholder="O que se espera alcançar com o evento" {...register("objective")} />
          </Field>
        </Section>

        <Section title="Quando e onde">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Data" required error={errors.date?.message}>
              <Input type="date" {...register("date")} />
            </Field>
            <Field label="Horário" required error={errors.time?.message}>
              <Input type="time" {...register("time")} />
            </Field>
            <Field label="Orçamento previsto (R$)" optional error={errors.budget?.message}>
              <Input inputMode="decimal" placeholder="0,00" {...register("budget")} />
            </Field>
          </div>
          <Field label="Local" required error={errors.location?.message}>
            <Input {...register("location")} />
          </Field>
        </Section>

        <Section title="Responsáveis">
          <Field label="Departamento responsável" required error={errors.departmentId?.message}>
            <Select {...register("departmentId")}>
              {dir.departments
                .filter((d) => d.active)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Responsáveis designados" required error={errors.responsibleIds?.message}>
            <Controller
              control={control}
              name="responsibleIds"
              render={({ field }) => <MemberMultiPicker value={field.value} onChange={field.onChange} invalid={!!errors.responsibleIds} />}
            />
          </Field>
        </Section>

        <Section title="Visibilidade e acesso">
          <Controller
            control={control}
            name="access"
            render={({ field }) => (
              <AudiencePicker
                name="event-access"
                value={field.value}
                onChange={field.onChange}
                scopes={[...EVENT_SCOPES]}
                departmentId={departmentId}
                error={audienceError(errors.access)}
              />
            )}
          />
          <div className="rounded-lg border border-line bg-sunken px-4 py-3">
            <AudienceSummary audience={accessValue} departmentId={departmentId} alwaysIncluded={responsibleIds} />
            <p className="mt-2 text-[12px] text-fg-subtle">Os responsáveis designados sempre têm acesso.</p>
          </div>
        </Section>

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

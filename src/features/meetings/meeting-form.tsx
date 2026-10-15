"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, get, useFieldArray, useForm, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, UserPlus } from "lucide-react";
import type { Meeting, MeetingMode } from "@/types";
import { services } from "@/services";
import { useAction } from "@/hooks/use-action";
import { useAccess } from "@/hooks/use-access";
import { useDocuments, useEvents } from "@/hooks/use-data";
import { MEETING_MODE_LABELS } from "@/lib/labels";
import { emptyAudience } from "@/lib/permissions";
import { audienceError, audienceSchema, dateField, requiredText, timeField } from "@/lib/validation";
import { liveRegister } from "@/lib/forms";
import { formatDate } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel } from "@/components/shared/page";
import { Stepper } from "@/components/shared/stepper";
import { MemberMultiPicker, MemberSelect } from "@/components/shared/pickers";
import { AudiencePicker, AudienceSummary } from "@/components/shared/audience";
import { DemoNotice } from "@/components/shared/states";

/** Limites dos convidados externos (os mesmos do servidor). */
const MAX_GUESTS = 50;
const MAX_GUEST_LENGTH = 80;

const schema = z
  .object({
    title: requiredText("o título", 3),
    date: dateField("a data"),
    startTime: timeField("o horário de início"),
    endTime: z.string().optional(),
    mode: z.enum(["presencial", "online", "hibrida"]),
    location: requiredText("o local ou link", 2),
    participantIds: z.array(z.string()).min(1, "Selecione pelo menos um participante."),
    guests: z
      .array(
        z.object({
          value: z
            .string()
            .trim()
            .max(MAX_GUEST_LENGTH, `O nome pode ter no máximo ${MAX_GUEST_LENGTH} caracteres.`)
            .refine((v) => v === "" || v.length >= 2, "Informe o nome completo (mínimo de 2 caracteres)."),
        }),
      )
      .refine((list) => list.filter((g) => g.value.trim()).length <= MAX_GUESTS, `Informe no máximo ${MAX_GUESTS} convidados externos.`),
    eventId: z.string(),
    agenda: z.array(z.object({ value: z.string() })),
    summary: z.string().trim().max(4000),
    decisions: z.array(z.object({ value: z.string() })),
    actions: z.array(z.object({ id: z.string().optional(), description: z.string(), responsibleId: z.string().optional(), dueDate: z.string().optional() })),
    documentIds: z.array(z.string()),
    access: audienceSchema,
  })
  .superRefine((v, ctx) => {
    if (v.endTime && v.endTime <= v.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "O término deve ser depois do início." });
  });
type Values = z.infer<typeof schema>;

const STEPS: { key: string; title: string; description: string; fields: Path<Values>[] }[] = [
  { key: "dados", title: "Informações", description: "Título, data e local", fields: ["title", "date", "startTime", "endTime", "mode", "location", "eventId"] },
  { key: "participantes", title: "Participantes", description: "Quem participou", fields: ["participantIds", "guests"] },
  { key: "pauta", title: "Pauta e discussões", description: "Pauta, resumo e decisões", fields: ["summary"] },
  { key: "encaminhamentos", title: "Encaminhamentos", description: "Responsáveis e documentos", fields: [] },
  { key: "visibilidade", title: "Visibilidade", description: "Quem pode consultar", fields: ["access"] },
];

function toValues(m?: Meeting): Values {
  if (!m)
    return {
      title: "",
      date: "",
      startTime: "",
      endTime: "",
      mode: "presencial",
      location: "",
      participantIds: [],
      guests: [],
      eventId: "",
      agenda: [{ value: "" }],
      summary: "",
      decisions: [{ value: "" }],
      actions: [],
      documentIds: [],
      access: emptyAudience("board"),
    };
  return {
    title: m.title,
    date: m.date,
    startTime: m.startTime,
    endTime: m.endTime ?? "",
    mode: m.mode,
    location: m.location,
    participantIds: m.participantIds,
    guests: (m.guests ?? []).map((value) => ({ value })),
    eventId: m.eventId ?? "",
    agenda: m.agenda.length ? m.agenda.map((value) => ({ value })) : [{ value: "" }],
    summary: m.summary,
    decisions: m.decisions.length ? m.decisions.map((value) => ({ value })) : [{ value: "" }],
    actions: m.actions.map((a) => ({ id: a.id, description: a.description, responsibleId: a.responsibleId ?? "", dueDate: a.dueDate ?? "" })),
    documentIds: m.documentIds,
    access: m.access,
  };
}

function ListEditor({ label, placeholder, fields, onAdd, onRemove, register, name, addLabel = "Adicionar item", addIcon = <Plus />, allowEmpty = false, maxItems, itemErrors, maxLength }: {
  label: string;
  placeholder: string;
  fields: { id: string }[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  register: ReturnType<typeof liveRegister<Values>>;
  name: "agenda" | "decisions" | "guests";
  addLabel?: string;
  addIcon?: React.ReactNode;
  /** Permite remover todos os itens (lista opcional). */
  allowEmpty?: boolean;
  maxItems?: number;
  itemErrors?: (string | undefined)[];
  maxLength?: number;
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium">{label}</p>
      <ol className="space-y-2">
        {fields.map((f, i) => (
          <li key={f.id}>
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right font-mono text-[12px] text-fg-subtle">{i + 1}.</span>
              <Input
                placeholder={placeholder}
                aria-label={`${label} ${i + 1}`}
                aria-invalid={itemErrors?.[i] ? true : undefined}
                maxLength={maxLength}
                {...register(`${name}.${i}.value` as Path<Values>)}
              />
              <Button size="icon-sm" variant="ghost" aria-label={`Remover item ${i + 1}`} onClick={() => onRemove(i)} disabled={!allowEmpty && fields.length === 1}>
                <Trash2 />
              </Button>
            </div>
            {itemErrors?.[i] && <p className="mt-1 ml-8 text-xs font-medium text-danger">{itemErrors[i]}</p>}
          </li>
        ))}
      </ol>
      <Button size="sm" variant="ghost" className="mt-2" onClick={onAdd} disabled={maxItems !== undefined && fields.length >= maxItems}>
        {addIcon} {addLabel}
      </Button>
    </div>
  );
}

/** Registro e edição de reunião em etapas. */
export function MeetingForm({ meeting }: { meeting?: Meeting }) {
  const router = useRouter();
  const access = useAccess();
  const [step, setStep] = useState(0);
  const { data: documents } = useDocuments();
  const canSeeEvents = access.canModule("events");
  const eventsQuery = useEvents(canSeeEvents);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(meeting) });
  const register = liveRegister(form);
  const { control, trigger, handleSubmit, formState } = form;
  const errors = formState.errors;
  const agenda = useFieldArray({ control, name: "agenda" });
  const decisions = useFieldArray({ control, name: "decisions" });
  const guests = useFieldArray({ control, name: "guests" });
  const actions = useFieldArray({ control, name: "actions" });
  const accessValue = useWatch({ control, name: "access" });
  const participants = useWatch({ control, name: "participantIds" });
  const selectedEventId = useWatch({ control, name: "eventId" });
  // Eventos que o perfil pode ver (cancelados só aparecem se já estiverem vinculados).
  const eventOptions = (eventsQuery.data ?? []).filter((e) => e.status !== "cancelled" || e.id === selectedEventId || e.id === meeting?.eventId).sort((a, b) => b.date.localeCompare(a.date));
  // O evento já vinculado continua como opção mesmo quando não aparece na lista (restrito ao perfil ou ainda carregando).
  const linkedEventHidden = !!meeting?.eventId && !eventOptions.some((e) => e.id === meeting.eventId);

  const save = useAction(
    (v: Values) => {
      const input = {
        title: v.title,
        date: v.date,
        startTime: v.startTime,
        endTime: v.endTime || undefined,
        mode: v.mode,
        location: v.location,
        participantIds: v.participantIds,
        guests: v.guests.map((g) => g.value.trim()).filter(Boolean),
        eventId: v.eventId || undefined,
        agenda: v.agenda.map((a) => a.value),
        summary: v.summary,
        decisions: v.decisions.map((d) => d.value),
        actions: v.actions.map((a) => ({ id: a.id, description: a.description, responsibleId: a.responsibleId || undefined, dueDate: a.dueDate || undefined })),
        documentIds: v.documentIds,
        access: v.access,
      };
      return meeting ? services.meetings.update(meeting.id, input) : services.meetings.create(input);
    },
    { success: meeting ? "Reunião atualizada" : "Reunião registrada como rascunho" },
  );

  const next = async () => {
    if (!(await trigger(STEPS[step].fields, { shouldFocus: true }))) return;
    // Regras entre campos validadas já na etapa (o esquema só as verifica no envio final).
    const { startTime, endTime } = form.getValues();
    if (step === 0 && endTime && endTime <= startTime) {
      form.setError("endTime", { type: "custom", message: "O término deve ser depois do início." }, { shouldFocus: true });
      return;
    }
    setStep((s) => s + 1);
  };
  const onSubmit = handleSubmit(
    async (v) => {
      const saved = await save.runSafe(v);
      if (saved) router.push(`/secretaria/${saved.id}`);
    },
    () => {
      const first = STEPS.findIndex((s) => s.fields.some((f) => get(errors, f)));
      if (first >= 0) setStep(first);
    },
  );

  const last = step === STEPS.length - 1;

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-[84px] lg:self-start">
        <Stepper steps={STEPS} current={step} onSelect={setStep} />
      </div>
      <div className="min-w-0 space-y-5">
        {step === 0 && (
          <Panel title="Informações da reunião">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Título" required className="sm:col-span-3" error={errors.title?.message}>
                <Input placeholder="Ex.: Reunião ordinária da diretoria — novembro" {...register("title")} />
              </Field>
              <Field label="Data" required error={errors.date?.message}>
                <Input type="date" {...register("date")} />
              </Field>
              <Field label="Início" required error={errors.startTime?.message}>
                <Input type="time" {...register("startTime")} />
              </Field>
              <Field label="Término" optional error={errors.endTime?.message}>
                <Input type="time" {...register("endTime")} />
              </Field>
              <Field label="Modalidade" required>
                <Select {...register("mode")}>
                  {(Object.keys(MEETING_MODE_LABELS) as MeetingMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MEETING_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Local ou link" required className="sm:col-span-2" error={errors.location?.message}>
                <Input placeholder="Sala da Atlética ou videochamada" {...register("location")} />
              </Field>
              <Field
                label="Evento relacionado"
                optional
                className="sm:col-span-3"
                error={errors.eventId?.message}
                hint={
                  !canSeeEvents
                    ? "Seu perfil não tem acesso aos eventos."
                    : eventsQuery.isError
                      ? "Não foi possível carregar os eventos. Tente novamente mais tarde."
                      : "Quando a reunião trata de um evento. Aparecem os eventos que o seu perfil pode ver."
                }
              >
                <Select {...register("eventId")}>
                  <option value="">{eventsQuery.isLoading ? "Carregando eventos…" : "Nenhum evento"}</option>
                  {linkedEventHidden && <option value={meeting!.eventId}>{eventsQuery.isLoading ? "Evento vinculado (carregando…)" : "Evento vinculado (não disponível para o seu perfil)"}</option>}
                  {eventOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {formatDate(e.date)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Panel>
        )}

        {step === 1 && (
          <>
            <Panel title="Participantes" description={isDemoMode ? "Escolha na lista de integrantes (fictícios)." : "Escolha entre os integrantes ativos da Central."}>
              <Controller
                control={control}
                name="participantIds"
                render={({ field }) => <MemberMultiPicker value={field.value} onChange={field.onChange} invalid={!!errors.participantIds} />}
              />
              {errors.participantIds && <p className="mt-1.5 text-xs font-medium text-danger">{errors.participantIds.message}</p>}
              <p className="mt-2 text-[12.5px] text-fg-muted">{participants.length} participante(s) selecionado(s).</p>
            </Panel>
            <Panel title="Convidados externos" description="Pessoas de fora da Central que participaram (ex.: palestrantes, representantes de outras entidades).">
              {guests.fields.length === 0 && <p className="mb-1 text-[13px] text-fg-subtle">Nenhum convidado externo.</p>}
              <ListEditor
                label="Nomes dos convidados"
                placeholder="Nome do convidado"
                name="guests"
                fields={guests.fields}
                onAdd={() => guests.append({ value: "" })}
                onRemove={guests.remove}
                register={register}
                addLabel="Adicionar convidado"
                addIcon={<UserPlus />}
                allowEmpty
                maxItems={MAX_GUESTS}
                maxLength={MAX_GUEST_LENGTH}
                itemErrors={guests.fields.map((_, i) => errors.guests?.[i]?.value?.message)}
              />
              {(errors.guests?.root?.message ?? errors.guests?.message) && <p className="mt-1.5 text-xs font-medium text-danger">{errors.guests?.root?.message ?? errors.guests?.message}</p>}
              <p className="mt-2 text-[12px] text-fg-subtle">
                Registre apenas o nome. Convidados não precisam ter conta na Central e não recebem acesso ao registro; outros dados pessoais não devem ser anotados aqui.
              </p>
            </Panel>
          </>
        )}

        {step === 2 && (
          <Panel title="Pauta e discussões" description="Para reuniões futuras, preencha só a pauta. Resumo e decisões entram depois.">
            <div className="space-y-6">
              <ListEditor label="Pauta" placeholder="Assunto da pauta" name="agenda" fields={agenda.fields} onAdd={() => agenda.append({ value: "" })} onRemove={agenda.remove} register={register} />
              <Field label="Resumo das discussões" optional hint="Obrigatório para enviar a ata para aprovação." error={errors.summary?.message}>
                <Textarea rows={6} {...register("summary")} />
              </Field>
              <ListEditor label="Decisões" placeholder="Decisão tomada" name="decisions" fields={decisions.fields} onAdd={() => decisions.append({ value: "" })} onRemove={decisions.remove} register={register} />
            </div>
          </Panel>
        )}

        {step === 3 && (
          <>
            <Panel title="Encaminhamentos" description="O que ficou de ser feito, por quem e até quando.">
              {actions.fields.length === 0 && <p className="text-[13px] text-fg-subtle">Nenhum encaminhamento.</p>}
              <ul className="space-y-3">
                {actions.fields.map((f, i) => (
                  <li key={f.id} className="grid gap-2 rounded-lg border border-line bg-sunken p-3 sm:grid-cols-[1fr_220px_150px_auto] sm:items-end">
                    <Field label="Encaminhamento">
                      <Input {...register(`actions.${i}.description`)} />
                    </Field>
                    <Field label="Responsável">
                      <Controller
                        control={control}
                        name={`actions.${i}.responsibleId`}
                        render={({ field }) => <MemberSelect value={field.value ?? ""} onChange={field.onChange} allowEmpty />}
                      />
                    </Field>
                    <Field label="Prazo">
                      <Input type="date" {...register(`actions.${i}.dueDate`)} />
                    </Field>
                    <Button size="icon" variant="ghost" aria-label={`Remover encaminhamento ${i + 1}`} onClick={() => actions.remove(i)}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => actions.append({ description: "", responsibleId: "", dueDate: "" })}>
                <Plus /> Adicionar encaminhamento
              </Button>
            </Panel>
            <Panel title="Documentos relacionados" description="Documentos da biblioteca que o seu perfil pode ver.">
              <Controller
                control={control}
                name="documentIds"
                render={({ field }) => (
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {(documents ?? [])
                      .filter((d) => d.status !== "archived")
                      .map((d) => (
                        <li key={d.id}>
                          <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-2">
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--gold)]"
                              checked={field.value.includes(d.id)}
                              onChange={(e) => field.onChange(e.target.checked ? [...field.value, d.id] : field.value.filter((x) => x !== d.id))}
                            />
                            <span className="truncate">{d.name}</span>
                            <span className="ml-auto shrink-0 text-[11.5px] text-fg-subtle">{formatDate(d.updatedAt)}</span>
                          </label>
                        </li>
                      ))}
                  </ul>
                )}
              />
            </Panel>
          </>
        )}

        {step === 4 && (
          <Panel title="Visibilidade" description="Quem poderá consultar o registro e a ata.">
            <Controller
              control={control}
              name="access"
              render={({ field }) => (
                <AudiencePicker name="meeting-access" value={field.value} onChange={field.onChange} scopes={["board", "all", "roles", "people"]} error={audienceError(errors.access)} />
              )}
            />
            <div className="mt-4 rounded-lg border border-line bg-sunken px-4 py-3">
              <AudienceSummary module="meetings" audience={accessValue} alwaysIncluded={participants} />
              <p className="mt-2 text-[12px] text-fg-subtle">Participantes com acesso à Secretaria também podem consultar.</p>
            </div>
            <DemoNotice className="mt-4">{meeting ? "As alterações ficam registradas no histórico." : "A reunião será salva como rascunho. Depois, envie a ata para aprovação."}</DemoNotice>
          </Panel>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))}>
            <ArrowLeft /> {step === 0 ? "Cancelar" : "Voltar"}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {meeting && !last && (
              <Button type="submit" loading={save.pending}>
                <Check /> Salvar agora
              </Button>
            )}
            {/* Chaves distintas: sem elas o React reaproveita o botão, que vira "submit" durante o clique em Continuar e envia o formulário antes da última etapa. */}
            {last ? (
              <Button key="submit" type="submit" variant="primary" loading={save.pending}>
                <Check /> {meeting ? "Salvar alterações" : "Registrar reunião"}
              </Button>
            ) : (
              <Button key="next" variant="primary" onClick={next}>
                Continuar <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

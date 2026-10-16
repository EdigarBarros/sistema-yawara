"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ActivityType, ExtensionProject } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useEvents } from "@/hooks/use-data";
import { ACTIVITY_TYPE_LABELS } from "@/lib/labels";
import { emptyAudience } from "@/lib/permissions";
import { audienceError, audienceSchema, dateField, requiredText } from "@/lib/validation";
import { liveRegister } from "@/lib/forms";
import { formatDate } from "@/lib/format";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MemberSelect } from "@/components/shared/pickers";
import { AudiencePicker } from "@/components/shared/audience";
import { FormAlert } from "@/components/shared/form-alert";

const schema = z.object({
  name: requiredText("o nome do projeto", 3),
  activityType: z.enum(["palestra", "workshop", "roda_conversa", "minicurso", "projeto_extensao", "grupo_estudos", "outro"]),
  description: z.string().trim().max(800),
  objective: z.string().trim().max(400),
  responsibleId: z.string().min(1, "Escolha o responsável."),
  date: dateField("a data"),
  time: z.string().optional(),
  location: requiredText("o local", 2),
  eventId: z.string().optional(),
  certificateHours: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && Number(v) <= 400), "Use um número inteiro de horas (até 400)."),
  access: audienceSchema,
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: ExtensionProject;
}

export function ProjectFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ProjectFormBody {...props} />}
    </Dialog>
  );
}

function ProjectFormBody({ onOpenChange, project }: Props) {
  const router = useRouter();
  const access = useAccess();
  const { data: events } = useEvents(access.canModule("events"));
  const [serverError, setServerError] = useState<string>();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: project
      ? {
          name: project.name,
          activityType: project.activityType,
          description: project.description,
          objective: project.objective,
          responsibleId: project.responsibleId,
          date: project.date,
          time: project.time ?? "",
          location: project.location,
          eventId: project.eventId ?? "",
          certificateHours: project.certificateHours?.toString() ?? "",
          access: project.access,
        }
      : {
          name: "",
          activityType: "palestra",
          description: "",
          objective: "",
          responsibleId: access.user?.id ?? "",
          date: "",
          time: "",
          location: "",
          eventId: "",
          certificateHours: "",
          access: emptyAudience("all"),
        },
  });
  const register = liveRegister(form);
  const { control, handleSubmit, formState } = form;

  const save = useAction(
    (v: Values) => {
      const input = {
        ...v,
        activityType: v.activityType as ActivityType,
        time: v.time || undefined,
        eventId: v.eventId || (project ? "" : undefined),
        certificateHours: v.certificateHours ? Number(v.certificateHours) : undefined,
      };
      return project ? services.extension.update(project.id, input) : services.extension.create(input);
    },
    { success: project ? "Projeto atualizado" : "Projeto criado", silentError: true },
  );

  const onSubmit = handleSubmit(async (v) => {
    setServerError(undefined);
    try {
      const saved = await save.run(v);
      onOpenChange(false);
      if (!project) router.push(`/extensao/${saved.id}`);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  return (
    <DialogContent
      size="lg"
      modal
      title={project ? "Editar projeto" : "Novo projeto"}
      description="Palestrantes, programação e presença são adicionados na página do projeto."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={save.pending}>
            {project ? "Salvar alterações" : "Criar projeto"}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required className="sm:col-span-2" error={formState.errors.name?.message}>
            <Input {...register("name")} />
          </Field>
          <Field label="Tipo de atividade" required>
            <Select {...register("activityType")}>
              {Object.entries(ACTIVITY_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsável" required error={formState.errors.responsibleId?.message}>
            <Controller control={control} name="responsibleId" render={({ field }) => <MemberSelect value={field.value} onChange={field.onChange} />} />
          </Field>
          <Field label="Descrição" optional className="sm:col-span-2">
            <Textarea rows={3} {...register("description")} />
          </Field>
          <Field label="Objetivo" optional className="sm:col-span-2">
            <Textarea rows={2} {...register("objective")} />
          </Field>
          <Field label="Data" required error={formState.errors.date?.message}>
            <Input type="date" {...register("date")} />
          </Field>
          <Field label="Horário" optional>
            <Input type="time" {...register("time")} />
          </Field>
          <Field label="Local" required className="sm:col-span-2" error={formState.errors.location?.message}>
            <Input {...register("location")} />
          </Field>
          <Field label="Vincular a um evento existente" optional hint="Evita cadastrar o mesmo evento duas vezes." className="sm:col-span-2">
            <Select {...register("eventId")}>
              <option value="">Sem vínculo</option>
              {events?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {formatDate(e.date)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Carga horária do certificado" optional hint="Em horas." error={formState.errors.certificateHours?.message}>
            <Input inputMode="numeric" {...register("certificateHours")} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Quem pode ver</p>
          <Controller
            control={control}
            name="access"
            render={({ field }) => (
              <AudiencePicker name="project-access" value={field.value} onChange={field.onChange} scopes={["board", "all", "roles", "people"]} error={audienceError(formState.errors.access)} />
            )}
          />
        </div>
        <FormAlert message={serverError} />
      </form>
    </DialogContent>
  );
}

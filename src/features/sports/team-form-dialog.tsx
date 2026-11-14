"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { SportCategory, SportTeam } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { SPORT_CATEGORY_LABELS } from "@/lib/labels";
import { emptyAudience } from "@/lib/permissions";
import { audienceError, audienceSchema, requiredText } from "@/lib/validation";
import { liveRegister } from "@/lib/forms";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MemberSelect } from "@/components/shared/pickers";
import { AudiencePicker } from "@/components/shared/audience";
import { FormAlert } from "@/components/shared/form-alert";
import { SportPicker } from "./sport-picker";

/** Nome sugerido quando a pessoa ainda não escreveu um (ex.: "Futsal Feminino"). */
function suggestedName(sport: string, category: SportCategory) {
  const s = sport.trim();
  return s ? `${s} ${SPORT_CATEGORY_LABELS[category]}` : "";
}

const schema = z.object({
  name: requiredText("o nome da modalidade", 3),
  sport: requiredText("o esporte", 2),
  category: z.enum(["feminino", "masculino", "misto"]),
  description: z.string().trim().max(800, "A descrição pode ter no máximo 800 caracteres."),
  coach: z.string().trim().max(120, "O nome pode ter no máximo 120 caracteres."),
  responsibleId: z.string().min(1, "Escolha o responsável."),
  access: audienceSchema,
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  team?: SportTeam;
}

export function TeamFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <TeamFormBody {...props} />}
    </Dialog>
  );
}

function TeamFormBody({ onOpenChange, team }: Props) {
  const router = useRouter();
  const access = useAccess();
  const [serverError, setServerError] = useState<string>();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: team
      ? { name: team.name, sport: team.sport, category: team.category, description: team.description, coach: team.coach ?? "", responsibleId: team.responsibleId, access: team.access }
      : { name: "", sport: "", category: "feminino", description: "", coach: "", responsibleId: access.user?.id ?? "", access: emptyAudience("all") },
  });
  const register = liveRegister(form);
  const { control, handleSubmit, formState, setValue, getValues } = form;

  // Preenche o nome com "Esporte Naipe" enquanto ele for o sugerido (ou estiver vazio).
  const sport = useWatch({ control, name: "sport" });
  const category = useWatch({ control, name: "category" });
  const lastSuggestion = useRef(team ? suggestedName(team.sport, team.category) : "");
  useEffect(() => {
    const current = getValues("name").trim();
    const next = suggestedName(sport, category);
    if (current === "" || current === lastSuggestion.current) setValue("name", next, { shouldValidate: formState.isSubmitted });
    lastSuggestion.current = next;
  }, [sport, category, getValues, setValue, formState.isSubmitted]);

  const save = useAction(
    (v: Values) => {
      const input = { ...v, coach: v.coach || undefined };
      return team ? services.sports.update(team.id, input) : services.sports.create(input);
    },
    { success: team ? "Modalidade atualizada" : "Modalidade criada", silentError: true },
  );

  const onSubmit = handleSubmit(async (v) => {
    setServerError(undefined);
    try {
      const saved = await save.run(v);
      onOpenChange(false);
      if (!team) router.push(`/esportes/${saved.id}`);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  return (
    <DialogContent
      size="lg"
      modal
      title={team ? "Editar modalidade" : "Nova modalidade"}
      description="Escolha o esporte e o naipe. Treinos, elenco e jogos ficam na página da modalidade."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={save.pending}>
            {team ? "Salvar alterações" : "Criar modalidade"}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Esporte" required className="sm:col-span-2" error={formState.errors.sport?.message}>
            <Controller control={control} name="sport" render={({ field }) => <SportPicker value={field.value} onChange={field.onChange} invalid={!!formState.errors.sport} />} />
          </Field>
          <Field label="Naipe" required>
            <Select {...register("category")}>
              {Object.entries(SPORT_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nome da modalidade" required hint="Ex.: Futsal Feminino" error={formState.errors.name?.message}>
            <Input {...register("name")} />
          </Field>
          <Field label="Responsável na Central" required error={formState.errors.responsibleId?.message}>
            <Controller control={control} name="responsibleId" render={({ field }) => <MemberSelect value={field.value} onChange={field.onChange} />} />
          </Field>
          <Field label="Técnico(a)" optional hint="Pode ser alguém de fora da Central." error={formState.errors.coach?.message}>
            <Input {...register("coach")} />
          </Field>
          <Field label="Descrição" optional className="sm:col-span-2" error={formState.errors.description?.message}>
            <Textarea rows={3} {...register("description")} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Quem pode ver</p>
          <Controller
            control={control}
            name="access"
            render={({ field }) => (
              <AudiencePicker name="team-access" value={field.value} onChange={field.onChange} scopes={["board", "all", "roles", "people"]} error={audienceError(formState.errors.access)} />
            )}
          />
        </div>
        <FormAlert message={serverError} />
      </form>
    </DialogContent>
  );
}

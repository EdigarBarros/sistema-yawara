"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, X } from "lucide-react";
import type { AtleticaEvent, EventTask, TaskStatus } from "@/types";
import { services } from "@/services";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { TASK_STATUS } from "@/lib/labels";
import { liveRegister } from "@/lib/forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MemberSelect } from "@/components/shared/pickers";
import { taskSchema, type TaskFormValues } from "./schemas";

/* -------------------------------- Duplicar -------------------------------- */

interface DuplicateProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  event: AtleticaEvent;
}

export function DuplicateEventDialog(props: DuplicateProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <DuplicateBody {...props} />}
    </Dialog>
  );
}

function DuplicateBody({ onOpenChange, event }: DuplicateProps) {
  const router = useRouter();
  const [name, setName] = useState(`${event.name} (cópia)`);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string>();
  const dup = useAction(() => services.events.duplicate(event.id, { name, date }), { success: "Evento duplicado", silentError: true });

  const copied = [
    `Descrição, objetivo, tipo, local e departamento`,
    `${event.responsibleIds.length} responsável(is) designado(s)`,
    `${event.schedule.length} item(ns) da programação`,
    `${event.tasks.length} tarefa(s), reiniciadas como “A fazer” e sem prazo`,
    `${event.suppliers.length} fornecedor(es) como “Orçamento”, sem valores`,
  ];
  const notCopied = ["Orçamento e lançamentos financeiros", "Vendas e dados de compradores", "Documentos, histórico e observações"];

  return (
    <DialogContent
      title="Duplicar evento"
      description="Cria um novo evento com a estrutura de planejamento deste."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={dup.pending}
            onClick={async () => {
              if (name.trim().length < 3) return setError("Informe o nome do novo evento.");
              if (!date) return setError("Informe a data do novo evento.");
              setError(undefined);
              try {
                const created = await dup.run();
                onOpenChange(false);
                if (created) router.push(`/eventos/${created.id}`);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Duplicar estrutura
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Nome do novo evento" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Data" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="eyebrow mb-2">Será copiado</p>
            <ul className="space-y-1.5 text-[13px]">
              {copied.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-ok" /> {c}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-2">Não será copiado</p>
            <ul className="space-y-1.5 text-[13px] text-fg-muted">
              {notCopied.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <X className="mt-0.5 size-4 shrink-0 text-danger" /> {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </DialogContent>
  );
}

/* --------------------------------- Tarefa --------------------------------- */

interface TaskProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  event: AtleticaEvent;
  task?: EventTask;
}

export function TaskDialog(props: TaskProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <TaskBody {...props} />}
    </Dialog>
  );
}

function TaskBody({ onOpenChange, event, task }: TaskProps) {
  const dir = useDirectory();
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: task
      ? { ...task, description: task.description ?? "", notes: task.notes ?? "", dueDate: task.dueDate ?? "", responsibleId: task.responsibleId ?? "" }
      : { title: "", description: "", responsibleId: "", departmentId: event.departmentId, dueDate: "", status: "todo", notes: "" },
  });
  const register = liveRegister(form);
  const { control, handleSubmit, formState } = form;
  const save = useAction(
    (v: TaskFormValues) => {
      const input = { ...v, responsibleId: v.responsibleId || undefined, dueDate: v.dueDate || undefined };
      return task ? services.events.updateTask(event.id, task.id, input) : services.events.addTask(event.id, input);
    },
    { success: task ? "Tarefa atualizada" : "Tarefa adicionada" },
  );

  return (
    <DialogContent
      title={task ? "Editar tarefa" : "Nova tarefa"}
      description={event.name}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={handleSubmit(async (v) => {
              const r = await save.runSafe(v);
              if (r) onOpenChange(false);
            })}
          >
            {task ? "Salvar" : "Adicionar tarefa"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da tarefa" required className="sm:col-span-2" error={formState.errors.title?.message}>
          <Input {...register("title")} />
        </Field>
        <Field label="Descrição" optional className="sm:col-span-2">
          <Textarea rows={2} {...register("description")} />
        </Field>
        <Field label="Responsável" optional>
          <Controller control={control} name="responsibleId" render={({ field }) => <MemberSelect value={field.value ?? ""} onChange={field.onChange} allowEmpty />} />
        </Field>
        <Field label="Departamento" required error={formState.errors.departmentId?.message}>
          <Select {...register("departmentId")}>
            {dir.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prazo" optional>
          <Input type="date" {...register("dueDate")} />
        </Field>
        <Field label="Situação" required>
          <Select {...register("status")}>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Observações" optional className="sm:col-span-2">
          <Textarea rows={2} {...register("notes")} />
        </Field>
      </div>
    </DialogContent>
  );
}

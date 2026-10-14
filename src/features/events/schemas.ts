import { z } from "zod";
import { audienceSchema, dateField, optionalMoneyField, requiredText, timeField } from "@/lib/validation";

export const eventSchema = z.object({
  name: requiredText("o nome do evento", 3),
  type: z.enum(["festa", "esportivo", "academico", "integracao", "arrecadacao", "projeto", "outro"]),
  description: z.string().trim().max(800, "Use no máximo 800 caracteres."),
  objective: z.string().trim().max(400, "Use no máximo 400 caracteres."),
  date: dateField("a data"),
  time: timeField("o horário"),
  location: requiredText("o local", 2),
  departmentId: z.string().min(1, "Escolha o departamento responsável."),
  responsibleIds: z.array(z.string()).min(1, "Designe pelo menos um responsável."),
  notes: z.string().trim().max(600).optional(),
  budget: optionalMoneyField,
  access: audienceSchema,
});

export type EventFormValues = z.infer<typeof eventSchema>;

export const taskSchema = z.object({
  title: requiredText("o nome da tarefa", 3),
  description: z.string().trim().max(400).optional(),
  responsibleId: z.string().optional(),
  departmentId: z.string().min(1, "Escolha o departamento."),
  dueDate: z.string().optional(),
  status: z.enum(["todo", "doing", "blocked", "done"]),
  notes: z.string().trim().max(400).optional(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;

import { z } from "zod";
import type { Path } from "react-hook-form";
import { audienceSchema, optionalContactField, integerField, moneyField, optionalDate, requiredText } from "@/lib/validation";

export const campaignSchema = z
  .object({
    kind: z.literal("raffle"),
    name: requiredText("o nome da campanha", 3).pipe(z.string().max(90, "Use no máximo 90 caracteres.")),
    description: z.string().trim().max(600, "Use no máximo 600 caracteres."),
    prize: requiredText("o prêmio ou item oferecido", 3),
    notes: z.string().trim().max(600, "Use no máximo 600 caracteres.").optional(),
    quantity: integerField("a quantidade de números", 2, 10000),
    unitPrice: moneyField("o valor de cada número"),
    startDate: optionalDate,
    endDate: optionalDate,
    drawDate: optionalDate,
    access: z.object({ view: audienceSchema, sell: audienceSchema, buyerData: audienceSchema }),
    /** Evento relacionado (opcional; "" = nenhum). */
    eventId: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "O encerramento não pode ser antes do início." });
    }
    if (v.startDate && v.drawDate && v.drawDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["drawDate"], message: "O sorteio não pode ser antes do início." });
    }
    if (v.endDate && v.drawDate && v.drawDate < v.endDate) {
      ctx.addIssue({ code: "custom", path: ["drawDate"], message: "O sorteio deve ser no dia do encerramento ou depois." });
    }
  });

export type CampaignFormValues = z.infer<typeof campaignSchema>;

/** Campos validados em cada etapa do formulário de nova rifa. */
/** Campos guardados em "Opções avançadas" (já vêm com um padrão sensato). */
export const CAMPAIGN_ADVANCED_FIELDS: Path<CampaignFormValues>[] = ["description", "notes", "eventId", "startDate", "endDate", "access.view", "access.sell", "access.buyerData"];

/** Criar rifa em 2 passos: o essencial e a conferência. */
export const CAMPAIGN_STEPS: { key: string; title: string; description: string; fields: Path<CampaignFormValues>[] }[] = [
  { key: "rifa", title: "Como é a rifa?", description: "Nome, prêmio, números e valor", fields: ["name", "prize", "quantity", "unitPrice", "drawDate", ...CAMPAIGN_ADVANCED_FIELDS] },
  { key: "revisao", title: "Confere?", description: "Revise antes de criar", fields: [] },
];

export const editSaleSchema = z.object({
  buyerName: requiredText("o nome do comprador", 2).optional(),
  // Vendas antigas podem estar sem contato: editar não obriga a preencher.
  buyerContact: optionalContactField.optional(),
  sellerId: z.string().min(1, "Escolha o responsável pela venda."),
  paymentMethod: z.enum(["pix", "cash", "card", "transfer", "other", ""]).optional(),
  notes: z.string().trim().max(300, "Use no máximo 300 caracteres.").optional(),
});

export type EditSaleFormValues = z.infer<typeof editSaleSchema>;

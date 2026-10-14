import { z } from "zod";
import type { Path } from "react-hook-form";
import { audienceSchema, contactField, integerField, moneyField, optionalDate, requiredText } from "@/lib/validation";

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
export const CAMPAIGN_STEPS: { key: string; title: string; description: string; fields: Path<CampaignFormValues>[] }[] = [
  { key: "dados", title: "Campanha", description: "Nome, prêmio e descrição", fields: ["name", "prize", "description", "notes"] },
  { key: "numeros", title: "Números e datas", description: "Quantidade, valor e prazos", fields: ["quantity", "unitPrice", "startDate", "endDate", "drawDate"] },
  { key: "acesso", title: "Acesso e permissões", description: "Quem vê, vende e consulta dados", fields: ["access.view", "access.sell", "access.buyerData"] },
  { key: "revisao", title: "Revisão", description: "Confira antes de criar", fields: [] },
];

export const saleSchema = z
  .object({
    buyerName: requiredText("o nome do comprador", 2),
    buyerContact: contactField,
    sellerId: z.string().min(1, "Escolha o responsável pela venda."),
    status: z.enum(["reserved", "pending", "paid"]),
    paymentMethod: z.enum(["pix", "cash", "card", "transfer", "other", ""]).optional(),
    notes: z.string().trim().max(300, "Use no máximo 300 caracteres.").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "paid" && !v.paymentMethod) {
      ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Informe a forma de pagamento recebida." });
    }
  });

export type SaleFormValues = z.infer<typeof saleSchema>;

export const editSaleSchema = z.object({
  buyerName: requiredText("o nome do comprador", 2).optional(),
  buyerContact: contactField.optional(),
  sellerId: z.string().min(1, "Escolha o responsável pela venda."),
  paymentMethod: z.enum(["pix", "cash", "card", "transfer", "other", ""]).optional(),
  notes: z.string().trim().max(300, "Use no máximo 300 caracteres.").optional(),
});

export type EditSaleFormValues = z.infer<typeof editSaleSchema>;

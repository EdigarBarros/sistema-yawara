/**
 * Mensagens prontas da rifa para mandar no WhatsApp. Nunca incluem dados de
 * outros compradores: a lista de números livres é pública, e a cobrança e a
 * confirmação vão só para a própria pessoa.
 */
import type { Campaign, NumberSlot, Sale } from "@/types";
import { firstName, formatDate, formatMoney } from "@/lib/format";
import { padNumber } from "@/lib/raffle";

function numbersList(numbers: number[], total: number) {
  return [...numbers].sort((a, b) => a - b).map((n) => padNumber(n, total)).join(", ");
}

/** Texto para o grupo: prêmio, valor, sorteio e os números ainda disponíveis. */
export function freeNumbersText(campaign: Campaign, slots: NumberSlot[]) {
  const free = slots.filter((s) => s.status === "available").map((s) => s.number);
  const lines = [
    `🎟️ *${campaign.name}*`,
    `🎁 Prêmio: ${campaign.prize}`,
    `💰 ${formatMoney(campaign.unitPrice)} por número`,
    ...(campaign.drawDate ? [`📅 Sorteio: ${formatDate(campaign.drawDate)}`] : []),
    "",
    free.length > 0 ? `✅ *Números disponíveis (${free.length}):*` : "Todos os números já foram vendidos! 🎉",
    ...(free.length > 0 ? [numbersList(free, campaign.quantity), "", "Me chama para garantir o seu! 💛"] : []),
  ];
  return lines.join("\n");
}

/** Lembrete gentil de pagamento para quem comprou e ainda não pagou. */
export function chargeText(campaign: Campaign, sale: Sale) {
  const name = sale.buyer?.name ? `, ${firstName(sale.buyer.name)}` : "";
  const plural = sale.numbers.length > 1;
  return [
    `Oi${name}! Tudo bem? 😊`,
    `Passando para lembrar do pagamento ${plural ? "dos números" : "do número"} *${numbersList(sale.numbers, campaign.quantity)}* da *${campaign.name}*.`,
    `Valor: *${formatMoney(sale.numbers.length * campaign.unitPrice)}*.`,
    "Qualquer coisa é só me chamar. Obrigado! 💛",
  ].join("\n");
}

/** Confirmação para a pessoa que acabou de comprar. */
export function saleConfirmationText(campaign: Campaign, sale: Pick<Sale, "numbers" | "status" | "buyer">) {
  const name = sale.buyer?.name ? `, ${firstName(sale.buyer.name)}` : "";
  const plural = sale.numbers.length > 1;
  const nums = numbersList(sale.numbers, campaign.quantity);
  const status =
    sale.status === "paid"
      ? "Pagamento recebido, obrigado! ✅"
      : sale.status === "reserved"
        ? `${plural ? "Eles estão reservados" : "Ele está reservado"} para você.`
        : `Valor: *${formatMoney(sale.numbers.length * campaign.unitPrice)}* (falta o pagamento).`;
  return [
    `Oi${name}! ${plural ? "Seus números" : "Seu número"} da *${campaign.name}*: *${nums}* 🎟️`,
    status,
    ...(campaign.drawDate ? [`Sorteio: ${formatDate(campaign.drawDate)}. Boa sorte! 🍀`] : ["Boa sorte! 🍀"]),
  ].join("\n");
}

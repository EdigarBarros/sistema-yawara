/**
 * Links para abrir o WhatsApp com a mensagem já escrita.
 * Telefones brasileiros sem o código do país (10 ou 11 dígitos) ganham o 55.
 */
export function whatsappNumber(contact?: string | null) {
  if (!contact || contact.includes("@")) return null;
  const digits = contact.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith("55")) return digits;
  return null;
}

/** Sem telefone válido, abre o WhatsApp para a pessoa escolher a conversa. */
export function whatsappLink(text: string, contact?: string | null) {
  const number = whatsappNumber(contact);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}

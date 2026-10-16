import { isDemoMode } from "@/lib/mode";

/** Formatos oferecidos no seletor de comprovante (o servidor confere o conteúdo real do arquivo). */
export const RECEIPT_ACCEPT = isDemoMode ? "image/*,application/pdf" : ".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/png,image/jpeg,image/webp,image/gif";

export const RECEIPT_HINT = isDemoMode
  ? "Fica apenas neste navegador nesta etapa."
  : "PDF ou imagem (PNG, JPG, WEBP ou GIF), até 15 MB. Somente quem acessa o Financeiro pode abrir o arquivo.";

/** Orientação para o dinheiro de rifas e campanhas (vendas não geram lançamentos automaticamente). */
export const RAFFLE_INCOME_HELP =
  "Vendas de rifas não geram lançamentos automaticamente. Registre aqui, como receita vinculada à campanha, o valor efetivamente recebido — assim o mesmo dinheiro não é contado duas vezes.";

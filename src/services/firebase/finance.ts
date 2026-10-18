/**
 * Financeiro (Firebase).
 *
 * LEITURAS (Firestore, com regras de segurança):
 *  - lançamentos: `financeEntries` (exige `finance.view`), por data, mais
 *    recentes primeiro, até FINANCE_LIST_LIMIT registros;
 *  - categorias: `financeCategories` (qualquer conta ativa);
 *  - lançamentos de um evento: consulta no servidor (`financeApi.listForEvent`),
 *    porque a diretoria do departamento do evento pode vê-los sem ter acesso à
 *    coleção inteira.
 *
 * ESCRITAS: função chamável `financeApi` — o servidor confere permissões,
 * categoria × tipo, valores, vínculos e responsável, grava histórico,
 * auditoria e índice de busca. `takeRequestId()` é sempre a primeira linha.
 *
 * COMPROVANTES: `uploadFile("financeReceipt", ...)` envia para a área
 * temporária e devolve o `uploadId`; o servidor confere o conteúdo real (PDF ou
 * imagem, até 15 MB) e move o arquivo para `finance/{id}/`. Um comprovante
 * substituído nunca é apagado (fica em `receiptHistory`).
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import type { FileRef, FinanceCategory, FinanceEntry } from "@/types";
import type { FinanceEntryInput, FinanceService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { fromSnap, mapFirestoreError } from "./convert";
import { fileSource, isLinkFile } from "./files";
import { getVisible } from "./queries";
import { hasPerm, useFirebaseSession, whenAccess } from "./session";
import { FILE_LIMIT_MB } from "@/lib/mode";

/** Lançamentos carregados na lista do Financeiro (relatórios são calculados sobre eles). */
export const FINANCE_LIST_LIMIT = 2000;

/** Limite do comprovante (o mesmo do servidor: functions/src/core/files.ts). */
export const RECEIPT_MAX_BYTES = FILE_LIMIT_MB.financeReceipt * 1024 * 1024;

const RECEIPT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const ACCEPTED = new Set(Object.values(RECEIPT_TYPES));

/** Lançamento com os comprovantes substituídos (guardados pelo servidor). */
export type FinanceEntryWithReceipts = FinanceEntry & { receiptHistory?: FileRef[] };

const ENTRY_KEYS = ["type", "description", "categoryId", "amount", "date", "responsibleId", "departmentId", "eventId", "campaignId", "paymentMethod", "status", "notes"] as const;

/**
 * Envia só os campos do contrato. Campo presente com `undefined` vai como
 * `null` (= limpar o campo opcional, como no modo demonstração); campo
 * ausente não é alterado.
 */
function entryPayload(input: Partial<FinanceEntryInput>): Record<string, unknown> {
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ENTRY_KEYS) if (key in source) out[key] = source[key] ?? null;
  return out;
}

function normalize<T extends FinanceEntry>(entry: T): T {
  return { ...entry, history: entry.history ?? [] };
}

function safeId(id: string, label = "Lançamento não encontrado.") {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError("not_found", label);
  return id;
}

/** Confere o comprovante antes do envio (só para avisar mais cedo — a conferência que vale é a do servidor). */
function acceptableReceipt(file: File): Blob {
  // Link (implantação gratuita): o servidor confere o endereço.
  if (isLinkFile(file)) return file;
  if (file.size <= 0) throw new ServiceError("invalid", "O comprovante está vazio.");
  if (file.size > RECEIPT_MAX_BYTES) throw new ServiceError("invalid", `O comprovante deve ter no máximo ${FILE_LIMIT_MB.financeReceipt} MB.`);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = ACCEPTED.has(file.type) ? file.type : RECEIPT_TYPES[ext];
  if (!type) throw new ServiceError("invalid", "Formato de comprovante não aceito. Envie um PDF ou uma imagem (PNG, JPG, WEBP ou GIF).");
  return file.type === type ? file : new Blob([file], { type });
}

/**
 * Id que o servidor dará ao lançamento novo (sha256 de `uid:requestId`, 20
 * caracteres — ver functions/src/modules/finance.ts). Usado só como
 * referência no tíquete de envio do comprovante.
 */
async function expectedEntryId(requestId: string): Promise<string> {
  const uid = useFirebaseSession.getState().uid ?? firebase().auth.currentUser?.uid;
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!uid || !subtle) return "novo-lancamento";
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(`${uid}:${requestId}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
}

/** Mesmo comportamento do modo demonstração: módulo desativado não é consultado. */
async function requireModuleEnabled() {
  await whenAccess();
  let disabled = false;
  try {
    const snap = await getDoc(doc(firebase().db, "settings/system"));
    disabled = snap.exists() && (snap.data() as { modules?: Record<string, boolean> }).modules?.finance === false;
  } catch (error) {
    throw mapFirestoreError(error);
  }
  if (disabled) throw new ServiceError("unavailable", "Este módulo está desativado nas configurações.");
}

/** Leitura direta da coleção exige `finance.view` (mesma mensagem do modo demonstração). */
async function requireFinanceView() {
  const access = await whenAccess();
  if (!hasPerm(access, "finance.view")) throw new ServiceError("forbidden", "Seu perfil não tem acesso ao Financeiro.");
}

export const firebaseFinance: FinanceService = {
  async listCategories() {
    await whenAccess();
    try {
      const snap = await getDocs(collection(firebase().db, "financeCategories"));
      return snap.docs
        .map((d) => fromSnap<FinanceCategory>(d))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, "pt-BR") : a.type === "income" ? -1 : 1));
    } catch (error) {
      throw mapFirestoreError(error, "As categorias financeiras não estão disponíveis para o seu perfil.");
    }
  },

  async list() {
    await Promise.all([requireModuleEnabled(), requireFinanceView()]);
    try {
      const snap = await getDocs(query(collection(firebase().db, "financeEntries"), orderBy("date", "desc"), limit(FINANCE_LIST_LIMIT)));
      return snap.docs.map((d) => normalize(fromSnap<FinanceEntryWithReceipts>(d)));
    } catch (error) {
      throw mapFirestoreError(error, "Seu perfil não tem acesso ao Financeiro.");
    }
  },

  async listForEvent(eventId) {
    safeId(eventId, "Evento não encontrado.");
    const entries = await callApi<FinanceEntryWithReceipts[]>("finance", "listForEvent", { eventId });
    return entries.map(normalize);
  },

  async get(id) {
    safeId(id);
    await Promise.all([requireModuleEnabled(), requireFinanceView()]);
    return normalize(await getVisible<FinanceEntryWithReceipts>(`financeEntries/${id}`, "Lançamento"));
  },

  async create(input, receipt) {
    const rid = takeRequestId();
    const blob = receipt ? acceptableReceipt(receipt) : null;
    const source = receipt && blob ? await fileSource("financeReceipt", blob, { name: receipt.name, targetId: await expectedEntryId(rid) }) : {};
    return normalize(await callApi<FinanceEntryWithReceipts>("finance", "create", { input: entryPayload(input), ...source }, rid));
  },

  async update(id, input) {
    const rid = takeRequestId();
    safeId(id);
    return normalize(await callApi<FinanceEntryWithReceipts>("finance", "update", { id, input: entryPayload(input) }, rid));
  },

  async setStatus(id, status, reason) {
    const rid = takeRequestId();
    safeId(id);
    return normalize(await callApi<FinanceEntryWithReceipts>("finance", "setStatus", { id, status, reason: reason?.trim() || null }, rid));
  },

  async attachReceipt(id, receipt) {
    const rid = takeRequestId();
    safeId(id);
    const blob = acceptableReceipt(receipt);
    const source = await fileSource("financeReceipt", blob, { name: receipt.name, targetId: id });
    return normalize(await callApi<FinanceEntryWithReceipts>("finance", "attachReceipt", { id, ...source }, rid));
  },
};

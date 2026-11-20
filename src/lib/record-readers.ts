/**
 * Quem pode LER cada tipo de registro, em forma de marcadores (`readers`).
 *
 * O servidor grava esse campo em cada registro sempre que ele é criado ou o
 * público muda; as regras do Firestore/Storage o comparam com os marcadores
 * do usuário. Estas funções espelham exatamente as políticas de visualização
 * de src/lib/policies.ts — o teste src/lib/record-readers.test.ts confere a
 * equivalência para todos os registros e perfis da demonstração.
 *
 * Quem tem `<módulo>.admin` vê todos os registros do módulo (as regras tratam
 * esse caso pela permissão, sem depender de `readers`).
 */
import type { AtleticaEvent, Campaign, ContentItem, ExtensionProject, ID, InstitutionalDocument, Meeting, Sale, SportTeam } from "@/types";
import { readersFor, TOKEN } from "./access-tokens";

/** Também copiado em `buyers/{saleId}.viewReaders` (as regras do Storage exigem ver a campanha para abrir o comprovante). */
export function campaignReaders(c: Pick<Campaign, "access" | "departmentId" | "createdBy">) {
  return readersFor([{ audience: c.access.view, fallbackDepartmentId: c.departmentId }], [c.createdBy]);
}

/** Quem pode consultar nome, contato e comprovante do comprador de uma venda. */
export function buyerReaders(c: Pick<Campaign, "access" | "departmentId" | "createdBy">, sale: Pick<Sale, "sellerId" | "registeredById">) {
  return readersFor([{ audience: c.access.buyerData, fallbackDepartmentId: c.departmentId }], [c.createdBy, sale.sellerId, sale.registeredById]);
}

export function eventReaders(e: Pick<AtleticaEvent, "access" | "departmentId" | "createdBy" | "responsibleIds">) {
  return readersFor([{ audience: e.access, fallbackDepartmentId: e.departmentId }], [e.createdBy, ...e.responsibleIds]);
}

export function documentReaders(d: Pick<InstitutionalDocument, "access" | "departmentId" | "createdBy">) {
  return readersFor([{ audience: d.access, fallbackDepartmentId: d.departmentId }], [d.createdBy]);
}

export function meetingReaders(m: Pick<Meeting, "access" | "createdBy" | "participantIds">) {
  return readersFor([{ audience: m.access }], [m.createdBy, ...m.participantIds]);
}

export function contentReaders(c: Pick<ContentItem, "access" | "createdBy" | "responsibleId">) {
  return readersFor([{ audience: c.access }], [c.createdBy, c.responsibleId]);
}

export function projectReaders(p: Pick<ExtensionProject, "access" | "createdBy" | "responsibleId">) {
  return readersFor([{ audience: p.access }], [p.createdBy, p.responsibleId]);
}

/** Quem pode ver a lista de presença além de quem tem `extension.edit`/`extension.admin`. */
export function projectEditors(p: Pick<ExtensionProject, "createdBy" | "responsibleId">): string[] {
  return [...new Set([p.createdBy, p.responsibleId].filter(Boolean).map((id) => TOKEN.user(id as ID)))].sort();
}

export function teamReaders(t: Pick<SportTeam, "access" | "createdBy" | "responsibleId">) {
  return readersFor([{ audience: t.access }], [t.createdBy, t.responsibleId]);
}

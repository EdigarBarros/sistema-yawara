"use client";

/**
 * Hooks de leitura de dados. As telas usam apenas estes hooks, que chamam a
 * camada de serviços (`services`). Trocar o backend não altera as telas.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { services } from "@/services";
import { useSession } from "@/stores/session";
import type { ID } from "@/types";

function useUid() {
  return useSession((s) => s.userId) ?? "anon";
}

export function useOrganization() {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "organization"], queryFn: () => services.organization.snapshot(), enabled: uid !== "anon" });
}

/** Acesso rápido a nomes de integrantes, cargos e departamentos. */
export function useDirectory() {
  const { data, isLoading } = useOrganization();
  return useMemo(() => {
    const members = data?.members ?? [];
    const roles = data?.roles ?? [];
    const departments = data?.departments ?? [];
    const memberMap = new Map(members.map((m) => [m.id, m]));
    const roleMap = new Map(roles.map((r) => [r.id, r]));
    const depMap = new Map(departments.map((d) => [d.id, d]));
    return {
      loading: isLoading,
      members,
      roles,
      departments,
      activeMembers: members.filter((m) => m.status === "active"),
      member: (id?: ID) => (id ? memberMap.get(id) : undefined),
      role: (id?: ID) => (id ? roleMap.get(id) : undefined),
      department: (id?: ID) => (id ? depMap.get(id) : undefined),
      memberName: (id?: ID) => (id ? (memberMap.get(id)?.name ?? "Integrante removido") : "—"),
      roleOf: (memberId?: ID) => {
        const m = memberId ? memberMap.get(memberId) : undefined;
        return m ? roleMap.get(m.roleId) : undefined;
      },
      departmentOf: (memberId?: ID) => {
        const m = memberId ? memberMap.get(memberId) : undefined;
        const r = m ? roleMap.get(m.roleId) : undefined;
        return r ? depMap.get(r.departmentId) : undefined;
      },
    };
  }, [data, isLoading]);
}

export function useSettings() {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "settings"], queryFn: () => services.settings.get(), enabled: uid !== "anon" });
}

export function useCampaigns(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "campaigns"], queryFn: () => services.campaigns.list(), enabled });
}
export function useCampaign(id: ID) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "campaigns", id], queryFn: () => services.campaigns.get(id), retry: false });
}
export function useCampaignSales(id: ID, enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "campaigns", id, "sales"], queryFn: () => services.campaigns.listSales(id), enabled, retry: false });
}
export function useAllSales(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "sales"], queryFn: () => services.campaigns.listAllSales(), enabled });
}

export function useEvents(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "events"], queryFn: () => services.events.list(), enabled });
}
export function useEvent(id: ID) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "events", id], queryFn: () => services.events.get(id), retry: false });
}

export function useDocuments(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "documents"], queryFn: () => services.documents.list(), enabled });
}
export function useDocument(id: ID) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "documents", id], queryFn: () => services.documents.get(id), retry: false });
}
export function useDocumentCategories() {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "documentCategories"], queryFn: () => services.documents.listCategories() });
}

export function useMeetings(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "meetings"], queryFn: () => services.meetings.list(), enabled });
}
export function useMeeting(id: ID) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "meetings", id], queryFn: () => services.meetings.get(id), retry: false });
}

export function useFinanceEntries(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "finance"], queryFn: () => services.finance.list(), enabled, retry: false });
}
export function useEventFinance(eventId: ID, enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "finance", "event", eventId], queryFn: () => services.finance.listForEvent(eventId), enabled, retry: false });
}
export function useFinanceCategories() {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "financeCategories"], queryFn: () => services.finance.listCategories() });
}

export function useContents(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "marketing"], queryFn: () => services.marketing.list(), enabled });
}

export function useProjects(enabled = true) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "extension"], queryFn: () => services.extension.list(), enabled });
}
export function useProject(id: ID) {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "extension", id], queryFn: () => services.extension.get(id), retry: false });
}

export function useNotifications() {
  const uid = useUid();
  return useQuery({ queryKey: [uid, "notifications"], queryFn: () => services.notifications.list(), enabled: uid !== "anon" });
}

export function useSearch(query: string) {
  const uid = useUid();
  const q = query.trim();
  return useQuery({
    queryKey: [uid, "search", q],
    queryFn: () => services.search.search(q),
    enabled: q.length >= 2,
    placeholderData: (prev) => prev,
  });
}

"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ID } from "@/types";
import { useAccess } from "@/hooks/use-access";
import { useEvents } from "@/hooks/use-data";
import { formatDate } from "@/lib/format";
import { Field, Select } from "@/components/ui/form";

/** Eventos que o perfil pode escolher (somente os visíveis para ele). */
function useLinkableEvents() {
  const access = useAccess();
  const enabled = access.canModule("events");
  const query = useEvents(enabled);
  const events = useMemo(() => [...(query.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [query.data]);
  return { enabled, events, loading: enabled && query.isLoading, error: enabled && query.isError, refetch: query.refetch };
}

/** Campo opcional "Evento relacionado" (assistente de criação e edição da campanha). */
export function RelatedEventField({ value, onChange, className }: { value: ID; onChange: (id: ID) => void; className?: string }) {
  const { enabled, events, loading, error } = useLinkableEvents();
  const unknownCurrent = !!value && !loading && !events.some((e) => e.id === value);
  const hint = !enabled
    ? "Seu perfil não tem acesso ao módulo de eventos."
    : error
      ? "Não foi possível carregar os eventos agora. Você pode salvar sem vincular e tentar depois."
      : "Opcional. Liga a rifa a um evento da Atlética (ex.: arrecadação para a festa).";
  return (
    <Field label="Evento relacionado" optional hint={hint} className={className}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={loading || ((!enabled || error) && !value)}>
        <option value="">{loading ? "Carregando eventos…" : "Nenhum evento"}</option>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name} · {formatDate(ev.date)}
          </option>
        ))}
        {unknownCurrent && <option value={value}>Evento vinculado (não disponível para o seu perfil)</option>}
      </Select>
    </Field>
  );
}

/** Nome do evento vinculado (com link quando o perfil pode abri-lo). */
export function RelatedEventLabel({ eventId }: { eventId?: ID }) {
  const { events, loading } = useLinkableEvents();
  if (!eventId) return <>—</>;
  const event = events.find((e) => e.id === eventId);
  if (event) {
    return (
      <Link href={`/eventos/${event.id}`} className="font-medium text-fg underline-offset-2 hover:underline">
        {event.name}
      </Link>
    );
  }
  return <span className="text-fg-subtle">{loading ? "Carregando…" : "Evento não disponível para o seu perfil"}</span>;
}

/** Nome do evento para resumos (sem link). */
export function useRelatedEventName(eventId?: ID) {
  const { events } = useLinkableEvents();
  if (!eventId) return null;
  return events.find((e) => e.id === eventId)?.name ?? null;
}

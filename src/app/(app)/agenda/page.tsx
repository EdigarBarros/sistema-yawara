"use client";

import { PageHeader } from "@/components/shared/page";
import { Calendar3D } from "@/features/agenda/calendar-3d";

export default function AgendaPage() {
  return (
    <>
      <PageHeader eyebrow="Para todo mundo acompanhar" title="Agenda" description="Eventos, reuniões, sorteios e prazos que você pode ver, num lugar só. Toque em um dia para ver os detalhes." />
      <Calendar3D />
    </>
  );
}

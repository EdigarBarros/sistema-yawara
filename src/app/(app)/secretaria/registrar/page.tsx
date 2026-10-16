"use client";

import { useAccess } from "@/hooks/use-access";
import { PageHeader } from "@/components/shared/page";
import { RestrictedState } from "@/components/shared/states";
import { isDemoMode } from "@/lib/mode";
import { MeetingForm } from "@/features/meetings/meeting-form";

export default function RegisterMeetingPage() {
  const access = useAccess();
  return (
    <>
      <PageHeader back={{ href: "/secretaria", label: "Secretaria e reuniões" }} eyebrow="Secretaria" title="Registrar reunião" description="Preencha em etapas. A reunião começa como rascunho." />
      {access.can("meetings.create") && access.canModule("meetings") ? (
        <MeetingForm />
      ) : (
        <RestrictedState
          description={
            !access.moduleEnabled("meetings")
              ? "O módulo de Secretaria e reuniões está desativado nas configurações."
              : isDemoMode
                ? "Seu perfil de demonstração não pode registrar reuniões."
                : "Seu cargo não pode registrar reuniões. Se precisar, fale com a presidência."
          }
        />
      )}
    </>
  );
}

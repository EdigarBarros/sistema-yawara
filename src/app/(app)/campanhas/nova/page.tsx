"use client";

import { useAccess } from "@/hooks/use-access";
import { isDemoMode } from "@/lib/mode";
import { PageHeader } from "@/components/shared/page";
import { RestrictedState } from "@/components/shared/states";
import { CampaignWizard } from "@/features/campaigns/campaign-wizard";

export default function NewCampaignPage() {
  const access = useAccess();
  return (
    <>
      <PageHeader
        back={{ href: "/campanhas", label: "Campanhas e vendas" }}
        eyebrow="Nova campanha"
        title="Nova rifa"
        description="São só 2 passos: dizer como é a rifa e conferir. O resto o sistema preenche sozinho."
      />
      {access.can("campaigns.create") && access.canModule("campaigns") ? (
        <CampaignWizard />
      ) : (
        <RestrictedState
          description={
            isDemoMode
              ? "Seu perfil de demonstração não pode criar campanhas. Troque para Presidência, Financeiro, Eventos ou Marketing."
              : "Seu cargo não tem permissão para criar campanhas. Se precisar, peça a quem administra cargos e permissões."
          }
        />
      )}
    </>
  );
}

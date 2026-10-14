"use client";

import { useAccess } from "@/hooks/use-access";
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
        description="Preencha em etapas. Criador, identificador e datas de registro são preenchidos automaticamente."
      />
      {access.can("campaigns.create") && access.canModule("campaigns") ? (
        <CampaignWizard />
      ) : (
        <RestrictedState description="Seu perfil de demonstração não pode criar campanhas. Troque para Presidência, Financeiro, Eventos ou Marketing." />
      )}
    </>
  );
}

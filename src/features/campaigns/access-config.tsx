"use client";

import { useState } from "react";
import { ChevronDown, Eye, IdCard, ShoppingCart } from "lucide-react";
import type { AudienceScope, CampaignAccess } from "@/types";
import { useDirectory } from "@/hooks/use-data";
import { AudiencePicker, AudienceSummary, describeAudience } from "@/components/shared/audience";
import { cn } from "@/lib/utils";

export const VIEW_SCOPES: AudienceScope[] = ["board", "all", "roles", "people"];
export const SELL_SCOPES: AudienceScope[] = ["directors", "directors_advisors", "all", "roles", "people"];
export const BUYER_SCOPES: AudienceScope[] = ["board", "directors", "roles", "people"];

export const SELL_LABELS: Partial<Record<AudienceScope, string>> = { all: "Todos os integrantes autorizados" };
export const VIEW_LABELS: Partial<Record<AudienceScope, string>> = {};
export const BUYER_LABELS: Partial<Record<AudienceScope, string>> = {};

type Key = keyof CampaignAccess;

const SECTIONS: { key: Key; title: string; question: string; icon: React.ReactNode; scopes: AudienceScope[]; labels: Partial<Record<AudienceScope, string>>; note?: string }[] = [
  { key: "view", title: "Visualização", question: "Quem pode ver esta campanha?", icon: <Eye />, scopes: VIEW_SCOPES, labels: VIEW_LABELS },
  {
    key: "sell",
    title: "Registro de vendas",
    question: "Quem pode registrar vendas e reservas?",
    icon: <ShoppingCart />,
    scopes: SELL_SCOPES,
    labels: SELL_LABELS,
    note: "Além do público escolhido, a pessoa precisa ter a permissão de registrar vendas no seu cargo.",
  },
  {
    key: "buyerData",
    title: "Dados dos compradores",
    question: "Quem pode consultar nome e contato dos compradores?",
    icon: <IdCard />,
    scopes: BUYER_SCOPES,
    labels: BUYER_LABELS,
    note: "Quem registrou a venda sempre vê os dados daquela venda. Os demais veem “Restrito”.",
  },
];

/**
 * "Acesso e permissões" da rifa: uma pergunta por vez (acordeão), com resumo
 * da escolha em cada cabeçalho para não sobrecarregar a tela.
 */
export function CampaignAccessConfig({
  value,
  onChange,
  errors,
}: {
  value: CampaignAccess;
  onChange: (v: CampaignAccess) => void;
  errors?: Partial<Record<Key, string>>;
}) {
  const dir = useDirectory();
  const [open, setOpen] = useState<Key>("view");
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {SECTIONS.map((s) => {
        const isOpen = open === s.key;
        return (
          <section key={s.key}>
            <button
              type="button"
              onClick={() => setOpen(s.key)}
              aria-expanded={isOpen}
              className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors sm:px-5", isOpen ? "bg-surface-2" : "hover:bg-surface-2/60")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-fg-muted [&_svg]:size-4">{s.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">{s.title}</span>
                <span className={cn("block truncate text-[12.5px]", errors?.[s.key] ? "text-danger" : "text-fg-muted")}>
                  {errors?.[s.key] ?? describeAudience(value[s.key], dir, s.labels)}
                </span>
              </span>
              <ChevronDown className={cn("size-4 text-fg-subtle transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen && (
              <div className="space-y-3 px-4 pt-1 pb-5 sm:px-5">
                <p className="text-[13px] font-medium text-fg">{s.question}</p>
                <AudiencePicker
                  name={`access-${s.key}`}
                  value={value[s.key]}
                  onChange={(a) => onChange({ ...value, [s.key]: a })}
                  scopes={s.scopes}
                  labels={s.labels}
                  error={errors?.[s.key]}
                />
                {s.note && <p className="text-[12px] text-fg-subtle">{s.note}</p>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Resumo da configuração de acesso (revisão e página da campanha). */
export function CampaignAccessSummary({ access, creatorId }: { access: CampaignAccess; creatorId?: string }) {
  const always = creatorId ? [creatorId] : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <AudienceSummary title="Quem vê" audience={access.view} labels={VIEW_LABELS} alwaysIncluded={always} />
      <AudienceSummary title="Quem registra vendas" audience={access.sell} labels={SELL_LABELS} alwaysIncluded={always} />
      <AudienceSummary title="Quem vê dados dos compradores" audience={access.buyerData} labels={BUYER_LABELS} alwaysIncluded={always} />
    </div>
  );
}

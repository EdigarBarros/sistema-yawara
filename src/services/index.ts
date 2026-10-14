/**
 * Implementação de dados em uso.
 *
 * ETAPA 1 (atual): serviços locais com dados de demonstração no navegador.
 * ETAPA 2: criar `src/services/firebase/*` implementando os mesmos contratos
 * de `./contracts` e trocar a atribuição abaixo. As telas não precisam mudar.
 */
import type { Services } from "./contracts";
import { localAuth } from "./local/auth";
import { localOrganization } from "./local/organization";
import { localCampaigns } from "./local/campaigns";
import { localEvents } from "./local/events";
import { localDocuments } from "./local/documents";
import { localMeetings } from "./local/meetings";
import { localFinance } from "./local/finance";
import { localMarketing } from "./local/marketing";
import { localExtension } from "./local/extension";
import { localNotifications, localSearch, localSettings } from "./local/system";
import { getObjectUrl } from "./local/blob-store";

export const services: Services = {
  auth: localAuth,
  organization: localOrganization,
  campaigns: localCampaigns,
  events: localEvents,
  documents: localDocuments,
  meetings: localMeetings,
  finance: localFinance,
  marketing: localMarketing,
  extension: localExtension,
  settings: localSettings,
  notifications: localNotifications,
  search: localSearch,
  files: { getObjectUrl },
};

/** Identifica a fonte de dados atual — exibido na interface como aviso. */
export const DATA_SOURCE = "demo-local" as const;

export { ServiceError } from "./local/context";
export type * from "./contracts";

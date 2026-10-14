/**
 * Implementação de dados em uso, escolhida por NEXT_PUBLIC_DATA_SOURCE:
 *
 *  - "demo" (padrão): serviços locais com dados fictícios guardados apenas
 *    neste navegador. Nunca acessa o Firebase.
 *  - "firebase": Firebase Authentication, Cloud Firestore, Cloud Storage e
 *    Cloud Functions (ver docs/backend).
 *
 * As telas só conhecem os contratos de ./contracts — trocar a implementação
 * não altera as telas.
 */
import { APP_MODE } from "@/lib/mode";
import type { Services } from "./contracts";
import { localAudit } from "./local/audit";
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
import { getObjectUrl, isAvailable, loadObjectUrl, openFile } from "./local/blob-store";
import { firebaseServices } from "./firebase";

const localServices: Services = {
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
  files: { getObjectUrl, isAvailable, open: openFile, loadObjectUrl },
  audit: localAudit,
};

export const services: Services = APP_MODE === "firebase" ? firebaseServices : localServices;

/** Identifica a fonte de dados atual — exibido na interface como aviso. */
export const DATA_SOURCE = APP_MODE === "firebase" ? ("firebase" as const) : ("demo-local" as const);

export { ServiceError } from "./errors";
export type * from "./contracts";

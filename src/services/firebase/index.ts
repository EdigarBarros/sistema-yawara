/**
 * Implementação Firebase dos contratos da camada de dados.
 * Selecionada em src/services/index.ts quando NEXT_PUBLIC_DATA_SOURCE=firebase.
 */
import type { Services } from "../contracts";
import { firebaseAudit } from "./audit";
import { firebaseAuth } from "./auth";
import { firebaseCampaigns } from "./campaigns";
import { firebaseDocuments } from "./documents";
import { firebaseEvents } from "./events";
import { firebaseExtension } from "./extension";
import { firebaseSports } from "./sports";
import { firebaseFiles } from "./files";
import { firebaseFinance } from "./finance";
import { firebaseMarketing } from "./marketing";
import { firebaseMeetings } from "./meetings";
import { firebaseNotifications } from "./notifications";
import { firebaseOrganization } from "./organization";
import { firebaseSearch } from "./search";
import { firebaseSettings } from "./settings";

export const firebaseServices: Services = {
  auth: firebaseAuth,
  organization: firebaseOrganization,
  campaigns: firebaseCampaigns,
  events: firebaseEvents,
  documents: firebaseDocuments,
  meetings: firebaseMeetings,
  finance: firebaseFinance,
  marketing: firebaseMarketing,
  extension: firebaseExtension,
  sports: firebaseSports,
  settings: firebaseSettings,
  notifications: firebaseNotifications,
  search: firebaseSearch,
  files: firebaseFiles,
  audit: firebaseAudit,
};

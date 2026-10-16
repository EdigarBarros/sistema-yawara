/**
 * Catálogo das APIs do servidor: o mesmo código atende à implantação com
 * Cloud Functions (functions/src/index.ts) e à rota de API do aplicativo
 * (src/app/api/[api]/route.ts — implantação gratuita, sem Cloud Functions).
 */
import { registerApi, type AnyAction } from "./core/dispatch";
import { auditActions } from "./modules/audit";
import { campaignsActions } from "./modules/campaigns";
import { documentsActions } from "./modules/documents";
import { eventsActions } from "./modules/events";
import { extensionActions } from "./modules/extension";
import { financeActions } from "./modules/finance";
import { marketingActions } from "./modules/marketing";
import { meetingsActions } from "./modules/meetings";
import { authActions, organizationActions } from "./modules/organization";
import { searchActions } from "./modules/search";
import { systemActions } from "./modules/system";

export const API_ACTIONS = {
  auth: authActions,
  organization: organizationActions,
  system: { ...systemActions, ...searchActions, ...auditActions },
  campaigns: campaignsActions,
  events: eventsActions,
  documents: documentsActions,
  meetings: meetingsActions,
  finance: financeActions,
  marketing: marketingActions,
  extension: extensionActions,
} satisfies Record<string, Record<string, AnyAction>>;

export type ApiName = keyof typeof API_ACTIONS;

for (const [name, actions] of Object.entries(API_ACTIONS)) registerApi(name, actions);

export function isApiName(value: string): value is ApiName {
  return Object.prototype.hasOwnProperty.call(API_ACTIONS, value);
}

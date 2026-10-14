/**
 * CENTRAL YAWARA — CLOUD FUNCTIONS
 * ---------------------------------------------------------------------------
 * Uma função chamável por área (o navegador envia { action, payload,
 * requestId }). Ver core/dispatch.ts para o fluxo de cada operação e
 * docs/backend/arquitetura.md para o catálogo de ações.
 */
import { createApi } from "./core/dispatch";
import { authActions, organizationActions } from "./modules/organization";
import { systemActions } from "./modules/system";
import { campaignsActions } from "./modules/campaigns";
import { eventsActions } from "./modules/events";
import { documentsActions } from "./modules/documents";
import { meetingsActions } from "./modules/meetings";
import { financeActions } from "./modules/finance";
import { marketingActions } from "./modules/marketing";
import { extensionActions } from "./modules/extension";
import { searchActions } from "./modules/search";
import { auditActions } from "./modules/audit";

export const authApi = createApi("auth", authActions);
export const organizationApi = createApi("organization", organizationActions);
export const systemApi = createApi("system", { ...systemActions, ...searchActions, ...auditActions });
export const campaignsApi = createApi("campaigns", campaignsActions);
export const eventsApi = createApi("events", eventsActions);
export const documentsApi = createApi("documents", documentsActions);
export const meetingsApi = createApi("meetings", meetingsActions);
export const financeApi = createApi("finance", financeActions);
export const marketingApi = createApi("marketing", marketingActions);
export const extensionApi = createApi("extension", extensionActions);

export { cleanupUploads } from "./modules/maintenance";

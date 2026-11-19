/**
 * CENTRAL YAWARA — CLOUD FUNCTIONS (implantação com o plano Blaze)
 * ---------------------------------------------------------------------------
 * Uma função chamável por área (o navegador envia { action, payload,
 * requestId }). Ver core/dispatch.ts para o fluxo de cada operação e
 * docs/backend/arquitetura.md para o catálogo de ações.
 *
 * Na implantação gratuita (plano Spark), as mesmas APIs rodam na rota
 * src/app/api/[api]/route.ts do aplicativo — ver docs/backend/implantacao-gratuita.md.
 */
import { API_ACTIONS } from "./apis";
import { createApi } from "./core/dispatch";

export const authApi = createApi("auth", API_ACTIONS.auth);
export const organizationApi = createApi("organization", API_ACTIONS.organization);
export const systemApi = createApi("system", API_ACTIONS.system);
export const campaignsApi = createApi("campaigns", API_ACTIONS.campaigns);
export const eventsApi = createApi("events", API_ACTIONS.events);
export const documentsApi = createApi("documents", API_ACTIONS.documents);
export const meetingsApi = createApi("meetings", API_ACTIONS.meetings);
export const financeApi = createApi("finance", API_ACTIONS.finance);
export const marketingApi = createApi("marketing", API_ACTIONS.marketing);
export const extensionApi = createApi("extension", API_ACTIONS.extension);
export const sportsApi = createApi("sports", API_ACTIONS.sports);

export { cleanupUploads } from "./modules/maintenance";

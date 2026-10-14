import type { CampaignService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseCampaigns: CampaignService = pendingService<CampaignService>("campaigns");

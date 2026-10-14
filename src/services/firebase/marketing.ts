import type { MarketingService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseMarketing: MarketingService = pendingService<MarketingService>("marketing");

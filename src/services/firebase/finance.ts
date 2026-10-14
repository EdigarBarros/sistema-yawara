import type { FinanceService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseFinance: FinanceService = pendingService<FinanceService>("finance");

import type { AuditService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseAudit: AuditService = pendingService<AuditService>("audit");

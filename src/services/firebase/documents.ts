import type { DocumentService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseDocuments: DocumentService = pendingService<DocumentService>("documents");

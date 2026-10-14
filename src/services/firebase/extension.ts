import type { ExtensionService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseExtension: ExtensionService = pendingService<ExtensionService>("extension");

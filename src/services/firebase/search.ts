import type { SearchService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseSearch: SearchService = pendingService<SearchService>("search");

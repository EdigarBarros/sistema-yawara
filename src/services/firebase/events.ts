import type { EventService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseEvents: EventService = pendingService<EventService>("events");

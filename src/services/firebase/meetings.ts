import type { MeetingService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseMeetings: MeetingService = pendingService<MeetingService>("meetings");

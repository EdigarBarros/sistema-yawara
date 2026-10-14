import type { NotificationService } from "../contracts";
import { pendingService } from "./pending";

/** A implementar (ver docs/backend/arquitetura.md). */
export const firebaseNotifications: NotificationService = pendingService<NotificationService>("notifications");

import type { NotificationActionsNative } from "./notification-actions.types";

/**
 * The app gets notifications only on iOS, where `notification-actions.ios.ts` replaces this file.
 * Other platforms and the tests do not load `expo-notifications`.
 */
export const notificationActionsNative: NotificationActionsNative | null = null;

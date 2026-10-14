import type { PushNotificationsNative } from "./push-notifications-native.types";

/**
 * The app gets notifications only on iOS, where `push-notifications-native.ios.ts` replaces this
 * file. Other platforms and the tests do not load `expo-notifications`.
 */
export const pushNotificationsNative: PushNotificationsNative | null = null;

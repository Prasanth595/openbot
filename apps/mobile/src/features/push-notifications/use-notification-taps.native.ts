import { expoGoOnAndroid } from "@/shared/lib/expo-go";

type UseNotificationTaps = (open: (agentId: string) => void, openChat: () => string | null) => void;

/**
 * `expo-notifications` throws when it loads in Expo Go on Android, which has no push notifications.
 * So `notification-taps.ts` loads only on iOS and in a build of the app.
 */
function load(): UseNotificationTaps {
  if (expoGoOnAndroid()) return () => undefined;
  const taps: typeof import("./notification-taps") = require("./notification-taps");
  return taps.useNotificationTaps;
}

export const useNotificationTaps: UseNotificationTaps = load();

import type { NotificationRelayPush, NotificationSound } from "./notification-relay";
import { isDynamicRecord, isString } from "./runtime-values";

/** Native FCM tokens are opaque. This bound is separate from the released APNs token rule. */
export const ANDROID_NOTIFICATION_TOKEN_PATTERN = /^[\x21-\x7e]{16,4096}$/u;
export const ANDROID_NOTIFICATION_SEALED_LIMIT = 3_300;
export const ANDROID_NOTIFICATION_CHANNEL_PREFIX = "openbot-events-v1-";

/** Android resource names use underscores; released iOS filenames remain unchanged. */
export const ANDROID_NOTIFICATION_SOUND_FILES: Readonly<Record<Exclude<NotificationSound, "default">, string>> = {
  openbot: "openbot_task.wav",
  warm: "openbot_warm.wav",
  mech: "openbot_mech.wav",
  bubble: "openbot_bubble.wav",
  press: "openbot_press.wav",
};

/** The relay sees the device destination and authenticated ciphertext, never chat text. */
export interface AndroidNotificationRelayPush extends Omit<NotificationRelayPush, "environment"> {
  transport: "fcm";
}

export type MobileNotificationRelayPush = NotificationRelayPush | AndroidNotificationRelayPush;

export function readAndroidNotificationRelayPush(value: unknown): AndroidNotificationRelayPush | null {
  if (!isDynamicRecord(value)) return null;
  const { transport, token, sessionId, sealed, sound, timestamp } = value;
  if (transport !== "fcm" || !isString(token) || !ANDROID_NOTIFICATION_TOKEN_PATTERN.test(token)) return null;
  if (!isString(sessionId) || !sessionId || sessionId.length > 128) return null;
  if (
    !isString(sealed) ||
    !sealed ||
    sealed.length > ANDROID_NOTIFICATION_SEALED_LIMIT ||
    !/^[A-Za-z0-9_-]+$/u.test(sealed)
  )
    return null;
  if (
    sound !== null &&
    sound !== "openbot" &&
    sound !== "warm" &&
    sound !== "mech" &&
    sound !== "bubble" &&
    sound !== "press" &&
    sound !== "default"
  )
    return null;
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return { transport, token, sessionId, sealed, sound, timestamp };
}

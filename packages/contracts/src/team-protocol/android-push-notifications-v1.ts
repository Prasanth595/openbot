// Additive Android registration. The released push-notifications-v1 APNs contract stays unchanged.
import { ANDROID_NOTIFICATION_TOKEN_PATTERN } from "../android-notification-relay";
import { isDynamicRecord, isString } from "../runtime-values";
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import { PUSH_NOTIFICATION_SOUNDS, type PushNotificationRegistration } from "./push-notifications-v1";

export const ANDROID_PUSH_NOTIFICATIONS_CAPABILITY = "android-push-notifications-v1";
export const ANDROID_PUSH_NOTIFICATIONS_ROUTES = {
  register: "/v1/android-push-notifications/registration",
  remove: "/v1/android-push-notifications/registration/remove",
} as const;

/** A generic Android alert. The authenticated tap opens the chat; no preview reaches Google. */
export interface AndroidPushNotificationRegistration extends PushNotificationRegistration {
  transport: "fcm";
  token: string;
}

const token = (value: unknown) => {
  const result = string(4_096)(value);
  if (!isString(result) || !ANDROID_NOTIFICATION_TOKEN_PATTERN.test(result))
    throw new Error("Invalid Android push token.");
  return result;
};
const secret = (value: unknown) => {
  const result = string(43)(value);
  if (!isString(result) || !/^[A-Za-z0-9_-]{43}$/u.test(result)) throw new Error("Invalid notification secret.");
  return result;
};
export const ANDROID_PUSH_NOTIFICATIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    ANDROID_PUSH_NOTIFICATIONS_ROUTES.register,
    adminRoute(
      fields({
        serverId: identifier,
        transport: oneOf("fcm"),
        token,
        environment: oneOf("production"),
        secret,
        locale: string(35),
        away: boolean,
        level: oneOf("all", "needs-me"),
        mutedUntil: nullable(count),
        preview: (value) => {
          if (value !== false) throw new Error("Android previews are unavailable.");
          return false;
        },
        sound: oneOf(...PUSH_NOTIFICATION_SOUNDS),
        liveActivityStartedAt: (value) => {
          if (value !== null) throw new Error("Android has no Live Activity.");
          return null;
        },
      }),
      empty,
    ),
  ],
  [ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove, adminRoute(empty, empty)],
]);

/** Reads the record after the optional route codec accepted it. */
export function readAndroidPushRegistration(value: unknown): AndroidPushNotificationRegistration | null {
  if (!isDynamicRecord(value)) return null;
  const {
    serverId,
    transport,
    token,
    environment,
    secret,
    locale,
    away,
    level,
    mutedUntil,
    preview,
    sound,
    liveActivityStartedAt,
  } = value;
  if (
    !isString(serverId) ||
    transport !== "fcm" ||
    !isString(token) ||
    environment !== "production" ||
    !isString(secret) ||
    !isString(locale)
  )
    return null;
  if (
    typeof away !== "boolean" ||
    (level !== "all" && level !== "needs-me") ||
    (mutedUntil !== null && typeof mutedUntil !== "number")
  )
    return null;
  if (preview !== false || liveActivityStartedAt !== null) return null;
  const choice = PUSH_NOTIFICATION_SOUNDS.find((item) => item === sound);
  if (!choice) return null;
  return {
    serverId,
    transport,
    token,
    environment,
    secret,
    locale,
    away,
    level,
    mutedUntil,
    preview,
    sound: choice,
    liveActivityStartedAt,
  };
}

import { ANDROID_NOTIFICATION_TOKEN_PATTERN } from "@openbot/contracts/android-notification-relay";
import type { NotificationSound } from "@openbot/contracts/notification-relay";
import type { PushNotificationsNative } from "./push-notifications-native.types";

interface AndroidNativePorts {
  ensureChannels(): Promise<void>;
  permission(): Promise<{ status: string; canAskAgain: boolean }>;
  requestPermission(): Promise<{ status: string }>;
  token(): Promise<{ type: string; data: unknown }>;
  onToken(listener: (token: { type: string; data: unknown }) => void): () => void;
  previewSound(sound: NotificationSound): Promise<void>;
}

function deviceToken(value: { type: string; data: unknown }): string | null {
  return value.type === "android" &&
    typeof value.data === "string" &&
    ANDROID_NOTIFICATION_TOKEN_PATTERN.test(value.data)
    ? value.data
    : null;
}

/** Native callbacks stay at the Expo adapter; this owns permission ordering and opaque token bounds. */
export function createAndroidPushNative(ports: AndroidNativePorts): PushNotificationsNative {
  return {
    async permission() {
      await ports.ensureChannels();
      const current = await ports.permission();
      const value =
        current.status === "undetermined" && current.canAskAgain ? await ports.requestPermission() : current;
      return value.status === "granted" ? "granted" : value.status === "undetermined" ? "undetermined" : "denied";
    },
    async deviceToken() {
      return deviceToken(await ports.token());
    },
    onDeviceToken(listener) {
      return ports.onToken((value) => listener(deviceToken(value)));
    },
    writeKeys() {},
    removeKeys() {},
    previewSound: (sound) => ports.previewSound(sound),
  };
}

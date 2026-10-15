import type { NotificationSound } from "@openbot/contracts/notification-relay";
export type NotificationPermission = "granted" | "denied" | "undetermined";

/** The data key of a sound preview. The notification handler plays it and shows nothing. */
export const SOUND_PREVIEW_KEY = "openbotSoundPreview";

/** The native notification adapter. iOS also writes keys for its extension. */
export interface PushNotificationsNative {
  /** Reads permission and asks when the platform can ask. */
  permission(): Promise<NotificationPermission>;
  /** The native push token, or `null` when the platform gives none. */
  deviceToken(): Promise<string | null>;
  /** The platform can give the app a new token. Returns the function that stops listening. */
  onDeviceToken(listener: (token: string | null) => void): () => void;
  /**
   * Writes the notification keys of each server where the Notification Service Extension reads them,
   * with the server names, so a notification says its server when the phone has more than one.
   */
  writeKeys(servers: readonly { serverId: string; name: string; seal: string; tag: string }[]): void;
  /** Sign-out removes the keys, so a notification sent after it shows nothing of the workspace. */
  removeKeys(): void;
  /** Plays `sound` as a notification plays it. In silent mode iOS plays it as it plays a notification. */
  previewSound(sound: NotificationSound): Promise<void>;
}

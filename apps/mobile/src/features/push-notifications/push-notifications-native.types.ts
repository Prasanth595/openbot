import type { NotificationSound } from "@openbot/contracts/notification-relay";
import type { NotificationPermission } from "@/features/settings/model/push-notifications";

/** The data key of a sound preview. The notification handler plays it and shows nothing. */
export const SOUND_PREVIEW_KEY = "openbotSoundPreview";

/** The iOS side of notifications: permission, the push token, and the keys of the extension. */
export interface PushNotificationsNative {
  /** Reads the permission, and asks once when iOS has not asked yet. */
  permission(): Promise<NotificationPermission>;
  /** The APNs token of the app as lowercase hex, or `null` when iOS gives none. */
  deviceToken(): Promise<string | null>;
  /** iOS can give the app a new token. Returns the function that stops listening. */
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

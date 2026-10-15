import {
  ANDROID_NOTIFICATION_CHANNEL_PREFIX,
  ANDROID_NOTIFICATION_SOUND_FILES,
} from "@openbot/contracts/android-notification-relay";
import { NOTIFICATION_SOUNDS } from "@openbot/contracts/notification-relay";
import * as Notifications from "expo-notifications";
import { currentText } from "@/shared/lib/text";
import { createAndroidPushNative } from "./android-push-native";
import { SOUND_PREVIEW_KEY } from "./push-notifications-native.types";

async function ensureChannels(): Promise<void> {
  const { t } = currentText();
  for (const sound of [...NOTIFICATION_SOUNDS, "none"] as const) {
    await Notifications.setNotificationChannelAsync(`${ANDROID_NOTIFICATION_CHANNEL_PREFIX}${sound}`, {
      name:
        sound === "none" ? t("mobile.settings.notifications.title") : t(`mobile.settings.notifications.sound.${sound}`),
      importance: Notifications.AndroidImportance.HIGH,
      sound: sound === "none" ? null : sound === "default" ? "default" : ANDROID_NOTIFICATION_SOUND_FILES[sound],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

export const pushNotificationsNative = createAndroidPushNative({
  ensureChannels,
  permission: () => Notifications.getPermissionsAsync(),
  requestPermission: () => Notifications.requestPermissionsAsync(),
  token: () => Notifications.getDevicePushTokenAsync(),
  onToken(listener) {
    const subscription = Notifications.addPushTokenListener(listener);
    return () => subscription.remove();
  },
  async previewSound(sound) {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: {
        sound: sound === "default" ? "default" : ANDROID_NOTIFICATION_SOUND_FILES[sound],
        data: { [SOUND_PREVIEW_KEY]: true },
      },
      trigger: { channelId: `${ANDROID_NOTIFICATION_CHANNEL_PREFIX}${sound}` },
    });
  },
});

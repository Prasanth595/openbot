import { Typography } from "heroui-native";
import { useState } from "react";
import { Linking } from "react-native";
import { useUniwind } from "uniwind";
import { ServerNotificationSettings } from "@/features/push-notifications/components/server-notification-settings";
import { pushNotificationsNative } from "@/features/push-notifications/push-notifications-native";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveLiveActivitiesPreference, useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import {
  savePushNotificationPreference,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** Existing notification choices on both platforms, with iOS-only previews and Live Activities. */
export function NotificationsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { servers } = useMobileWorkspace();
  const preference = usePushNotificationPreference();
  const liveActivities = useLiveActivitiesPreference();
  const [error, setError] = useState<string | null>(null);
  const [liveActivitiesError, setLiveActivitiesError] = useState<string | null>(null);
  const dark = theme === "dark";
  const busy = !preference.ready || preference.saving;
  const denied = preference.enabled && preference.permission === "denied";
  const soundAvailable = !busy && (preference.enabled || (isIOS && liveActivities.enabled));

  function save(change: Parameters<typeof savePushNotificationPreference>[0]) {
    setError(null);
    void savePushNotificationPreference(change).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }

  function saveLiveActivities(enabled: boolean) {
    setLiveActivitiesError(null);
    void saveLiveActivitiesPreference(enabled).catch(() => setLiveActivitiesError(t("mobile.settings.saveFailed")));
  }

  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.settings.notifications.title")}
        footer={
          error ??
          (denied
            ? t("mobile.settings.notifications.denied")
            : isIOS
              ? `${t("mobile.settings.notifications.footer")}\n\n${t("mobile.settings.notifications.previewFooter")}`
              : t("mobile.settings.notifications.androidFooter"))
        }
      >
        <SettingsRow>
          <SettingsSwitch
            value={preference.enabled}
            disabled={busy}
            label={t("mobile.settings.notifications.toggle")}
            dark={dark}
            onValueChange={(enabled) => save({ enabled })}
          />
        </SettingsRow>
        {denied ? (
          <SettingsRow disclosure={false} onPress={() => void Linking.openSettings()}>
            <Typography.Paragraph>{t("mobile.settings.notifications.openSettings")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {isIOS ? (
          <SettingsRow>
            <SettingsSwitch
              value={preference.preview}
              disabled={busy || !preference.enabled}
              label={t("mobile.settings.notifications.preview")}
              dark={dark}
              onValueChange={(preview) => save({ preview })}
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {isIOS ? (
        <SettingsSection
          title={t("mobile.settings.liveActivities.title")}
          footer={liveActivitiesError ?? t("mobile.settings.liveActivities.footer")}
        >
          <SettingsRow>
            <SettingsSwitch
              value={liveActivities.enabled}
              disabled={!liveActivities.ready || liveActivities.saving}
              label={t("mobile.settings.liveActivities.toggle")}
              dark={dark}
              onValueChange={saveLiveActivities}
            />
          </SettingsRow>
          {liveActivitiesError ? (
            <SettingsRow
              disabled={liveActivities.saving}
              disclosure={false}
              onPress={() => saveLiveActivities(liveActivities.enabled)}
            >
              <Typography.Paragraph>{t("mobile.settings.liveActivities.retry")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      <SettingsSection
        title={t("mobile.settings.notifications.sound")}
        footer={
          isIOS ? t("mobile.settings.notifications.soundFooter") : t("mobile.settings.notifications.androidSoundFooter")
        }
      >
        {/* The hosts get the sound with the notification choices, also with notifications off. */}
        <SettingsRow>
          <SettingsSwitch
            value={preference.playSound}
            disabled={!soundAvailable}
            label={t("mobile.settings.notifications.playSound")}
            dark={dark}
            onValueChange={(playSound) => save({ playSound })}
          />
        </SettingsRow>
        <SettingsRow
          trailing={
            <SettingsPicker
              value={preference.sound}
              options={[
                { value: "openbot", label: t("mobile.settings.notifications.sound.openbot") },
                { value: "warm", label: t("mobile.settings.notifications.sound.warm") },
                { value: "mech", label: t("mobile.settings.notifications.sound.mech") },
                { value: "bubble", label: t("mobile.settings.notifications.sound.bubble") },
                { value: "press", label: t("mobile.settings.notifications.sound.press") },
                { value: "default", label: t("mobile.settings.notifications.sound.default") },
              ]}
              enabled={soundAvailable && preference.playSound}
              dark={dark}
              label={t("mobile.settings.notifications.sound")}
              onChange={(sound) => {
                void haptics.selection();
                save({ sound });
                // Without notification permission iOS plays nothing, as it would for a notification.
                void pushNotificationsNative?.previewSound(sound).catch(() => undefined);
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.notifications.sound")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {servers.map((server) => (
        <ServerNotificationSettings key={server.id} server={server} title={server.name} />
      ))}
    </SettingsContent>
  );
}

import { DEVICE_TOOL_APPS, type DeviceToolApp } from "@openbot/contracts/team-protocol/device-tools-v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { Linking } from "react-native";
import { useUniwind } from "uniwind";
import { DEVICE_APP_NAME } from "@/features/device-apps/model/app-text";
import { type OsPermissionState, readOsPermission } from "@/features/device-apps/model/os-permissions";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import {
  loadDeviceAppsPreference,
  saveDeviceAppAccess,
  saveDeviceAppWriteAlways,
  useDeviceAppsPreference,
  WRITABLE_DEVICE_APPS,
  type WritableDeviceApp,
} from "@/features/settings/model/device-apps";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

const WRITE_LABEL = {
  calendar: "mobile.deviceApps.write.calendar",
  reminders: "mobile.deviceApps.write.reminders",
} as const satisfies Record<WritableDeviceApp, MobileTextKey>;

/**
 * Which iPhone apps an agent may use through this phone. The choice is on the phone only: the host
 * stores no consent. An app that is off asks at the first use. The iPhone keeps its own permission, which
 * only iPhone Settings can change after the user refused it, so the screen links there.
 */
export function DeviceAppsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const preference = useDeviceAppsPreference();
  const foreground = useAppForeground();
  const [error, setError] = useState<string | null>(null);
  const [systemState, setSystemState] = useState<Partial<Record<DeviceToolApp, OsPermissionState>>>({});
  const dark = theme === "dark";

  useEffect(() => {
    void loadDeviceAppsPreference();
  }, []);
  // The user can change a permission in iPhone Settings, so it is read again on each return.
  useEffect(() => {
    if (!foreground) return;
    let current = true;
    void Promise.all(DEVICE_TOOL_APPS.map(async (app) => [app, await readOsPermission(app)] as const)).then(
      (states) => {
        if (current) setSystemState(Object.fromEntries(states));
      },
    );
    return () => {
      current = false;
    };
  }, [foreground]);

  function report(save: Promise<void>) {
    setError(null);
    void save.catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }

  const blocked = DEVICE_TOOL_APPS.filter((app) => systemState[app] === "denied" && preference.access[app] !== "deny");
  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.deviceApps.apps")} footer={error ?? t("mobile.deviceApps.appsFooter")}>
        {DEVICE_TOOL_APPS.map((app) => (
          <SettingsRow key={app}>
            <SettingsSwitch
              value={preference.access[app] === "allow"}
              disabled={!preference.ready}
              label={
                preference.access[app] === "deny"
                  ? t("mobile.deviceApps.app.denied", { app: t(DEVICE_APP_NAME[app]) })
                  : t(DEVICE_APP_NAME[app])
              }
              dark={dark}
              onValueChange={(on) => report(saveDeviceAppAccess(app, on ? "allow" : "ask"))}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title={t("mobile.deviceApps.writes")} footer={t("mobile.deviceApps.writesFooter")}>
        {WRITABLE_DEVICE_APPS.map((app) => (
          <SettingsRow key={app}>
            <SettingsSwitch
              value={preference.writeAlways[app]}
              disabled={!preference.ready}
              label={t(WRITE_LABEL[app])}
              dark={dark}
              onValueChange={(always) => report(saveDeviceAppWriteAlways(app, always))}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
      {blocked.length > 0 ? (
        <SettingsSection>
          {blocked.map((app) => (
            <SettingsRow key={app} disclosure={false} onPress={() => void Linking.openSettings()}>
              <Typography.Paragraph>
                {t("mobile.deviceApps.osDenied", { app: t(DEVICE_APP_NAME[app]) })}
              </Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

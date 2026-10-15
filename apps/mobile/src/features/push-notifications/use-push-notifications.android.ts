import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { encodeLiveActivityBytes, liveActivityHostSecret } from "@openbot/team-client/live-activity-seal";
import { useEffect, useRef, useState } from "react";
import { loadLiveActivitySecret } from "@/features/live-activity/model/live-activity-keys";
import {
  loadPushNotificationPreference,
  setNotificationPermission,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import { currentLocale } from "@/shared/lib/text";
import { AndroidPushRegistration } from "./android-push-registration";
import { pushNotificationsNative } from "./push-notifications-native.android";

interface PushNotificationsInput {
  servers: readonly { id: string; name: string; state: string }[];
  foreground: boolean;
  post(serverId: string, path: string, body: TeamProtocolV2Json): Promise<unknown>;
  supportsPush(serverId: string): boolean;
}

export function usePushNotifications({ servers, foreground, post, supportsPush }: PushNotificationsInput): void {
  const preference = usePushNotificationPreference();
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const callbacks = useRef({ post, supportsPush });
  callbacks.current = { post, supportsPush };
  const controller = useRef<AndroidPushRegistration | null>(null);
  useEffect(() => {
    let current = true;
    const registration = new AndroidPushRegistration({
      native: pushNotificationsNative,
      supports: (serverId) => callbacks.current.supportsPush(serverId),
      post: (serverId, path, body) => callbacks.current.post(serverId, path, body),
      permission: setNotificationPermission,
    });
    controller.current = registration;
    void loadLiveActivitySecret().then(
      (value) => {
        if (current) setSecret(value);
      },
      () => undefined,
    );
    return () => {
      current = false;
      controller.current = null;
      void registration.dispose();
    };
  }, []);
  useEffect(() => {
    if (foreground) void loadPushNotificationPreference().catch(() => undefined);
  }, [foreground]);
  useEffect(() => {
    if (!secret) return;
    controller.current?.update({
      servers,
      foreground,
      ready: preference.ready,
      enabled: preference.enabled,
      playSound: preference.playSound,
      sound: preference.sound,
      locale: currentLocale(),
      settings: preference.servers,
      secret: (serverId) => encodeLiveActivityBytes(liveActivityHostSecret(secret, serverId)),
    });
  }, [secret, servers, foreground, preference]);
}

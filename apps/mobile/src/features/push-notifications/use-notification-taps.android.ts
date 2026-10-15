import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { loadLiveActivitySecret } from "@/features/live-activity/model/live-activity-keys";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidNotificationTaps } from "./android-notification-taps";
import { SOUND_PREVIEW_KEY } from "./push-notifications-native.types";

export function useNotificationTaps(
  open: (agentId: string, serverId?: string) => void,
  _openChat: () => string | null,
): void {
  const response = Notifications.useLastNotificationResponse();
  const { servers } = useMobileWorkspace();
  const current = useRef({ servers, open });
  current.current = { servers, open };
  const controller = useRef<AndroidNotificationTaps | null>(null);
  useEffect(() => {
    const taps = new AndroidNotificationTaps({
      servers: () => current.current.servers,
      secret: loadLiveActivitySecret,
      open: (agentId, serverId) => current.current.open(agentId, serverId),
    });
    controller.current = taps;
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldSetBadge: false,
        shouldPlaySound: notification.request.content.data?.[SOUND_PREVIEW_KEY] === true,
      }),
    });
    return () => {
      taps.dispose();
      controller.current = null;
      Notifications.setNotificationHandler(null);
    };
  }, []);
  useEffect(() => {
    // A cold response can arrive before the workspace has loaded its server keys.
    if (!response || servers.length === 0 || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER)
      return;
    void controller.current
      ?.receive(response.notification.request.identifier, response.notification.request.content.data)
      .catch(() => undefined);
  }, [response, servers]);
}

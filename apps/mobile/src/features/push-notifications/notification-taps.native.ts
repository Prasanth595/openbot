import { isString } from "@openbot/contracts/runtime-values";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { type NotificationTarget, SOUND_PREVIEW_KEY } from "./push-notifications-native.types";

/** The response that opened a chat last. A remount must not open it again. */
let handled: string | null = null;

/**
 * Opens the chat of a notification that the user taps, also when the tap starts the app. The
 * Notification Service Extension on iOS, and `OpenBotMessagingService.kt` on Android, put the agent
 * into the notification data when they open the seal.
 * While the app is on screen, a notification of the chat that shows is not shown again.
 */
export function useNotificationTaps(open: (target: NotificationTarget) => void, openChat: () => string | null): void {
  const response = Notifications.useLastNotificationResponse();
  const openRef = useRef(open);
  openRef.current = open;
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // A sound preview from Settings only plays its sound.
        if (notification.request.content.data?.[SOUND_PREVIEW_KEY] === true) {
          return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false };
        }
        const agentId = notificationTarget(notification)?.agentId ?? null;
        const shown = agentId !== null && agentId === openChatRef.current();
        return { shouldShowBanner: !shown, shouldShowList: !shown, shouldPlaySound: !shown, shouldSetBadge: false };
      },
    });
    return () => Notifications.setNotificationHandler(null);
  }, []);

  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const identifier = response.notification.request.identifier;
    if (handled === identifier) return;
    handled = identifier;
    const target = notificationTarget(response.notification);
    if (target) openRef.current(target);
  }, [response]);
}

function notificationTarget(notification: Notifications.Notification): NotificationTarget | null {
  // A notification that the extension could not open has no data.
  const data = notification.request.content.data;
  const agentId = data?.agentId;
  if (!isString(agentId) || !agentId) return null;
  const serverId = data?.serverId;
  const threadId = data?.threadId;
  return {
    agentId,
    serverId: isString(serverId) && serverId ? serverId : null,
    threadId: isString(threadId) && threadId ? threadId : null,
  };
}

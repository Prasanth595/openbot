import { requireOptionalNativeModule } from "expo";
import * as Notifications from "expo-notifications";
import type { NotificationActionsNative } from "./notification-actions.types";
import {
  APPROVAL_CATEGORY,
  APPROVAL_DENY_CATEGORY,
  APPROVE_ACTION,
  DENY_ACTION,
  type NotificationApprovalAnswer,
  notificationApprovalAnswer,
} from "./notification-approvals";

/** `modules/background-time`. A build without it, such as Expo Go, answers without extra time. */
const backgroundTime = requireOptionalNativeModule<{
  begin(name: string): Promise<number>;
  end(identifier: number): Promise<void>;
  endLaunch(): Promise<void>;
}>("OpenBotBackgroundTime");

/** The responses that the app answered. iOS and the last response can give one again. */
const answered = new Set<string>();

function answerOf(response: Notifications.NotificationResponse): NotificationApprovalAnswer | null {
  const { request } = response.notification;
  return notificationApprovalAnswer(
    `${request.identifier}:${response.actionIdentifier}`,
    response.actionIdentifier,
    request.content.categoryIdentifier,
    request.content.data,
    request.content.title ?? "",
  );
}

export const notificationActionsNative: NotificationActionsNative | null = {
  async registerCategories({ approve, deny }) {
    // Background buttons: iOS and the watch answer without opening the app. They need an unlocked
    // device, which is a watch on the wrist.
    const approveAction: Notifications.NotificationAction = {
      identifier: APPROVE_ACTION,
      buttonTitle: approve,
      options: { opensAppToForeground: false, isAuthenticationRequired: true },
    };
    const denyAction: Notifications.NotificationAction = {
      identifier: DENY_ACTION,
      buttonTitle: deny,
      options: { opensAppToForeground: false, isAuthenticationRequired: true, isDestructive: true },
    };
    await Notifications.setNotificationCategoryAsync(APPROVAL_CATEGORY, [approveAction, denyAction]);
    await Notifications.setNotificationCategoryAsync(APPROVAL_DENY_CATEGORY, [denyAction]);
  },
  onAnswer(listener) {
    const receive = (response: Notifications.NotificationResponse | null) => {
      const answer = response && answerOf(response);
      if (!answer || answered.has(answer.responseId)) return;
      answered.add(answer.responseId);
      listener(answer);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(receive);
    // A button that started the app came before this listener.
    receive(Notifications.getLastNotificationResponse());
    return () => subscription.remove();
  },
  async holdBackgroundTime() {
    if (!backgroundTime) return () => undefined;
    const identifier = await backgroundTime.begin("OpenBot notification answer").catch(() => -1);
    // JavaScript holds its own time now.
    void backgroundTime.endLaunch().catch(() => undefined);
    return () => {
      if (identifier >= 0) void backgroundTime.end(identifier).catch(() => undefined);
    };
  },
  async showFailure(answer, body) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: answer.title,
        body,
        // `use-notification-taps.ios.ts` opens the chat of a tap.
        data: { serverId: answer.serverId, agentId: answer.agentId, threadId: answer.threadId },
      },
      trigger: null,
    });
  },
};

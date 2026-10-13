import {
  PUSH_NOTIFICATIONS_CAPABILITY,
  PUSH_NOTIFICATIONS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notifications-v1";
import { sourceText } from "@openbot/i18n/source";
import { readPushRegistration } from "../push-notification-store";
import type { PushNotificationService } from "../push-notifications";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * The phone of the calling member gives or removes its push token and the events it wants. The host
 * sends notifications only for what this member can see. Frozen by `push-notifications-v1`.
 */
export async function routePushNotifications(
  context: TeamApiRequestContext,
  notifications: PushNotificationService | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId, protocol } = context;
  if (
    method !== "POST" ||
    (url.pathname !== PUSH_NOTIFICATIONS_ROUTES.register && url.pathname !== PUSH_NOTIFICATIONS_ROUTES.remove)
  ) {
    return "unmatched";
  }
  if (!notifications || !capabilities.has(PUSH_NOTIFICATIONS_CAPABILITY)) {
    throw new HttpError(400, sourceText("error.team.pushNotificationsUnsupported"));
  }
  // `readJson` has already run the body through the push-notifications wire codec.
  const body = await readJson(request);
  if (url.pathname === PUSH_NOTIFICATIONS_ROUTES.remove) {
    notifications.remove(sessionId);
    return json(200, {});
  }
  const registration = readPushRegistration(body);
  if (!registration) throw new HttpError(400, sourceText("error.team.pushNotificationsUnsupported"));
  notifications.register(sessionId, { memberId: member.id, protocol, capabilities }, registration);
  return json(200, {});
}

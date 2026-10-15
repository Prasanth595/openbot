import { readAndroidNotificationRelayPush } from "@openbot/contracts/android-notification-relay";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { FcmNotificationSender } from "./android-notification-relay";
import type { AuthOperationError } from "./auth-service";
import { readJsonObject } from "./json-body";
import type { RemoteControlPlane } from "./remote-control-plane";

export interface AndroidNotificationRouteDependencies {
  controlPlane: Pick<RemoteControlPlane, "authenticateHost" | "sessionOpen">;
  relay: {
    sender: FcmNotificationSender;
    allow(hostId: string): Effect.Effect<boolean, AuthOperationError>;
  } | null;
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Framework-independent request operation so E2E can use the real route with an owned transport. */
export const relayAndroidNotification = Effect.fn("AndroidNotificationRoute.relay")(function* (
  request: Request,
  hostId: string,
  dependencies: AndroidNotificationRouteDependencies,
) {
  const body = yield* readJsonObject(request);
  if (!isString(body.machineToken)) return error(400, "invalid_remote_request", "The host credential is invalid.");
  const push = readAndroidNotificationRelayPush(body);
  if (!push) return error(400, "invalid_notification", "The notification is invalid.");
  yield* dependencies.controlPlane.authenticateHost(hostId, body.machineToken);
  if (!dependencies.relay) return error(503, "notification_unavailable", "Notifications are not available.");
  if (!(yield* dependencies.relay.allow(hostId))) return error(429, "rate_limited", "Too many notifications.");
  if (!(yield* dependencies.controlPlane.sessionOpen(hostId, push.sessionId)))
    return error(410, "notification_gone", "The phone no longer receives notifications.");
  switch (yield* dependencies.relay.sender.sendNotification(push)) {
    case "sent":
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    case "gone":
      return error(410, "notification_gone", "The phone no longer receives notifications.");
    case "rejected":
      return error(400, "notification_rejected", "The notification was refused.");
    case "unavailable":
      return error(503, "notification_unavailable", "The notification was not accepted now.");
  }
});

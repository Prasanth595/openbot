import { createFileRoute } from "@tanstack/solid-router";
import { relayAndroidNotification } from "../../../../../server/android-notification-route";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  remoteControlPlaneErrorResponse,
  requestFcmRelay,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/android-notification")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          relayAndroidNotification(request, params.hostId, {
            controlPlane: requestRemoteControlPlane(),
            relay: requestFcmRelay(),
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});

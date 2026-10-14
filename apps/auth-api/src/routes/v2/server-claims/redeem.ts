import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { authErrorResponse, json, requestAuthService, requestSourceIp } from "../../../server/request-auth";

/** A server exchanges an operator's claim for a session of the claim's user. */
export const Route = createFileRoute("/v2/server-claims/redeem")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            return json(yield* requestAuthService().redeemServerClaim(body.claim, requestSourceIp(request)));
          }),
          authErrorResponse,
        ),
    },
  },
});

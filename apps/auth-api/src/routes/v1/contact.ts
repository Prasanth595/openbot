import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { sendContactMessage } from "../../server/contact-message";
import { runApiResponse } from "../../server/effect-runtime";
import { isSameOriginReportRequest } from "../../server/hosted-site-report-request";
import { readJsonObject } from "../../server/json-body";
import { apiError, authErrorResponse, requestContactMessageServices, requestSourceIp } from "../../server/request-auth";

// The contact form on `/contact`. Only that page can send: the route needs no sign-in, so it checks
// the origin as the site report form does.
export const Route = createFileRoute("/v1/contact")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!isSameOriginReportRequest(request)) {
              return apiError(403, "invalid_contact_origin", "Open the contact form on openbot.run.");
            }
            const services = requestContactMessageServices();
            if (!services) return apiError(503, "contact_unavailable", "The contact form is unavailable.");
            const body = yield* readJsonObject(request);
            yield* sendContactMessage(services, body, requestSourceIp(request));
            return new Response(null, { status: 204 });
          }),
          authErrorResponse,
        ),
    },
  },
});

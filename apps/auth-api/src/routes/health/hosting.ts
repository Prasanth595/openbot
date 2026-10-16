import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { BoatClient } from "../../server/boat-client";
import { runApiResponse } from "../../server/effect-runtime";
import { apiError } from "../../server/request-auth";
import { requireWorkerBindings } from "../../server/types";

/**
 * A sandbox ID that does not exist. A 404 for it shows that boat answers and accepts the key,
 * and the read changes nothing.
 */
const PROBE_SANDBOX_ID = "openbot-status-probe";

/** The status page checks every 5 minutes, but the route is public, so boat gets one call a minute at most. */
const CACHE_SECONDS = 60;

const hostingResponse = (healthy: boolean) =>
  Response.json(
    healthy
      ? { service: "openbot-hosted-servers", status: "ok" }
      : { error: { code: "hosting_not_ready", message: "Hosted servers are not available." } },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}`, "X-Content-Type-Options": "nosniff" },
    },
  );

export const Route = createFileRoute("/health/hosting")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            // One cache entry for every query string, so a query cannot skip the cache.
            const cacheKey = new Request(new URL("/health/hosting", request.url));
            const cache = yield* Effect.promise(() => caches.open("health-hosting"));
            const cached = yield* Effect.promise(() => cache.match(cacheKey));
            if (cached) return cached;

            const apiKey = requireWorkerBindings(env).BOAT_API_KEY?.trim();
            const healthy = apiKey
              ? yield* new BoatClient({ apiKey }).getSandbox(PROBE_SANDBOX_ID).pipe(
                  Effect.as(true),
                  Effect.catchTag("BoatApiError", (error) => Effect.succeed(error.status === 404)),
                )
              : false;
            const response = hostingResponse(healthy);
            yield* Effect.promise(() => cache.put(cacheKey, response.clone()));
            return response;
          }),
          () => apiError(503, "hosting_not_ready", "Hosted servers are not available."),
        ),
    },
  },
});

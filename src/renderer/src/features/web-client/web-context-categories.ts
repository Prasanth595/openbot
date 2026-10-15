import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { readContextCategories, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";

/** Captures the current joined host. An unsupported or replaced host cannot supply a meter. */
export function createWebContextCategoryRead(options: {
  request: () => TeamApiRequest;
  enabled: () => boolean;
  hostId: () => string;
}): OpenBotDesktopApi["agent"]["readContextCategories"] {
  return async (input) => {
    if (!options.enabled()) return null;
    const owner = options.hostId();
    const value = await runTeamEffect(
      readContextCategories(options.request(), input).pipe(Effect.mapError((error) => error.cause)),
    );
    return options.hostId() === owner && options.enabled() ? value : null;
  };
}

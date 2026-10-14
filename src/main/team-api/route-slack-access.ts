import { SLACK_ACCESS_CAPABILITY, SLACK_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/slack-access-v1";
import { sourceText } from "@openbot/i18n/source";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** The optional side route keeps actual grants out of released connectors-v1 messages. */
export async function routeSlackAccess(
  context: TeamApiRequestContext,
  messaging: Pick<MessagingService, "slackAccessOverview"> | undefined,
): Promise<RouteOutcome> {
  if (context.method !== "POST" || context.url.pathname !== SLACK_ACCESS_ROUTES.overview) return "unmatched";
  if (!messaging || !context.capabilities.has(SLACK_ACCESS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(context.member);
  await readJson(context.request);
  return context.json(200, messaging.slackAccessOverview());
}

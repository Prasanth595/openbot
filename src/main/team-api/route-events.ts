import { EVENTS_CAPABILITY, EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import {
  ROUTINE_RECOVERY_CAPABILITY,
  ROUTINE_RECOVERY_ROUTES,
} from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { type HostEventsApi, HostEventsFailure, hostEventsFailureMessage } from "../host-events-api";
import {
  parseEventRoutineRef,
  parseListEventActivity,
  parseListEventRoutineRuns,
  parseListEventRoutines,
  parseSaveEventRoutine,
} from "../host-events-inputs";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const EVENT_ROUTE_PATHS = new Set<string>(Object.values(EVENTS_ROUTES));
const RECOVERY_ROUTE_PATHS = new Set<string>(Object.values(ROUTINE_RECOVERY_ROUTES));

export interface EventsRouteDependencies {
  events?: HostEventsApi | undefined;
}

async function runEventsEffect<A>(operation: Effect.Effect<A, HostEventsFailure>): Promise<A> {
  try {
    return await Effect.runPromise(operation);
  } catch (error) {
    // An internal failure goes to the dispatcher, which logs it and returns a generic 500.
    const message = error instanceof HostEventsFailure ? hostEventsFailureMessage(error) : null;
    if (message !== null) throw new HttpError(400, message);
    throw error;
  }
}

function parseEventsInput<A>(parse: () => A): A {
  try {
    return parse();
  } catch {
    throw new HttpError(400, sourceText("error.backend.webhookSettingsInvalid"));
  }
}

export async function routeEvents(
  context: TeamApiRequestContext,
  { events }: EventsRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  const recovery = RECOVERY_ROUTE_PATHS.has(path);
  if ((!recovery && !EVENT_ROUTE_PATHS.has(path)) || method !== "POST") return "unmatched";
  if (!events || !capabilities.has(recovery ? ROUTINE_RECOVERY_CAPABILITY : EVENTS_CAPABILITY)) {
    throw new HttpError(400, sourceText("error.backend.eventsUnavailable"));
  }
  requireAdmin(member);
  const body = await readJson(request);
  const input = <A>(parse: (value: unknown) => A): A => parseEventsInput(() => parse(body));
  switch (path) {
    case EVENTS_ROUTES.status:
      return json(200, await runEventsEffect(events.getStatus()));
    // The recovery routes answer as the events routes do; only their wire codecs keep `missedPolicy`.
    case EVENTS_ROUTES.listRoutines:
    case ROUTINE_RECOVERY_ROUTES.listRoutines:
      return json(200, await runEventsEffect(events.listRoutines(input(parseListEventRoutines))));
    case EVENTS_ROUTES.saveRoutine:
    case ROUTINE_RECOVERY_ROUTES.saveRoutine:
      return json(200, await runEventsEffect(events.saveRoutine(input(parseSaveEventRoutine))));
    case ROUTINE_RECOVERY_ROUTES.listRuns:
      return json(200, await runEventsEffect(events.listRoutineRuns(input(parseListEventRoutineRuns))));
    case EVENTS_ROUTES.deleteRoutine:
      await runEventsEffect(events.deleteRoutine(input(parseEventRoutineRef)));
      return json(200, {});
    case EVENTS_ROUTES.testRoutine:
      await runEventsEffect(events.testRoutine(input(parseEventRoutineRef)));
      return json(200, {});
    case EVENTS_ROUTES.rotateSecret:
      return json(200, await runEventsEffect(events.rotateSecret(input(parseEventRoutineRef))));
    case EVENTS_ROUTES.listActivity:
      return json(200, await runEventsEffect(events.listActivity(input(parseListEventActivity))));
  }
  return "unmatched";
}

import type {
  EventActivity,
  EventRoutine,
  EventRoutineRef,
  EventRoutineRun,
  EventStatus,
  ListEventActivityInput,
  ListEventRoutineRunsInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  WebhookSecret,
} from "@openbot/contracts/ipc-events";
import { runTeamEffect } from "@openbot/team-client";
import {
  deleteEventRoutine,
  getEventStatus,
  listEventActivity,
  listEventRoutineRuns,
  listEventRoutines,
  rotateEventRoutineSecret,
  saveEventRoutine,
  testEventRoutine,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";

/** The webhook operations of one host that the routine editor uses. Every action names its routine. */
export interface RoutineWebhooksApi {
  getStatus: () => Promise<EventStatus>;
  rotateSecret: (input: EventRoutineRef) => Promise<WebhookSecret>;
  listActivity: (input: ListEventActivityInput) => Promise<EventActivity[]>;
}

/** The event routine operations of one host: the routines themselves, their webhooks and their activity. */
export interface EventRoutinesApi extends RoutineWebhooksApi {
  listRoutines: (input: ListEventRoutinesInput) => Promise<EventRoutine[]>;
  saveRoutine: (input: SaveEventRoutineInput) => Promise<SaveEventRoutineResult>;
  deleteRoutine: (input: EventRoutineRef) => Promise<void>;
  testRoutine: (input: EventRoutineRef) => Promise<void>;
  /**
   * Set for a remote host with `routine-recovery-v1`: the routine's runs with its missed occurrences.
   * The same host also reads and saves `missedPolicy`.
   */
  readonly listRuns?: ((input: ListEventRoutineRunsInput) => Promise<EventRoutineRun[]>) | undefined;
}

/**
 * The desktop adapter for the server-scoped `events` group. Main picks the `routine-recovery-v1`
 * routes for a host that has them; `recovery` adds the run list of those routes.
 */
export function desktopEventRoutinesApi(serverId: string, recovery = false): EventRoutinesApi {
  const events = window.openbot.events;
  return {
    ...(recovery ? { listRuns: (input: ListEventRoutineRunsInput) => events.listRoutineRuns(input, serverId) } : {}),
    getStatus: () => events.getStatus(serverId),
    listRoutines: (input) => events.listRoutines(input, serverId),
    saveRoutine: (input) => events.saveRoutine(input, serverId),
    deleteRoutine: (input) => events.deleteRoutine(input, serverId),
    testRoutine: (input) => events.testRoutine(input, serverId),
    rotateSecret: (input) => events.rotateSecret(input, serverId),
    listActivity: (input) => events.listActivity(input, serverId),
  };
}

/**
 * The browser adapter. A failed call rejects with the host's error, not the transport wrapper.
 * `recovery` reads at call time whether the connected host has `routine-recovery-v1`.
 */
export function webEventRoutinesApi(request: TeamApiRequest, recovery: () => boolean = () => false): EventRoutinesApi {
  const run = <A>(effect: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  const listRuns = (input: ListEventRoutineRunsInput) => run(listEventRoutineRuns(request, input));
  return {
    get listRuns() {
      return recovery() ? listRuns : undefined;
    },
    getStatus: () => run(getEventStatus(request)),
    listRoutines: (input) => run(listEventRoutines(request, input, recovery())),
    saveRoutine: (input) => run(saveEventRoutine(request, input, recovery())),
    deleteRoutine: (input) => run(deleteEventRoutine(request, input)),
    testRoutine: (input) => run(testEventRoutine(request, input)),
    rotateSecret: (input) => run(rotateEventRoutineSecret(request, input)),
    listActivity: (input) => run(listEventActivity(request, input)),
  };
}

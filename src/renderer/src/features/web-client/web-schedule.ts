import { CHANNEL_CHATS_CAPABILITY, isRoutine, isRoutineRun, type RoutineCalendarOwner } from "@openbot/contracts/ipc";
import { guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { runTeamEffect } from "@openbot/team-client";
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import { type TeamApiRequest, TeamRequestError } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { changesSchedule, type ScheduleSource } from "../schedule/schedule-port";
import type { WebWorkspace } from "./web-client-context";

const decodeRoutines = guardedListDecoder(isRoutine, "routine list");
const decodeRoutineRuns = guardedListDecoder(isRoutineRun, "routine run list");

/**
 * The schedule on the web: the calendar of the connected host, from the routes that its routine
 * settings already use. A host from before channels has no channel routes; its agents still have routines.
 */
export function webScheduleSource(
  workspace: Pick<WebWorkspace, "state" | "runtime" | "onHostEvent">,
  hostRequest: (serverId?: string) => TeamApiRequest,
): ScheduleSource {
  const call = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: (cause) => new TeamRequestError({ cause }) });

  function source(serverId: string): RoutineCalendarSource<TeamRequestError> {
    const request = hostRequest(serverId);
    const channels = workspace.state.capabilities.includes(CHANNEL_CHATS_CAPABILITY)
      ? workspace.runtime.channels
      : undefined;
    return {
      owners: () =>
        Effect.gen(function* () {
          const [agents, channelList] = yield* Effect.all(
            [call(() => workspace.runtime.listAgents()), call(async () => (channels ? channels.listChannels() : []))],
            { concurrency: "unbounded" },
          );
          return [
            ...agents.map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
            ...channelList
              .filter((channel) => !channel.archived)
              .map((channel): RoutineCalendarOwner => ({ kind: "channel", channelId: channel.id })),
          ];
        }),
      routines: (owner) =>
        owner.kind === "agent"
          ? call(() => request("GET", TEAM_API_ROUTES.agent.routines(owner.agentId), decodeRoutines))
          : call(async () => (channels ? channels.listChannelRoutines(owner.channelId) : [])),
      runs: (owner, routineId, limit) =>
        owner.kind === "agent"
          ? call(() =>
              request(
                "GET",
                `${TEAM_API_ROUTES.agent.routineRuns(owner.agentId, routineId)}?limit=${limit}`,
                decodeRoutineRuns,
              ),
            )
          : call(async () =>
              channels ? channels.listChannelRoutineRuns({ channelId: owner.channelId, routineId, limit }) : [],
            ),
    };
  }

  return {
    calendar: (input, serverId) =>
      runTeamEffect(
        buildRoutineCalendar({ from: new Date(input.from), to: new Date(input.to) }, new Date(), source(serverId)).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    onStale: (serverId, stale) =>
      workspace.onHostEvent((event) => {
        if (workspace.state.host?.hostId !== serverId) return;
        // A snapshot comes after a reconnect: a run can end while the host is away.
        if (event.type === "runtime-snapshot" || changesSchedule(event)) stale();
      }),
  };
}

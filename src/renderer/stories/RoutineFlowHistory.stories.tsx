import {
  type AgentSummary,
  isAgentSummary,
  isRoutineFlowCanvas,
  type RoutineFlowCanvas,
  type RoutineFlowStep,
  type RoutineRun,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  ROUTINE_FLOW_HISTORY_CAPABILITY,
  ROUTINE_FLOW_HISTORY_ROUTES,
} from "@openbot/contracts/team-protocol/routine-flow-history-v1";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { teamRoutineFlowHistoryApi } from "@openbot/team-client/routine-flow-history";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { DiagramInspector } from "@openbot/ui/features/diagrams/DiagramInspector";
import type { DiagramRoutineHistory, DiagramRoutineHistoryState } from "@openbot/ui/features/diagrams/diagram-model";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, onSettled, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { toAgentProfile } from "../src/app-message-projection";
import { routineFlowDiagram } from "../src/features/routine-flows/routine-flow-diagram";
import { RoutineFlowHistoryController } from "../src/features/routine-flows/routine-flow-history-controller";
import { desktopRoutineFlowsHost, type RoutineFlowsHost } from "../src/features/routine-flows/routine-flows-port";
import { webRoutineFlowsHost } from "../src/features/web-client/web-routine-flows";
import { createMockOpenBot } from "../src/preview/mock-openbot";
import { requireFixture, STORY_AGENTS } from "./fixtures";

interface Args {
  transport: "desktop" | "web";
  unavailable: boolean;
  variant: "normal" | "empty" | "loading" | "error" | "large";
}

const ownerProfile = requireFixture(STORY_AGENTS[0], "history story owner");
const owner: AgentSummary = {
  ...ownerProfile,
  workspacePath: ownerProfile.workspacePath ?? "",
  updatedAt: ownerProfile.updatedAt ?? null,
};
const at = "2026-10-01T09:00:00.000Z";
const routineId = "history-story-routine";
const run: RoutineRun = {
  id: "history-story-run",
  agentId: owner.id,
  routineId,
  triggerId: null,
  deliveryId: null,
  kind: "manual",
  scheduledFor: at,
  routineName: "Stored brief",
  instruction: "Read a synthetic brief.",
  status: "succeeded",
  error: null,
  createdAt: at,
  updatedAt: at,
};
const step: RoutineFlowStep = {
  id: "history-story-step",
  runId: run.id,
  agentId: owner.id,
  deliveryId: null,
  status: "succeeded",
  input: "Stored input",
  output: "Stored output",
  error: null,
  createdAt: at,
  updatedAt: at,
};
const canvas: RoutineFlowCanvas = {
  agentId: owner.id,
  routines: [
    {
      routine: {
        id: routineId,
        agentId: owner.id,
        name: "Stored brief",
        instruction: "Read a synthetic brief.",
        active: false,
        timezone: "UTC",
        trigger: { kind: "schedule", schedule: { kind: "hourly", minute: 0 } },
        createdAt: at,
        updatedAt: at,
      },
      recentRuns: [run],
      upcomingRuns: [],
      steps: [step],
    },
  ],
  links: [],
  positions: [],
  placedAgentIds: [],
};

function Fixture(props: Args) {
  const { t, errorMessage } = useText();
  const initial = structuredClone(canvas);
  const [source, setSource] = createStore<{
    canvas: RoutineFlowCanvas;
    agents: AgentSummary[];
    error: string | null;
    ready: boolean;
  }>({ canvas: initial, agents: [owner], error: null, ready: false });
  const [state, setState] = createStore<DiagramRoutineHistoryState>({
    routineNodeId: null,
    page: { kind: "idle" },
    selected: { kind: "idle" },
  });
  const previousApi = window.openbot;
  let host: RoutineFlowsHost | null = null;
  let disposed = false;
  let sourceGeneration = 0;
  let activeVariant: Args["variant"] = "normal";
  let routineOwners = new Map<string, { agentId: string; routineId: string }>();
  const controller = new RoutineFlowHistoryController(
    () => {
      if (!host) throw new Error("The fixture host is not ready.");
      return host.history;
    },
    (next) =>
      setState((draft) => {
        draft.routineNodeId = next.routineNodeId;
        draft.page = next.page;
        draft.selected = next.selected;
      }),
    (error) => errorMessage(error, t("diagram.history.loadFailed")),
  );
  const fixtureHost = new URL(window.location.href).searchParams.get("historyFixtureHost");
  const remoteOrigin = fixtureHost && /^http:\/\/127\.0\.0\.1:\d+$/u.test(fixtureHost) ? fixtureHost : null;
  const setup = (current: RoutineFlowCanvas, agents: AgentSummary[], args: Args) => {
    const routine =
      current.routines.find((entry) => entry.routine.name === "History fixture brief") ?? current.routines[0];
    if (!routine) throw new Error("A fixture routine is required.");
    const schedule =
      routine.routine.trigger.kind === "schedule"
        ? routine.routine.trigger.schedule
        : { kind: "hourly" as const, minute: 0 };
    const preview = createMockOpenBot({
      agents,
      routines: {
        [routine.routine.agentId]: [
          {
            ...routine.routine,
            trigger: {
              schedule,
              id: "history-fixture-trigger",
              routineId: routine.routine.id,
              nextRunAt: at,
              createdAt: at,
              updatedAt: at,
            },
          },
        ],
      },
      routineRuns: { [routine.routine.id]: routine.recentRuns },
      routineFlowSteps:
        args.variant === "large"
          ? routine.steps.map((entry) => ({ ...entry, output: "文".repeat(100000) }))
          : routine.steps,
    });
    const request: TeamApiRequest = async (_method, path, decode, body) => {
      if (args.variant === "error") throw new Error("Synthetic history read failed.");
      if (args.variant === "loading") await new Promise<never>(() => undefined);
      if (remoteOrigin) {
        const response = await fetch(remoteOrigin + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [TEAM_PROTOCOL_VERSION_HEADER]: "7",
            [TEAM_CAPABILITIES_HEADER]: ROUTINE_FLOW_HISTORY_CAPABILITY,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("The synthetic host refused the read.");
        return decode(await response.json());
      }
      const input = body;
      const parsed =
        path === ROUTINE_FLOW_HISTORY_ROUTES.page
          ? await preview.api.routineFlowHistory.page(parseHistory(input))
          : await preview.api.routineFlowHistory.run(parseHistoryRun(input));
      return decode(parsed);
    };
    const historyApi = teamRoutineFlowHistoryApi(request);
    window.openbot = {
      ...preview.api,
      routineFlowHistory: {
        page: (input, serverId) => {
          if (serverId !== "fixture-history-host") throw new Error("The desktop fixture lost its server scope.");
          return historyApi.page(input);
        },
        run: (input, serverId) => {
          if (serverId !== "fixture-history-host") throw new Error("The desktop fixture lost its server scope.");
          return historyApi.run(input);
        },
      },
    };
    host =
      args.transport === "desktop"
        ? desktopRoutineFlowsHost(
            "fixture-history-host",
            () => false,
            () => !args.unavailable,
          )
        : webRoutineFlowsHost(
            {
              routineFlows: preview.api.routineFlows,
              routineFlowHistory: { available: () => !args.unavailable, api: historyApi },
              updateRoutine: preview.api.agent.updateRoutine,
              testRoutine: preview.api.agent.testRoutine,
              conversation: async () => {
                throw new Error("The history fixture does not read a conversation.");
              },
              send: async () => {
                throw new Error("The history fixture does not send work.");
              },
            },
            () => () => undefined,
            () => undefined,
          );
    if (!host) throw new Error("The fixture host is unavailable.");
    activeVariant = args.variant;
    routineOwners = new Map(
      current.routines.map((entry) => [
        `routine:${entry.routine.id}`,
        { agentId: entry.routine.agentId, routineId: entry.routine.id },
      ]),
    );
    setSource((draft) => {
      draft.canvas = current;
      draft.agents = agents;
      draft.error = null;
      draft.ready = true;
    });
  };
  createEffect(
    (): Args => ({ transport: props.transport, unavailable: props.unavailable, variant: props.variant }),
    (args) => {
      const generation = ++sourceGeneration;
      controller.reset();
      setSource((draft) => {
        draft.ready = false;
        draft.error = null;
      });
      if (remoteOrigin) {
        void fetch(`${remoteOrigin}/fixture/source`, { signal: AbortSignal.timeout(10000) })
          .then(async (response) => {
            if (!response.ok) throw new Error("The synthetic history source is unavailable.");
            const value = await response.json();
            if (
              !isDynamicRecord(value) ||
              !isRoutineFlowCanvas(value.canvas) ||
              !Array.isArray(value.agents) ||
              !value.agents.every(isAgentSummary)
            )
              throw new Error("Invalid synthetic history source.");
            if (!disposed && generation === sourceGeneration) setup(value.canvas, value.agents, args);
          })
          .catch((error: unknown) => {
            if (!disposed && generation === sourceGeneration)
              setSource((draft) => {
                draft.error = errorMessage(error, t("diagram.history.loadFailed"));
              });
          });
      } else {
        const local = structuredClone(canvas);
        if (args.variant === "empty") {
          const first = local.routines[0];
          if (first) {
            first.recentRuns = [];
            first.steps = [];
          }
        }
        setup(local, [owner], args);
      }
    },
  );
  onSettled(() => () => {
    disposed = true;
    sourceGeneration += 1;
    controller.reset();
    window.openbot = previousApi;
  });
  const diagram = createMemo(() => routineFlowDiagram(source.canvas, source.agents.map(toAgentProfile)));
  const routineNode = () =>
    `routine:${source.canvas.routines.find((entry) => entry.routine.name === "History fixture brief")?.routine.id ?? source.canvas.routines[0]?.routine.id ?? routineId}`;
  const history: DiagramRoutineHistory = {
    state,
    onOpen: (node) => {
      const routine = routineOwners.get(node);
      const variant = activeVariant;
      const generation = sourceGeneration;
      if (routine && host)
        void controller.open(node, routine.agentId, routine.routineId).then(() => {
          if (generation === sourceGeneration && variant === "large" && controller.state.page.kind === "ready") {
            const first = controller.state.page.runs[0];
            if (first) void controller.select(first);
          }
        });
    },
    onClose: (node) => {
      if (controller.state.routineNodeId === node) controller.reset();
    },
    onSelect: (selected) => {
      void controller.select(selected);
    },
    onMoreRuns: () => {
      void controller.moreRuns();
    },
    onMoreSteps: () => {
      void controller.moreSteps();
    },
  };
  return (
    <div class="diagram-view-body" style={{ height: "100vh", width: "100%" }}>
      <Show when={source.error}>{(error) => <p role="alert">{error()}</p>}</Show>
      <Show when={source.ready}>
        <DiagramInspector
          diagram={diagram()}
          agents={source.agents.map(toAgentProfile)}
          selectedNodeId={routineNode()}
          focusRoutineId={routineNode()}
          now={new Date(at)}
          onSelectNode={() => undefined}
          onFocusRoutine={() => undefined}
          history={history}
        />
      </Show>
    </div>
  );
}

import {
  isRoutineFlowHistoryInput,
  isRoutineFlowHistoryRunInput,
  type RoutineFlowHistoryInput,
  type RoutineFlowHistoryRunInput,
} from "@openbot/contracts/ipc-routine-flow-history";

function parseHistory(value: unknown): RoutineFlowHistoryInput {
  if (!isRoutineFlowHistoryInput(value)) throw new Error("Invalid fixture history request.");
  return value;
}
function parseHistoryRun(value: unknown): RoutineFlowHistoryRunInput {
  if (!isRoutineFlowHistoryRunInput(value)) throw new Error("Invalid fixture history run request.");
  return value;
}

const meta = {
  title: "Features/Routine flow history",
  component: Fixture,
  args: { transport: "desktop", unavailable: false, variant: "normal" },
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;
export const ControllerFixture: Story = {};
export const Web: Story = { args: { transport: "web" } };
export const OldHost: Story = { args: { unavailable: true } };
export const Empty: Story = { args: { variant: "empty" } };
export const Loading: Story = { args: { variant: "loading" } };
export const ReadError: Story = { args: { variant: "error" } };
export const LargeText: Story = { args: { variant: "large" } };

import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { RoutineFlowHistoryRun } from "@openbot/contracts/ipc-routine-flow-history";
import type { DiagramRoutineHistoryState } from "@openbot/ui/features/diagrams/diagram-model";

export interface RoutineFlowHistoryHost {
  available(): boolean;
  api: OpenBotDesktopApi["routineFlowHistory"];
}

/** Owns one inspector's history. Run selection never changes the canvas or starts work. */
export class RoutineFlowHistoryController {
  readonly #host: () => RoutineFlowHistoryHost;
  readonly #changed: (state: DiagramRoutineHistoryState) => void;
  readonly #errorMessage: (error: unknown) => string;
  #generation = 0;
  #selection = 0;
  #owner: { agentId: string; routineId: string } | null = null;
  #state: DiagramRoutineHistoryState = { routineNodeId: null, page: { kind: "idle" }, selected: { kind: "idle" } };

  constructor(
    host: () => RoutineFlowHistoryHost,
    changed: (state: DiagramRoutineHistoryState) => void,
    errorMessage: (error: unknown) => string,
  ) {
    this.#host = host;
    this.#changed = changed;
    this.#errorMessage = errorMessage;
  }

  get state(): DiagramRoutineHistoryState {
    return this.#state;
  }

  #publish(state: DiagramRoutineHistoryState): void {
    this.#state = state;
    this.#changed(state);
  }

  reset(): void {
    this.#generation += 1;
    this.#selection += 1;
    this.#owner = null;
    this.#publish({ routineNodeId: null, page: { kind: "idle" }, selected: { kind: "idle" } });
  }

  async open(routineNodeId: string, agentId: string, routineId: string): Promise<void> {
    const generation = ++this.#generation;
    this.#selection += 1;
    this.#owner = { agentId, routineId };
    if (!this.#host().available()) {
      this.#publish({ routineNodeId, page: { kind: "unavailable" }, selected: { kind: "idle" } });
      return;
    }
    this.#publish({ routineNodeId, page: { kind: "loading" }, selected: { kind: "idle" } });
    try {
      const page = await this.#host().api.page({ agentId, routineId });
      if (generation !== this.#generation) return;
      if (page.agentId !== agentId || page.routineId !== routineId)
        throw new Error("Invalid routine history destination.");
      this.#publish({
        routineNodeId,
        page: { kind: "ready", runs: page.runs, nextCursor: page.nextCursor, loadingMore: false, error: null },
        selected: { kind: "idle" },
      });
    } catch (error) {
      if (generation === this.#generation)
        this.#publish({
          routineNodeId,
          page: { kind: "error", error: this.#errorMessage(error) },
          selected: { kind: "idle" },
        });
    }
  }

  async moreRuns(): Promise<void> {
    const page = this.#state.page;
    const owner = this.#owner;
    if (page.kind !== "ready" || !page.nextCursor || page.loadingMore || !owner) return;
    const generation = this.#generation;
    this.#publish({ ...this.#state, page: { ...page, loadingMore: true, error: null } });
    try {
      const next = await this.#host().api.page({ ...owner, cursor: page.nextCursor });
      if (generation !== this.#generation) return;
      if (next.agentId !== owner.agentId || next.routineId !== owner.routineId)
        throw new Error("Invalid routine history destination.");
      const current = this.#state.page;
      if (current.kind !== "ready") return;
      const ids = new Set(current.runs.map((run) => run.id));
      this.#publish({
        ...this.#state,
        page: {
          kind: "ready",
          runs: [...current.runs, ...next.runs.filter((run) => !ids.has(run.id))],
          nextCursor: next.nextCursor,
          loadingMore: false,
          error: null,
        },
      });
    } catch (error) {
      if (generation === this.#generation && this.#state.page.kind === "ready")
        this.#publish({
          ...this.#state,
          page: { ...this.#state.page, loadingMore: false, error: this.#errorMessage(error) },
        });
    }
  }

  async select(run: RoutineFlowHistoryRun): Promise<void> {
    const owner = this.#owner;
    if (!owner || run.agentId !== owner.agentId || run.routineId !== owner.routineId) return;
    const generation = this.#generation;
    const selection = ++this.#selection;
    this.#publish({ ...this.#state, selected: { kind: "loading", runId: run.id } });
    try {
      const result = await this.#host().api.run({ ...owner, runId: run.id });
      if (generation !== this.#generation || selection !== this.#selection) return;
      if (result.run.id !== run.id || result.run.agentId !== owner.agentId || result.run.routineId !== owner.routineId)
        throw new Error("Invalid routine history destination.");
      this.#publish({
        ...this.#state,
        selected: {
          kind: "ready",
          run: result.run,
          steps: result.steps,
          nextCursor: result.nextCursor,
          loadingMore: false,
          error: null,
        },
      });
    } catch (error) {
      if (generation === this.#generation && selection === this.#selection)
        this.#publish({ ...this.#state, selected: { kind: "error", runId: run.id, error: this.#errorMessage(error) } });
    }
  }

  async moreSteps(): Promise<void> {
    const selected = this.#state.selected;
    const owner = this.#owner;
    if (selected.kind !== "ready" || !selected.nextCursor || selected.loadingMore || !owner) return;
    const generation = this.#generation;
    const selection = this.#selection;
    this.#publish({ ...this.#state, selected: { ...selected, loadingMore: true, error: null } });
    try {
      const result = await this.#host().api.run({ ...owner, runId: selected.run.id, cursor: selected.nextCursor });
      if (generation !== this.#generation || selection !== this.#selection) return;
      if (
        result.run.id !== selected.run.id ||
        result.run.agentId !== owner.agentId ||
        result.run.routineId !== owner.routineId
      )
        throw new Error("Invalid routine history destination.");
      const current = this.#state.selected;
      if (current.kind !== "ready") return;
      const ids = new Set(current.steps.map((step) => step.id));
      this.#publish({
        ...this.#state,
        selected: {
          kind: "ready",
          run: result.run,
          steps: [...current.steps, ...result.steps.filter((step) => !ids.has(step.id))],
          nextCursor: result.nextCursor,
          loadingMore: false,
          error: null,
        },
      });
    } catch (error) {
      if (generation === this.#generation && selection === this.#selection && this.#state.selected.kind === "ready")
        this.#publish({
          ...this.#state,
          selected: { ...this.#state.selected, loadingMore: false, error: this.#errorMessage(error) },
        });
    }
  }
}

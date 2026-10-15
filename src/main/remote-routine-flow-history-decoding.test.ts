import { describe, expect, it } from "vitest";
import {
  decodeRemoteRoutineFlowHistoryPage,
  decodeRemoteRoutineFlowHistoryRun,
} from "./remote-routine-flow-history-decoding";

const run = {
  id: "run-a",
  agentId: "owner-a",
  routineId: "routine-a",
  kind: "scheduled",
  status: "cancelled",
  scheduledFor: "2026-10-01T09:00:00.000Z",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:01.000Z",
};

describe("routine history host boundary", () => {
  it("refuses malformed cursors, row overflow and foreign owners", () => {
    const page = { agentId: "owner-a", routineId: "routine-a", runs: [run], nextCursor: null };
    expect(decodeRemoteRoutineFlowHistoryPage(page)).toEqual(page);
    expect(() =>
      decodeRemoteRoutineFlowHistoryPage({ ...page, nextCursor: { id: "run-a", createdAt: "invalid" } }),
    ).toThrow();
    expect(() =>
      decodeRemoteRoutineFlowHistoryPage({ ...page, runs: Array.from({ length: 21 }, () => run) }),
    ).toThrow();
    expect(() => decodeRemoteRoutineFlowHistoryPage({ ...page, runs: [{ ...run, agentId: "hidden" }] })).toThrow();
  });
  it("refuses missing truncation flags and extra host payload", () => {
    const page = { run, steps: [], nextCursor: null };
    expect(decodeRemoteRoutineFlowHistoryRun(page)).toEqual(page);
    const step = {
      id: "step-a",
      runId: run.id,
      agentId: run.agentId,
      status: "cancelled",
      input: "",
      output: null,
      error: null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
    expect(() => decodeRemoteRoutineFlowHistoryRun({ ...page, steps: [step] })).toThrow();
    expect(() =>
      decodeRemoteRoutineFlowHistoryRun({ ...page, run: { ...run, instruction: "private provider payload" } }),
    ).toThrow();
  });
});

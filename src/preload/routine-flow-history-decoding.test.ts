import { describe, expect, it } from "vitest";
import { decodeRoutineFlowHistoryPage, decodeRoutineFlowHistoryRun } from "./routine-flow-history-decoding";

const run = {
  id: "run-a",
  agentId: "owner-a",
  routineId: "routine-a",
  kind: "manual",
  status: "succeeded",
  scheduledFor: "2026-10-01T09:00:00.000Z",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:01.000Z",
};
const step = {
  id: "step-a",
  runId: "run-a",
  agentId: "owner-a",
  status: "succeeded",
  input: "Brief",
  output: "Stored answer",
  error: null,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
  truncated: { input: false, output: false, error: false },
};

describe("routine history preload boundary", () => {
  it("refuses foreign run metadata and extra privileged fields", () => {
    const page = { agentId: "owner-a", routineId: "routine-a", runs: [run], nextCursor: null };
    expect(decodeRoutineFlowHistoryPage(page)).toEqual(page);
    expect(() => decodeRoutineFlowHistoryPage({ ...page, runs: [{ ...run, routineId: "other" }] })).toThrow();
    expect(() =>
      decodeRoutineFlowHistoryPage({ ...page, runs: [{ ...run, webhookUrl: "synthetic-private" }] }),
    ).toThrow();
  });
  it("refuses foreign steps, UTF-8 overflow and oversized pages", () => {
    const page = { run, steps: [step], nextCursor: null };
    expect(decodeRoutineFlowHistoryRun(page)).toEqual(page);
    expect(() => decodeRoutineFlowHistoryRun({ ...page, steps: [{ ...step, runId: "other" }] })).toThrow();
    expect(() => decodeRoutineFlowHistoryRun({ ...page, steps: [{ ...step, output: "文".repeat(1366) }] })).toThrow();
    expect(() => decodeRoutineFlowHistoryRun({ ...page, steps: Array.from({ length: 11 }, () => step) })).toThrow();
    expect(() => decodeRoutineFlowHistoryRun({ ...page, providerPayload: {} })).toThrow();
  });
});

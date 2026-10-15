// Optional read-only history contract. The released routine-flows-v1 canvas stays unchanged.
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const ROUTINE_FLOW_HISTORY_CAPABILITY = "routine-flow-history-v1";
export const ROUTINE_FLOW_HISTORY_ROUTES = {
  page: "/v1/routine-flows/history/page",
  run: "/v1/routine-flows/history/run",
} as const;

const encoder = new TextEncoder();
const timestamp: AdminDecoder = (value) => {
  const decoded = string(64)(value);
  if (typeof decoded !== "string" || !Number.isFinite(Date.parse(decoded)))
    throw new Error("Invalid history timestamp.");
  return decoded;
};
const text: AdminDecoder = (value) => {
  const decoded = string(4_096)(value);
  if (typeof decoded !== "string" || encoder.encode(decoded).byteLength > 4_096)
    throw new Error("Invalid history text.");
  return decoded;
};
const cursor = fields({ createdAt: timestamp, id: identifier });
const request = fields({ agentId: identifier, routineId: identifier }, { cursor });
const runRequest = fields({ agentId: identifier, routineId: identifier, runId: identifier }, { cursor });
const run = fields({
  id: identifier,
  agentId: identifier,
  routineId: identifier,
  kind: oneOf("scheduled", "manual"),
  status: oneOf("queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"),
  scheduledFor: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const step = fields({
  id: identifier,
  runId: identifier,
  agentId: identifier,
  status: oneOf("running", "succeeded", "failed", "skipped", "cancelled"),
  input: text,
  output: nullable(text),
  error: nullable(text),
  createdAt: timestamp,
  updatedAt: timestamp,
  truncated: fields({ input: boolean, output: boolean, error: boolean }),
});
const pageFields = fields({
  agentId: identifier,
  routineId: identifier,
  runs: list(run, 20),
  nextCursor: nullable(cursor),
});
const runFields = fields({ run, steps: list(step, 10), nextCursor: nullable(cursor) });
const page: AdminDecoder = (value) => {
  const decoded = pageFields(value);
  if (
    !isDynamicRecord(decoded) ||
    !Array.isArray(decoded.runs) ||
    !decoded.runs.every(
      (entry) => isDynamicRecord(entry) && entry.agentId === decoded.agentId && entry.routineId === decoded.routineId,
    ) ||
    encoder.encode(JSON.stringify(decoded)).byteLength > 128 * 1_024
  )
    throw new Error("Invalid routine history page.");
  return decoded;
};
const runPage: AdminDecoder = (value) => {
  const decoded = runFields(value);
  if (!isDynamicRecord(decoded) || !isDynamicRecord(decoded.run) || !Array.isArray(decoded.steps))
    throw new Error("Invalid routine history run.");
  const runId = decoded.run.id;
  if (
    !decoded.steps.every((entry) => isDynamicRecord(entry) && entry.runId === runId) ||
    encoder.encode(JSON.stringify(decoded)).byteLength > 128 * 1_024
  )
    throw new Error("Invalid routine history run.");
  return decoded;
};

export const ROUTINE_FLOW_HISTORY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_FLOW_HISTORY_ROUTES.page, adminRoute(request, page)],
  [ROUTINE_FLOW_HISTORY_ROUTES.run, adminRoute(runRequest, runPage)],
]);

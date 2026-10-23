type ChatOpenSource = "team" | "external" | "screen" | "background";
type ChatOpenStage = "connection" | "fetch" | "projection" | "data" | "messages" | "composer" | "navigation";

interface ChatOpenSample {
  id: number;
  source: ChatOpenSource;
  started: number;
  stages: Partial<Record<ChatOpenStage, number>>;
}

// Durations only: no account, agent, message, URL or file content is retained or sent.
const samples: ChatOpenSample[] = [];
let sequence = 0;
let measurement: { key: string; sample: ChatOpenSample } | null = null;
let opening: { key: string; sample: ChatOpenSample; deadline: ReturnType<typeof setTimeout> } | null = null;
const deferred = new Set<() => void>();

function key(serverId: string, agentId: string) {
  return JSON.stringify([serverId, agentId]);
}

function release() {
  if (opening) clearTimeout(opening.deadline);
  opening = null;
  const work = [...deferred];
  deferred.clear();
  for (const run of work) run();
}

export function beginChatOpen(serverId: string, agentId: string, source: ChatOpenSource) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (opening) clearTimeout(opening.deadline);
  const sample: ChatOpenSample = { id: ++sequence, source, started: performance.now(), stages: {} };
  measurement = { key: key(serverId, agentId), sample };
  samples.push(sample);
  if (samples.length > 40) samples.shift();
  opening = {
    key: key(serverId, agentId),
    sample,
    // An unavailable host or a cancelled route must not starve other work indefinitely.
    deadline: setTimeout(release, 2000),
  };
}

export function ensureChatOpen(serverId: string, agentId: string) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (opening?.key !== key(serverId, agentId)) beginChatOpen(serverId, agentId, "screen");
}

export function markChatOpen(serverId: string, agentId: string, stage: ChatOpenStage) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (measurement?.key !== key(serverId, agentId)) return;
  measurement.sample.stages[stage] ??= performance.now() - measurement.sample.started;
  if (opening && measurement.sample.stages.messages !== undefined && measurement.sample.stages.composer !== undefined)
    release();
}

/** A layout followed by two animation frames is a visibility proxy, not a native render trace. */
export function markChatOpenFrame(serverId: string, agentId: string, stage: "messages" | "composer") {
  if (typeof __DEV__ === "undefined" || !__DEV__) return () => undefined;
  const sample = measurement?.sample;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (measurement?.sample === sample) markChatOpen(serverId, agentId, stage);
    });
  });
  return () => cancelAnimationFrame(frame);
}

/** Yield one frame in release builds. Development measurements can wait for the opening layout. */
export function afterChatFirstPaint(work: () => void): () => void {
  let cancelled = false;
  let frame: number | undefined;
  const run = () => {
    frame = requestAnimationFrame(() => {
      if (!cancelled) work();
    });
  };
  if (typeof __DEV__ !== "undefined" && __DEV__ && opening) deferred.add(run);
  else run();
  return () => {
    cancelled = true;
    deferred.delete(run);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

export function resetChatOpenPerformance() {
  if (opening) clearTimeout(opening.deadline);
  opening = null;
  measurement = null;
  deferred.clear();
  samples.length = 0;
}

export function readChatOpenPerformance() {
  return samples.map(({ id, source, stages }) => ({ id, source, stages: { ...stages } }));
}

// The native development harness reads durations only; production exposes no inspector hook.
declare global {
  var __OPENBOT_CHAT_OPEN_PERFORMANCE__: typeof readChatOpenPerformance | undefined;
}
if (typeof __DEV__ !== "undefined" && __DEV__) globalThis.__OPENBOT_CHAT_OPEN_PERFORMANCE__ = readChatOpenPerformance;

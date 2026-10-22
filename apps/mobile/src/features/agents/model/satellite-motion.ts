import { Easing } from "react-native-reanimated";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";

export type SatellitePhase = "idle" | "thinking" | "generating" | "tool" | "done";
export const SATELLITE_PHASES = ["thinking", "generating", "tool", "done"] as const;
export const SATELLITE_MIN_STATE_MS = 600;
export const SATELLITE_DONE_MS = 1200;
const SINE = Easing.bezierFn(0.37, 0, 0.63, 1);
const IN_OUT = Easing.bezierFn(0.65, 0, 0.35, 1);
const IN = Easing.bezierFn(0.55, 0, 1, 0.45);
const OUT = Easing.bezierFn(0.23, 1, 0.32, 1);
const TAU = Math.PI * 2;
const TILT = (-16 * Math.PI) / 180;

export function agentSatellitePhase(activity: MobileAgentActivity | undefined): SatellitePhase {
  if (!activity || activity.phase === "waiting") return "idle";
  if (activity.phase === "finished")
    return activity.completionStatus === "completed" && Date.now() - (activity.finishedAt ?? 0) < SATELLITE_DONE_MS
      ? "done"
      : "idle";
  return activity.phase === "responding" ? "generating" : activity.phase === "tool" ? "tool" : "thinking";
}

function clamp(value: number) {
  "worklet";
  return Math.max(0, Math.min(1, value));
}

/** C satellite geometry, in avatar-size units. No SVG paths change during a loop. */
export function satelliteDot(phase: SatellitePhase, seconds: number, index: number, still: boolean) {
  "worklet";
  let x = 0;
  let y = 0;
  let scale = 1;
  let opacity = 1;
  let front = true;
  if (phase === "thinking") {
    const angle = ((still ? 0 : seconds / 2.4) + index / 3) * TAU;
    const ox = 0.72 * Math.cos(angle);
    const oy = 0.72 * 0.32 * Math.sin(angle);
    x = ox * Math.cos(TILT) - oy * Math.sin(TILT);
    y = ox * Math.sin(TILT) + oy * Math.cos(TILT);
    front = ((angle % TAU) + TAU) % TAU < Math.PI;
  } else if (phase === "generating") {
    const t = (((seconds - index * 0.12) % 1) + 1) % 1;
    const wave = still ? 0 : t < 0.3 ? SINE(t / 0.3) : t < 0.6 ? 1 - SINE((t - 0.3) / 0.3) : 0;
    x = (index - 1) * 0.2;
    y = 0.68 - wave * 0.1;
    opacity = still ? 1 - index * 0.3 : 0.55 + wave * 0.45;
  } else if (phase === "tool" || phase === "done") {
    const step = (seconds % 2.7) / 0.45;
    const rotation = still || phase === "done" ? 0 : (Math.floor(step) + IN_OUT(clamp((step % 1) * 1.5))) / 6;
    const angle = (-0.25 + index / 3 + rotation) * TAU;
    const collapse = phase === "done" ? (still ? 1 : IN(clamp(seconds / 0.32))) : 0;
    x = Math.cos(angle) * 0.62 * (1 - collapse);
    y = Math.sin(angle) * 0.62 * (1 - collapse);
    scale = 1 - collapse * 0.8;
    opacity = 1 - collapse;
  } else opacity = 0;
  return { x, y, scale, opacity, front };
}

export function satelliteEyes(phase: SatellitePhase, seconds: number, small: boolean, still: boolean) {
  "worklet";
  let x = 0;
  let y = 0;
  let sx = 1;
  let sy = 1;
  if (phase === "thinking") {
    const position = ((seconds % 2.4) / 2.4) * 8;
    const angle = (Math.floor(position) * TAU) / 8;
    const next = angle + TAU / 8;
    const fraction = position % 1;
    x = still ? 0.05 : 0.05 * (Math.cos(angle) + (Math.cos(next) - Math.cos(angle)) * fraction);
    y = still ? -0.06 : -0.03 + 0.02 * (Math.sin(angle) + (Math.sin(next) - Math.sin(angle)) * fraction);
    const blink = (seconds % 7.2) / 7.2;
    if (!still && !small && blink > 0.4 && blink < 0.428)
      sy = blink < 0.414 ? 1 - ((blink - 0.4) / 0.014) * 0.9 : 0.1 + ((blink - 0.414) / 0.014) * 0.9;
  } else if (phase === "generating") {
    const scan = (seconds % 4) / 2;
    x = still ? 0 : -0.025 + 0.05 * SINE(scan < 1 ? scan : 2 - scan);
    y = 0.05;
    sy = 0.85;
  } else if (phase === "tool") {
    sx = 1.08;
    sy = 0.55;
    if (!small) {
      const step = ((still ? 0 : seconds) % 2.7) / 0.45;
      const angle = (-0.25 + Math.floor(step) / 6) * TAU;
      const next = angle + TAU / 6;
      const fraction = still ? 0 : IN_OUT(clamp(((step % 1) * 0.45) / 0.12));
      x = 0.035 * (Math.cos(angle) + (Math.cos(next) - Math.cos(angle)) * fraction);
      y = 0.035 * (Math.sin(angle) + (Math.sin(next) - Math.sin(angle)) * fraction);
    }
  } else if (phase === "done" && !still) {
    const t = clamp((seconds - 0.22) / 0.9);
    const smile = t < 0.22 ? OUT(t / 0.22) : t < 0.7 ? 1 : 1 - OUT((t - 0.7) / 0.3);
    x = 0;
    y = -0.015 * smile;
    sx = 1 + 0.12 * smile;
    sy = 1 - 0.62 * smile;
  }
  return { x, y, sx, sy };
}

export function satellitePop(seconds: number) {
  "worklet";
  const t = clamp((seconds - 0.22) / 0.42);
  return 1 + 0.07 * (t < 0.35 ? OUT(t / 0.35) : 1 - OUT((t - 0.35) / 0.65));
}

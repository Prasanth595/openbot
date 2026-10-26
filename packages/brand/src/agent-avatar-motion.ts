import type { AvatarFaceId } from "./agent-avatar";

/**
 * What an agent is doing, as far as its face is concerned.
 *
 * `idle`, `working`, `waiting`, `failed` and `responded` are derived from the agent's own runtime
 * signals. `connecting` and `asleep` belong to the surface around it - a remote desktop dialling
 * in, a snoozed or disconnected agent - so they are passed in rather than derived.
 */
export type AvatarMood = "idle" | "working" | "waiting" | "failed" | "responded" | "connecting" | "asleep";

/** The body motion of a mood. Each one is a CSS keyframe loop on the whole drawing. */
export type AvatarMoodMotion = "breathe" | "bob" | "hop" | "droop" | "sleep";

export interface AvatarMoodPresentation {
  /** `null` = wear the resting face the seed chose. */
  face: AvatarFaceId | null;
  motion: AvatarMoodMotion | null;
  /** A dashed ring that turns around the body. */
  ring: boolean;
  /** A small "z" floats up beside the head. */
  snooze: boolean;
}

/**
 * How each mood reads. The shape and colour never change: they are the agent's identity. The face
 * agrees with what the body does: a working agent looks at its work, a waiting one looks curious,
 * a failed turn looks sad, a fresh reply looks pleased before it settles back to the resting face.
 */
const MOOD_PRESENTATIONS: Readonly<Record<AvatarMood, AvatarMoodPresentation>> = {
  idle: { face: null, motion: null, ring: false, snooze: false },
  working: { face: "focus", motion: "breathe", ring: true, snooze: false },
  waiting: { face: "curious", motion: "bob", ring: false, snooze: false },
  failed: { face: "sad", motion: "droop", ring: false, snooze: false },
  responded: { face: "happy", motion: "hop", ring: false, snooze: false },
  connecting: { face: "attentive", motion: null, ring: true, snooze: false },
  asleep: { face: "sleepy", motion: "sleep", ring: false, snooze: true },
};

export function avatarMoodPresentation(mood: AvatarMood): AvatarMoodPresentation {
  return MOOD_PRESENTATIONS[mood];
}

/**
 * Whether a mood shows work in progress: the ring turns, or the body breathes. `working` and
 * `connecting` are busy; the other moods are a face and a short loop.
 */
export function avatarMoodIsBusy(mood: AvatarMood): boolean {
  const presentation = MOOD_PRESENTATIONS[mood];
  return presentation.ring || presentation.motion === "breathe";
}

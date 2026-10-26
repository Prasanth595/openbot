import type { ExpressionId, ShapeId, StateId } from "@norbert_bodziony/bloub";
import { type AvatarFaceId, type AvatarShapeId, avatarProfile } from "@openbot/brand/agent-avatar";
import { type AvatarMood, avatarMoodPresentation } from "@openbot/brand/agent-avatar-motion";

/*
 * The phone still draws avatars with the Bloub engine: its players, the shared stage and the Live
 * Activity picture sample Bloub frames. The desktop draws the shared avatar from `@openbot/brand`.
 * This maps that avatar to the nearest Bloub one, so an agent keeps its shape family, resting face
 * and colour on both. Bloub has no egg (its drop shape has a point), so an egg draws as a pebble.
 */
const BLOUB_SHAPES: Readonly<Record<AvatarShapeId, ShapeId>> = {
  circle: "cercle",
  pebble: "galet",
  squircle: "squircle",
  capsule: "capsule",
  onigiri: "triangle",
  hex: "hexagone",
  cloud: "nuage",
  egg: "galet",
};

const BLOUB_FACES: Readonly<Record<AvatarFaceId, ExpressionId>> = {
  neutral: "neutre",
  attentive: "attentif",
  happy: "heureux",
  excited: "excite",
  laugh: "hilare",
  curious: "curieux",
  proud: "fier",
  shy: "timide",
  wink: "heureux",
  sad: "triste",
  sleepy: "somnolent",
  focus: "attentif",
};

export interface BloubAvatarProfile {
  shape: ShapeId;
  expression: ExpressionId;
}

/** The Bloub shape and resting face of a seed. The colour comes from `avatarHeadColor`. */
export function bloubAvatarProfile(seed: string): BloubAvatarProfile {
  const profile = avatarProfile(seed, null);
  return { shape: BLOUB_SHAPES[profile.shape], expression: BLOUB_FACES[profile.expression] };
}

/**
 * The Bloub pose and face of a mood. Only `idle` and `swirl` keep the agent's body, so a ring mood
 * that is not work (connecting) swirls and every other mood holds `idle` with the mood's face.
 */
export function bloubMoodPresentation(mood: AvatarMood): { state: StateId; expression: ExpressionId | null } {
  const presentation = avatarMoodPresentation(mood);
  return {
    state: mood === "connecting" ? "swirl" : "idle",
    expression: presentation.face === null ? null : BLOUB_FACES[presentation.face],
  };
}

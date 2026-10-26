import {
  AVATAR_BLUSH,
  AVATAR_EYE_STROKE,
  AVATAR_INK,
  AVATAR_RING,
  AVATAR_SHADE_CENTER,
  AVATAR_SHADE_STOPS,
  AVATAR_SNOOZE,
  AVATAR_VIEW_BOX,
  type AvatarFaceId,
  type AvatarShapeId,
  avatarDrawing,
  avatarProfile,
} from "@openbot/brand/agent-avatar";
import { type AvatarMood, type AvatarMoodMotion, avatarMoodPresentation } from "@openbot/brand/agent-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import type { AvatarMotion } from "../../agent-avatar";
import type { AgentProfile } from "../../data";
import { followPointer } from "./avatar-pointer-gaze";
import { attachRestingLife, restingMove } from "./avatar-resting-life";
import "./agent-avatar.css";

interface AgentAvatarProps {
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl"> | undefined;
  seed?: string | undefined;
  hue?: AvatarHue | null;
  url?: string | null | undefined;
  /** `always` blinks on its own loop; `hover` and `idle` wait for the shared, rare beat. */
  motion?: AvatarMotion;
  /** What the agent is doing. It chooses the face and the motion, never the shape or colour. */
  mood?: AvatarMood;
  /** Shifts the blink loop, so avatars that show together do not blink together. */
  cycleOffset?: number;
  /** The phase of every loop, in seconds. The default comes from the seed. */
  animationOffset?: number;
  /** Draws this shape instead of the seed's. */
  shape?: AvatarShapeId;
  /** The eyes follow the pointer. Use it only where few avatars show. A photo ignores it. */
  followPointer?: boolean;
  class?: string;
  style?: Record<string, string>;
}

export function AgentAvatar(props: AgentAvatarProps) {
  const seed = () => props.seed ?? props.agent?.avatarSeed ?? "agent";
  const hue = () => (props.hue !== undefined ? props.hue : (props.agent?.avatarHue ?? null));
  const motion = () => props.motion ?? "hover";
  const url = () => (props.url !== undefined ? props.url : (props.agent?.avatarUrl ?? null));
  const mood = (): AvatarMood => props.mood ?? "idle";
  const presentation = () => avatarMoodPresentation(mood());
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(
    () => url(),
    () => {
      setImageFailed(false);
    },
  );
  const className = () => `agent-avatar agent-avatar-motion-${motion()} ${props.class ?? ""}`;
  return (
    <Show
      when={url() && !imageFailed()}
      fallback={
        <GeneratedAvatar
          seed={seed()}
          hue={hue()}
          motion={motion()}
          mood={mood()}
          cycleOffset={props.cycleOffset}
          animationOffset={props.animationOffset}
          shape={props.shape}
          followPointer={props.followPointer === true}
          class={className()}
          style={props.style}
        />
      }
    >
      <span
        class={`${className()} agent-avatar-custom`}
        style={props.style}
        data-avatar="image"
        data-mood={mood()}
        aria-hidden="true"
      >
        <img src={url() ?? ""} alt="" draggable={false} onError={() => setImageFailed(true)} />
        {/* A photo cannot wear an expression, so a busy photo shows the ring around it instead. */}
        <Show when={presentation().ring}>
          <svg class="agent-avatar-ring-layer" viewBox="0 2 100 100" fill="none" aria-hidden="true">
            <AvatarRing color={avatarProfile(seed(), hue()).color} />
          </svg>
        </Show>
      </span>
    </Show>
  );
}

function AvatarRing(props: { color: string }) {
  return (
    <circle
      class="agent-avatar-ring"
      cx={AVATAR_RING.cx}
      cy={AVATAR_RING.cy}
      r={AVATAR_RING.r}
      fill="none"
      stroke={props.color}
      stroke-width="4"
      stroke-dasharray="8 12"
      stroke-linecap="round"
      opacity="0.55"
    />
  );
}

// The "z" of a sleeping agent, drawn as a stroke so it needs no font.
const SNOOZE_PATH = `M${AVATAR_SNOOZE.x} ${AVATAR_SNOOZE.y}h7l-7 9h7`;

interface AvatarFigureProps {
  shape: AvatarShapeId;
  face: AvatarFaceId;
  color: string;
  motion?: AvatarMoodMotion | null | undefined;
  ring?: boolean | undefined;
  snooze?: boolean | undefined;
  class?: string | undefined;
}

/**
 * The drawing of a generated avatar, as one static SVG. The classes only name the parts that the
 * avatar stylesheet animates; without the stylesheet the drawing is complete and still.
 */
export function AvatarFigure(props: AvatarFigureProps) {
  const shadeId = `agent-avatar-shade-${createUniqueId()}`;
  const drawing = createMemo(() => avatarDrawing(props.shape, props.face));
  return (
    <svg class={props.class ?? "agent-avatar-figure"} viewBox={AVATAR_VIEW_BOX} aria-hidden="true">
      <defs>
        <radialGradient id={shadeId} cx={AVATAR_SHADE_CENTER.cx} cy={AVATAR_SHADE_CENTER.cy} r={AVATAR_SHADE_CENTER.r}>
          <For each={AVATAR_SHADE_STOPS}>
            {(stop) => <stop offset={stop.offset} stop-color={stop.color} stop-opacity={stop.opacity} />}
          </For>
        </radialGradient>
      </defs>
      <g class="agent-avatar-body" data-motion={props.motion ?? undefined}>
        <Show when={props.ring}>
          <AvatarRing color={props.color} />
        </Show>
        <path d={drawing().body} fill={props.color} />
        <path d={drawing().body} fill={`url(#${shadeId})`} />
        <Show when={drawing().blush}>
          {(blush) => (
            <>
              <ellipse
                cx={blush().left}
                cy={blush().y}
                rx={AVATAR_BLUSH.rx}
                ry={AVATAR_BLUSH.ry}
                fill={AVATAR_INK.blush}
                opacity={AVATAR_BLUSH.opacity}
              />
              <ellipse
                cx={blush().right}
                cy={blush().y}
                rx={AVATAR_BLUSH.rx}
                ry={AVATAR_BLUSH.ry}
                fill={AVATAR_INK.blush}
                opacity={AVATAR_BLUSH.opacity}
              />
            </>
          )}
        </Show>
        <g class="agent-avatar-gaze">
          <g class={drawing().blinks ? "agent-avatar-eyes agent-avatar-eyes-blink" : "agent-avatar-eyes"}>
            <For each={drawing().eyes}>
              {(eye) => (
                <path
                  d={eye.d}
                  transform={eye.transform || undefined}
                  fill={eye.paint === "fill" ? AVATAR_INK.eye : "none"}
                  stroke={eye.paint === "stroke" ? AVATAR_INK.eye : undefined}
                  stroke-width={eye.paint === "stroke" ? AVATAR_EYE_STROKE : undefined}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              )}
            </For>
          </g>
        </g>
        <Show when={props.snooze}>
          <path
            class="agent-avatar-snooze"
            d={SNOOZE_PATH}
            fill="none"
            stroke={props.color}
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Show>
      </g>
    </svg>
  );
}

function GeneratedAvatar(props: {
  seed: string;
  hue: AvatarHue | null;
  motion: AvatarMotion;
  mood: AvatarMood;
  cycleOffset?: number | undefined;
  animationOffset?: number | undefined;
  shape?: AvatarShapeId | undefined;
  followPointer: boolean;
  class: string;
  style?: Record<string, string> | undefined;
}) {
  let element: HTMLSpanElement | undefined;
  const presentation = createMemo(() => avatarMoodPresentation(props.mood));
  const profile = createMemo(() => avatarProfile(props.seed, props.hue));
  // The shape and colour are identity and come only from the seed. A mood may lend the face an
  // expression; when it does not, the seeded one is the resting face.
  const face = (): AvatarFaceId => presentation().face ?? profile().expression;
  // An idle avatar without its own blink loop takes part in the shared resting beats.
  const resting = () => props.mood === "idle" && props.motion !== "always";
  const phase = () =>
    `${-((props.animationOffset ?? avatarAnimationPhase(props.seed)) + (props.cycleOffset ?? 0) * 1.3).toFixed(2)}s`;

  onSettled(() => {
    if (!element) return;
    return attachRestingLife(element);
  });

  createEffect(
    () => props.followPointer,
    (follow) => {
      if (follow && element) return followPointer(element);
    },
  );

  return (
    <span
      ref={element}
      class={`${props.class} agent-avatar-generated`}
      style={{ ...props.style, "--agent-avatar-phase": phase() }}
      data-avatar="generated"
      data-mood={props.mood}
      data-blink={props.motion === "always" ? "loop" : undefined}
      data-life={resting() ? "rest" : undefined}
      data-life-move={restingMove(props.seed)}
      aria-hidden="true"
    >
      <AvatarFigure
        shape={props.shape ?? profile().shape}
        face={face()}
        color={profile().color}
        motion={presentation().motion}
        ring={presentation().ring}
        snooze={presentation().snooze}
      />
    </span>
  );
}

function avatarAnimationPhase(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0x100000000) * 1.4;
}

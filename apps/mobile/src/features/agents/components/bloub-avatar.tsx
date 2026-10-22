import { type AvatarMood, avatarMoodPresentation } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { memo, useContext, useMemo } from "react";
import Animated, {
  convertToRGBA,
  type DerivedValue,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import {
  AgentActivitySatellites,
  SatelliteEyesContext,
  useSharedSatelliteMotion,
} from "@/features/agents/components/agent-activity-satellites";
import { useAgentColorTransition } from "@/features/agents/components/agent-color-glow";
import { AgentOrbitRings } from "@/features/agents/components/agent-orbit-rings";
import { useBloubActivityFrame } from "@/features/agents/components/use-bloub-activity-frame";
import {
  type BloubActivityFrame,
  bloubActivityGeometry,
  bloubRestEngineFrame,
  getBloubAvatarColor,
} from "@/features/agents/model/bloub-activity";
import { agentSatellitePhase, type SatellitePhase } from "@/features/agents/model/satellite-motion";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import {
  DISCONNECTED_APPEARANCE,
  useConnectionAppearance,
} from "@/features/workspace/components/use-connection-appearance";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood } from "@/features/workspace/model/agent-activity";
import { showsOnline } from "@/features/workspace/model/server-status";
import { AgentPhoto, type AgentPhotoProps } from "./agent-photo";

interface BloubAvatarProps extends AgentPhotoProps {
  agentId: string;
  hue: AvatarHue | null;
  seed: string;
  size?: number;
  animateIdle?: boolean;
  /** Shows activity decoration around the saved avatar. */
  rings?: boolean;
  activityPhase?: SatellitePhase;
  activityMotion?: boolean;
}

const AVATAR_PAPER = "#f9f9f9";
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function AvatarEye({ frame, index }: { frame: DerivedValue<BloubActivityFrame>; index: number }) {
  const satellite = useContext(SatelliteEyesContext);
  const props = useAnimatedProps(() => {
    const eye = frame.get().eyes[index] ?? { d: "", opacity: 0, matrix: [1, 0, 0, 1, 0, 0] };
    const pose = satellite?.get();
    if (!pose) return eye;
    const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = eye.matrix;
    return { ...eye, matrix: [a * pose.sx, b * pose.sx, c * pose.sy, d * pose.sy, x + pose.x * 316, y + pose.y * 316] };
  });
  return <AnimatedPath fill={AVATAR_PAPER} animatedProps={props} />;
}

function AvatarDot({
  frame,
  index,
  color,
}: {
  frame: DerivedValue<BloubActivityFrame>;
  index: number;
  color: DerivedValue<string>;
}) {
  const props = useAnimatedProps(() => ({
    ...(frame.get().dots[index] ?? { cx: 0, cy: 0, r: 0, opacity: 0 }),
    fill: color.get(),
  }));
  return <AnimatedCircle animatedProps={props} />;
}

export function BloubAvatar({
  agentId,
  serverId: hostId,
  hue,
  seed,
  size = 54,
  animateIdle = true,
  rings = false,
}: BloubAvatarProps) {
  const serverId = useMobileWorkspaceSelector(
    (workspace) => hostId ?? workspace.agents.find((agent) => agent.id === agentId)?.serverId,
  );
  const disconnected = useMobileWorkspaceSelector(
    (workspace) => !workspace.servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const activity = useAgentActivity(agentId, true, serverId);
  return (
    <BloubAvatarPreview
      agentId={agentId}
      serverId={serverId}
      hue={hue}
      seed={seed}
      size={size}
      animateIdle={animateIdle}
      rings={rings}
      disconnected={disconnected}
      mood={disconnected ? "idle" : agentActivityMood(activity)}
      activityPhase={disconnected ? "idle" : agentSatellitePhase(activity)}
    />
  );
}

interface AvatarPreviewOptions {
  disconnected?: boolean;
  mood?: AvatarMood;
  /** Eases the body to a new colour instead of swapping it. The value must hold this avatar's colour. */
  animatedColor?: SharedValue<string>;
}

export const BloubAvatarPreview = memo(function BloubAvatarPreview(
  props: Omit<BloubAvatarProps, "agentId"> & AgentPhotoProps & AvatarPreviewOptions,
) {
  const size = props.size ?? 54;
  const shared = useSharedSatelliteMotion(props.agentId, props.serverId);
  const phase =
    (props.rings ? shared?.phase : undefined) ??
    props.activityPhase ??
    (props.mood === "working" ? "thinking" : props.mood === "responded" ? "done" : "idle");
  const satellites = props.rings && props.mood !== "connecting";
  const avatar = (
    <AgentPhoto {...props} size={size}>
      <AnimatedAvatarPreview
        {...props}
        mood={satellites && phase !== "idle" ? "idle" : props.mood}
        animateIdle={satellites ? false : props.animateIdle}
      />
    </AgentPhoto>
  );
  if (satellites)
    return (
      <AgentActivitySatellites
        agentId={props.agentId}
        serverId={props.serverId}
        phase={props.disconnected ? "idle" : phase}
        size={size}
        enabled={props.activityMotion}
      >
        {avatar}
      </AgentActivitySatellites>
    );
  if (!props.rings) return avatar;
  // The ring wrapper stays mounted when work starts and stops, so the face keeps its glide.
  return (
    <AgentOrbitRings active={!props.disconnected && avatarMoodPresentation(props.mood ?? "idle").rings} size={size}>
      {avatar}
    </AgentOrbitRings>
  );
});

const AnimatedAvatarPreview = memo(function AnimatedAvatarPreview({
  hue,
  seed,
  size = 54,
  disconnected = false,
  mood = "idle",
  animateIdle = true,
  animatedColor,
}: Omit<BloubAvatarProps, "agentId"> & AvatarPreviewOptions) {
  const appearance = useConnectionAppearance(disconnected);
  const appearanceStyle = useAnimatedStyle(() => ({ opacity: appearance.get().opacity }));
  const frame = useBloubActivityFrame(seed, mood, animateIdle && !disconnected);
  const color = getBloubAvatarColor(seed, hue);
  const bodyColor = useDerivedValue(() =>
    saturateColor(animatedColor ? animatedColor.get() : color, appearance.get().saturation),
  );
  const dotColor = useDerivedValue(() => saturateColor(color, appearance.get().saturation));

  // The opacity stays on the native view: react-native-svg on Android crashes with
  // "Underflow in restore" when a filtered <G> has an opacity other than 1.
  return (
    <Animated.View pointerEvents="none" style={[{ width: size, height: size }, appearanceStyle]}>
      <Svg
        accessibilityElementsHidden
        accessible={false}
        height={size}
        pointerEvents="none"
        viewBox="-158 -158 316 316"
        width={size}
      >
        {/* Mobile-only feedback: keep the synced avatar profile and color untouched. */}
        {/* The body and eyes are opaque in every pose the phone plays, so paper eyes on the coloured
            body draw what a body mask with cut-out eyes drew, without a mask layer on each redraw. */}
        <AvatarBody frame={frame} color={bodyColor} />
        <AvatarEye frame={frame} index={0} />
        <AvatarEye frame={frame} index={1} />
        <AvatarDot frame={frame} index={0} color={dotColor} />
        <AvatarDot frame={frame} index={1} color={dotColor} />
        <AvatarDot frame={frame} index={2} color={dotColor} />
      </Svg>
    </Animated.View>
  );
});

function AvatarBody({ frame, color }: { frame: DerivedValue<BloubActivityFrame>; color: DerivedValue<string> }) {
  const props = useAnimatedProps(() => ({ ...frame.get().body, fill: color.get() }));
  return <AnimatedPath animatedProps={props} />;
}

// Choices show the same idle pose without mounting animation clocks, worklets,
// filters, or masks for every item in the picker.
export const BloubAvatarThumbnail = memo(function BloubAvatarThumbnail(
  props: Omit<BloubAvatarProps, "agentId"> & AgentPhotoProps & { disconnected?: boolean },
) {
  return (
    <AgentPhoto {...props} size={props.size ?? 48}>
      <AvatarThumbnail {...props} />
    </AgentPhoto>
  );
});

// Draws the idle pose without the photo lookup, for pickers that never show a photo.
export const AvatarThumbnail = memo(function AvatarThumbnail({
  seed,
  hue,
  size = 48,
  disconnected = false,
  animateColor = false,
}: Omit<BloubAvatarProps, "agentId"> & {
  disconnected?: boolean;
  /** Eases the body to a new colour, for a picker where the colour changes in place. */
  animateColor?: boolean;
}) {
  const frame = useMemo(() => bloubRestEngineFrame(bloubActivityGeometry(seed)), [seed]);
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      opacity={disconnected ? DISCONNECTED_APPEARANCE.opacity : 1}
      height={size}
      pointerEvents="none"
      viewBox="-158 -158 316 316"
      width={size}
    >
      {animateColor ? (
        <AnimatedThumbnailBody
          d={frame.bodyPath}
          color={thumbnailColor(getBloubAvatarColor(seed, hue), disconnected)}
          opacity={frame.bodyAlpha}
        />
      ) : (
        <Path
          d={frame.bodyPath}
          fill={thumbnailColor(getBloubAvatarColor(seed, hue), disconnected)}
          opacity={frame.bodyAlpha}
        />
      )}
      {(["left", "right"] as const).map((side) => {
        const eye = frame.eyes[side === "left" ? 0 : 1];
        return eye ? (
          <Path key={side} d={eye.d} fill={AVATAR_PAPER} opacity={eye.alpha} transform={eye.matrix} />
        ) : null;
      })}
    </Svg>
  );
});

function AnimatedThumbnailBody({ d, color, opacity }: { d: string; color: string; opacity: number }) {
  const animated = useAgentColorTransition(color);
  const props = useAnimatedProps(() => ({ fill: animated.get() }));
  return <AnimatedPath d={d} opacity={opacity} animatedProps={props} />;
}

function saturateColor(color: string, saturation: number) {
  "worklet";
  if (saturation >= 1) return color;
  const [r, g, b, a] = convertToRGBA(color);
  const gray = r * 0.213 + g * 0.715 + b * 0.072;
  const channel = (value: number) => Math.round((gray + (value - gray) * saturation) * 255);
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${a})`;
}

export function thumbnailColor(color: string, disconnected: boolean) {
  return disconnected ? saturateColor(color, DISCONNECTED_APPEARANCE.saturation) : color;
}

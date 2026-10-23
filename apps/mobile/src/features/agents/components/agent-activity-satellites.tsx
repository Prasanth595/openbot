import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, useWindowDimensions, View } from "react-native";
import Animated, {
  type AnimatedRef,
  cancelAnimation,
  type DerivedValue,
  Easing,
  measure,
  ReduceMotion,
  type SharedValue,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import {
  SATELLITE_DONE_MS,
  SATELLITE_MIN_STATE_MS,
  SATELLITE_PHASES,
  type SatellitePhase,
  satelliteDot,
  satelliteEyes,
  satellitePop,
} from "@/features/agents/model/satellite-motion";
import { useMotionPreference } from "@/shared/lib/motion";
import { useScreenFocusedWhile } from "@/shared/lib/use-screen-focused-while";

export const SatelliteEyesContext = createContext<DerivedValue<ReturnType<typeof satelliteEyes>> | null>(null);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const PERIODS = [7.2, 4, 2.7, 1.2];
const DOT_IDS = ["lavender", "green", "mustard"] as const;

export const SatelliteMotionContext = createContext<{
  agentId: string;
  serverId: string;
  motion: ReturnType<typeof useSatelliteMotion>;
} | null>(null);

export function useSharedSatelliteMotion(agentId?: string, serverId?: string) {
  const shared = useContext(SatelliteMotionContext);
  return shared?.agentId === agentId && shared?.serverId === serverId ? shared?.motion : undefined;
}

/** One phase timer, clock and transition for every live avatar in this conversation. */
export function SatelliteMotionProvider({
  agentId,
  serverId,
  phase,
  enabled = true,
  children,
}: PropsWithChildren<{ agentId: string; serverId: string; phase: SatellitePhase; enabled?: boolean }>) {
  const motion = useSatelliteMotion(phase, enabled);
  const value = useMemo(() => ({ agentId, serverId, motion }), [agentId, serverId, motion]);
  return <SatelliteMotionContext value={value}>{children}</SatelliteMotionContext>;
}

/** Coalesce short active phases. Cancellation and waits return to rest at once. */
function useSatellitePhase(requested: SatellitePhase) {
  const [phase, setPhase] = useState(requested);
  const current = useRef({ phase: requested, at: Date.now() });
  useEffect(() => {
    let finish: ReturnType<typeof setTimeout> | undefined;
    const change = () => {
      current.current = { phase: requested, at: Date.now() };
      setPhase(requested);
      if (requested === "done")
        finish = setTimeout(() => {
          current.current = { phase: "idle", at: Date.now() };
          setPhase("idle");
        }, SATELLITE_DONE_MS);
    };
    const before = current.current;
    const holdDone = before.phase === "done" && requested === "idle";
    const minimum = holdDone ? SATELLITE_DONE_MS : requested === "idle" ? 0 : SATELLITE_MIN_STATE_MS;
    const wait =
      before.phase === "idle" || before.phase === requested ? 0 : Math.max(0, minimum - (Date.now() - before.at));
    const timer = setTimeout(change, wait);
    return () => {
      clearTimeout(timer);
      if (finish) clearTimeout(finish);
    };
  }, [requested]);
  return phase;
}

function SatelliteDot({
  phase,
  phaseIndex,
  index,
  layer,
  size,
  color,
  clocks,
  weights,
  still,
}: {
  phase: SatellitePhase;
  phaseIndex: number;
  index: number;
  layer: "front" | "back";
  size: number;
  color: string;
  clocks: SharedValue<number[]>;
  weights: SharedValue<number[]>;
  still: boolean;
}) {
  const diameter = Math.max(3, size * 0.12);
  const style = useAnimatedStyle(() => {
    const weight = weights.get()[phaseIndex] ?? 0;
    const dot = satelliteDot(phase, clocks.get()[phaseIndex] ?? 0, index, still);
    const visible = layer === "back" ? 0.5 : phase !== "thinking" || dot.front ? 1 : 0;
    const layerScale = still ? 1 : 0.85 + 0.15 * weight;
    const scale = dot.scale * layerScale;
    return {
      opacity: weight * dot.opacity * visible,
      transform: [{ translateX: dot.x * size * layerScale }, { translateY: dot.y * size * layerScale }, { scale }],
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: (size - diameter) / 2,
          top: (size - diameter) / 2,
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

function useSatelliteMotion(
  requested: SatellitePhase,
  enabled: boolean,
  bounds?: { ref: AnimatedRef<View>; size: number },
) {
  const phase = useSatellitePhase(requested);
  const [layers, setLayers] = useState<readonly Exclude<SatellitePhase, "idle">[]>(phase === "idle" ? [] : [phase]);
  const animate = useMotionPreference("agentFaces") && enabled;
  const focused = useScreenFocusedWhile(animate && phase !== "idle");
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (value) => setForeground(value === "active"));
    return () => subscription.remove();
  }, []);
  const clocks = useSharedValue([0, 0, 0, 0]);
  const viewport = useWindowDimensions();
  const visibility = useSharedValue({ nextCheck: 0, visible: true });
  const weights = useSharedValue([0, 0, 0, 0]);
  const poses = useSharedValue([0, 0, 0, 0]);
  useEffect(() => {
    setLayers((current) => (phase === "idle" || current.includes(phase) ? current : [...current, phase]));
    const timer = setTimeout(() => setLayers(phase === "idle" ? [] : [phase]), animate ? 200 : 120);
    return () => clearTimeout(timer);
  }, [animate, phase]);
  const clock = useFrameCallback(({ timestamp, timeSincePreviousFrame }) => {
    // Read native bounds at most four times per second. Scrolled-out avatars keep their clocks
    // still without a JS scroll listener or a React render on each scroll/frame.
    if (bounds && timestamp >= visibility.get().nextCheck) {
      const measured = measure(bounds.ref);
      const margin = bounds.size * 0.3;
      visibility.set({
        nextCheck: timestamp + 250,
        visible:
          measured === null ||
          (measured.pageX + measured.width + margin > 0 &&
            measured.pageX - margin < viewport.width &&
            measured.pageY + measured.height + margin > 0 &&
            measured.pageY - margin < viewport.height),
      });
    }
    if (!visibility.get().visible) return;
    const dt = Math.min(timeSincePreviousFrame ?? 0, 64) / 1000;
    const visible = weights.get();
    clocks.modify((values) => {
      for (let index = 0; index < values.length; index++) {
        if ((visible[index] ?? 0) <= 0) continue;
        const period = PERIODS[index] ?? 1;
        values[index] = index === 3 ? Math.min(1.2, (values[index] ?? 0) + dt) : ((values[index] ?? 0) + dt) % period;
      }
      return values;
    });
  }, false);
  useEffect(() => {
    const next = SATELLITE_PHASES.map((value) => (value === phase ? 1 : 0));
    if (phase === "done")
      clocks.modify((values) => {
        "worklet";
        values[3] = 0;
        return values;
      });
    weights.set(
      withTiming(next, {
        duration: animate ? 200 : 120,
        easing: animate ? EASE_OUT : Easing.linear,
        // The preference already selects a static pose. Keep its permitted opacity fade.
        reduceMotion: ReduceMotion.Never,
      }),
    );
    poses.set(withTiming(next, { duration: animate ? 240 : 0, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
    return () => {
      cancelAnimation(weights);
      cancelAnimation(poses);
    };
  }, [animate, clocks, phase, poses, weights]);
  useEffect(() => {
    clock.setActive(animate && focused && foreground && phase !== "idle");
    return () => clock.setActive(false);
  }, [animate, clock, focused, foreground, phase]);
  return useMemo(
    () => ({ phase, layers, animate, clocks, weights, poses }),
    [phase, layers, animate, clocks, weights, poses],
  );
}

type SatelliteProps = PropsWithChildren<{
  phase: SatellitePhase;
  size: number;
  enabled?: boolean;
  agentId?: string;
  serverId?: string;
}>;

/** Native implementation of MOTION-SPEC-thinking C. All loop clocks run on the UI thread. */
export function AgentActivitySatellites(props: SatelliteProps) {
  const shared = useSharedSatelliteMotion(props.agentId, props.serverId);
  return shared ? (
    <SatelliteArtwork size={props.size} motion={shared}>
      {props.children}
    </SatelliteArtwork>
  ) : (
    <StandaloneSatellites {...props} />
  );
}

function StandaloneSatellites({ phase, size, enabled = true, children }: SatelliteProps) {
  const ref = useAnimatedRef<View>();
  const motion = useSatelliteMotion(phase, enabled, { ref, size });
  return (
    <SatelliteArtwork size={size} motion={motion} boundsRef={ref}>
      {children}
    </SatelliteArtwork>
  );
}

function SatelliteArtwork({
  size,
  motion,
  boundsRef,
  children,
}: PropsWithChildren<{
  size: number;
  motion: ReturnType<typeof useSatelliteMotion>;
  boundsRef?: AnimatedRef<View>;
}>) {
  const { layers, animate, clocks, weights, poses } = motion;
  const colors = useCSSVariable([
    "--openbot-activity-satellite-lavender",
    "--openbot-activity-satellite-green",
    "--openbot-activity-satellite-mustard",
  ]).map(String);
  const eyes = useDerivedValue(() => {
    const result = { x: 0, y: 0, sx: 1, sy: 1 };
    for (let index = 0; index < SATELLITE_PHASES.length; index++) {
      const state = SATELLITE_PHASES[index];
      if (!state) continue;
      const pose = satelliteEyes(state, clocks.get()[index] ?? 0, size <= 24, !animate);
      const weight = poses.get()[index] ?? 0;
      result.x += pose.x * weight;
      result.y += pose.y * weight;
      result.sx += (pose.sx - 1) * weight;
      result.sy += (pose.sy - 1) * weight;
    }
    return result;
  });
  const body = useAnimatedStyle(() => ({
    transform: [{ scale: animate ? 1 + (satellitePop(clocks.get()[3] ?? 0) - 1) * (weights.get()[3] ?? 0) : 1 }],
  }));
  const dots = (layer: "front" | "back") =>
    layers.flatMap((state) =>
      layer === "back" && state !== "thinking"
        ? []
        : DOT_IDS.map((id, index) => (
            <SatelliteDot
              key={`${state}-${id}`}
              phase={state}
              phaseIndex={SATELLITE_PHASES.indexOf(state)}
              index={index}
              layer={layer}
              size={size}
              color={colors[index] ?? ""}
              clocks={clocks}
              weights={weights}
              still={!animate}
            />
          )),
    );
  return (
    <View
      ref={boundsRef}
      collapsable={false}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, overflow: "visible" }}
    >
      {dots("back")}
      <SatelliteEyesContext value={eyes}>
        <Animated.View style={body}>{children}</Animated.View>
      </SatelliteEyesContext>
      {dots("front")}
    </View>
  );
}

import { useThemeColor } from "heroui-native/hooks";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import Animated, {
  cancelAnimation,
  type DerivedValue,
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import {
  CYCLE_SECONDS,
  FPS,
  IDLE_MORPH_SECONDS,
  LOADER_COLOR,
  type LoaderFrame,
  prepareLoaderFrames,
  prepareReturnToIdleFrames,
  REST_FRAME,
} from "@/shared/lib/bloub-loader-frames";
import { useReducedMotion } from "@/shared/lib/motion";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
// The loader grows from a little smaller and fades in, and leaves the same way. It never starts
// from or ends at nothing.
const HIDDEN_SCALE = 0.9;
const ENTER = { duration: 220, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.System };
const EXIT = { duration: 200, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.System };
// Longer than preparing the settling sequence takes, short enough that a stalled
// JS thread cannot hold the loader over the app.
const SETTLE_DEADLINE_MS = 250;
// Longer than the whole exit - settling, the overshoot and the spring - so a healthy
// exit keeps its own timing. A lost animation callback leaves through this instead.
const EXIT_DEADLINE_MS = 1500;
interface BloubAnimationContextValue {
  frameIndex: DerivedValue<number>;
  frames: LoaderFrame[] | null;
  retainPlayback: () => () => void;
}

const BloubAnimationContext = createContext<BloubAnimationContextValue | null>(null);

export function BloubAnimationProvider({ children }: PropsWithChildren) {
  const [activeLoaders, setActiveLoaders] = useState(0);
  const [frames, setFrames] = useState<LoaderFrame[] | null>(null);
  const reducedMotion = useReducedMotion();
  // Start after the loop's wide → idle seam so REST_FRAME doesn't jump to wide
  // eyes when preparation completes. Later loops still include the whole seam.
  const elapsed = useSharedValue(IDLE_MORPH_SECONDS * 1000);
  const frameIndex = useDerivedValue(() => Math.floor((elapsed.get() / 1000) * FPS));
  const playback = useFrameCallback(({ timeSincePreviousFrame }) => {
    elapsed.set((elapsed.get() + (timeSincePreviousFrame ?? 0)) % (CYCLE_SECONDS * 1000));
  }, false);
  const retainPlayback = useCallback(() => {
    setActiveLoaders((count) => count + 1);
    return () => setActiveLoaders((count) => count - 1);
  }, []);

  const shouldPrepare = activeLoaders > 0 && !reducedMotion && frames === null;
  useEffect(() => {
    // The root loader stays mounted, even while hidden. First commit REST_FRAME;
    // prepare one shared sequence only when an animated loader is actually active.
    if (shouldPrepare) return prepareLoaderFrames(setFrames);
  }, [shouldPrepare]);

  useEffect(() => {
    const updatePlayback = () =>
      playback.setActive(frames !== null && activeLoaders > 0 && !reducedMotion && AppState.currentState === "active");
    updatePlayback();
    const subscription = AppState.addEventListener("change", updatePlayback);
    return () => {
      subscription.remove();
      playback.setActive(false);
    };
  }, [activeLoaders, frames, playback, reducedMotion]);

  const value = useMemo(() => ({ frameIndex, frames, retainPlayback }), [frameIndex, frames, retainPlayback]);
  return <BloubAnimationContext.Provider value={value}>{children}</BloubAnimationContext.Provider>;
}

function LoaderEye({ frame, index, fill }: { frame: DerivedValue<LoaderFrame>; index: number; fill: string }) {
  const props = useAnimatedProps(() => frame.get().eyes[index] ?? { d: "", opacity: 0, matrix: [1, 0, 0, 1, 0, 0] });
  return <AnimatedPath fill={fill} animatedProps={props} />;
}

function LoaderDot({ frame, index, fill }: { frame: DerivedValue<LoaderFrame>; index: number; fill: string }) {
  const props = useAnimatedProps(() => frame.get().dots[index] ?? { cx: 0, cy: 0, r: 0, opacity: 0 });
  return <AnimatedCircle fill={fill} animatedProps={props} />;
}

export function BloubLoader({
  label,
  active = true,
  visible = true,
  enterInstantly = false,
  onExitStart,
  onExitComplete,
}: {
  label: string;
  active?: boolean;
  visible?: boolean;
  /** Show at full size at once, because a view around the loader animates its arrival. */
  enterInstantly?: boolean;
  /** The loader starts to leave: the content below can start to appear. */
  onExitStart?: () => void;
  onExitComplete?: () => void;
}) {
  const animation = useContext(BloubAnimationContext);
  if (!animation) throw new Error("BloubLoader requires BloubAnimationProvider.");
  const { frameIndex, frames, retainPlayback } = animation;
  const background = useThemeColor("background");
  const reducedMotion = useReducedMotion();
  const idleFrames = useSharedValue<LoaderFrame[] | null>(null);
  const idleFrameIndex = useSharedValue(0);
  // Mount hidden when the loader starts covered (app start under the splash), so
  // the first frame never flashes before the exit sequence runs.
  const scale = useSharedValue(visible ? 1 : 0);
  const opacity = useSharedValue(visible ? 1 : 0);
  const exitRevision = useRef(0);
  const finishExit = useCallback(
    (revision: number) => {
      if (exitRevision.current === revision) onExitComplete?.();
    },
    [onExitComplete],
  );
  const startExit = useCallback(
    (revision: number) => {
      if (exitRevision.current === revision) onExitStart?.();
    },
    [onExitStart],
  );
  const frame = useDerivedValue(() => {
    if (reducedMotion) return REST_FRAME;
    const settling = idleFrames.get();
    return (settling ? settling[Math.floor(idleFrameIndex.get())] : frames?.[frameIndex.get()]) ?? REST_FRAME;
  });
  const bodyProps = useAnimatedProps(() => frame.get().body);
  const loaderStyle = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));

  useLayoutEffect(() => {
    const revision = ++exitRevision.current;
    let cancelPreparation: (() => void) | undefined;
    let cancelExitDeadline: (() => void) | undefined;
    if (reducedMotion) {
      scale.set(1);
      if (!visible) startExit(revision);
      opacity.set(
        withTiming(visible ? 1 : 0, { duration: 150, reduceMotion: ReduceMotion.Never }, (finished) => {
          if (finished && !visible) scheduleOnRN(finishExit, revision);
        }),
      );
    } else if (visible) {
      idleFrames.set(null);
      if (enterInstantly) {
        scale.set(1);
        opacity.set(1);
      } else {
        // A loader that is still leaving turns back from where it is.
        if (opacity.get() === 0) scale.set(HIDDEN_SCALE);
        scale.set(withTiming(1, ENTER));
        opacity.set(withTiming(1, ENTER));
      }
    } else {
      // Every branch below reports the exit through an animation callback, and the
      // overlay above stays over the app until that report arrives. Leave on a
      // deadline as well, so a dropped callback cannot strand the loader.
      const exitDeadline = setTimeout(() => {
        cancelAnimation(scale);
        cancelAnimation(opacity);
        opacity.set(0);
        startExit(revision);
        finishExit(revision);
      }, EXIT_DEADLINE_MS);
      cancelExitDeadline = () => clearTimeout(exitDeadline);
      // A short swell, then the loader shrinks a little and fades. The screen below starts to
      // appear with the swell, so the two overlap instead of following each other.
      const scaleDown = () => {
        "worklet";
        scale.set(
          withSequence(withTiming(1.08, { duration: 80, easing: SPLASH_EASE_OUT }), withTiming(HIDDEN_SCALE, EXIT)),
        );
        opacity.set(
          withSequence(
            withTiming(1, { duration: 80 }),
            withTiming(0, EXIT, (finished) => {
              if (finished) scheduleOnRN(finishExit, revision);
            }),
          ),
        );
      };
      if (!frames) {
        // Loading finished before preparation: REST_FRAME is already idle.
        idleFrames.set([REST_FRAME]);
        idleFrameIndex.set(0);
        startExit(revision);
        scaleDown();
      } else {
        const sourceIndex = frameIndex.get();
        // Hold the displayed pose while preparing its settling sequence off the
        // commit path. Otherwise the loop advances and the exit starts with a jump.
        idleFrames.set([frames[sourceIndex] ?? REST_FRAME]);
        idleFrameIndex.set(0);
        // Holding the pose must never outlive the hidden state: preparation runs on
        // the JS thread and the screen behind the loader is often busy. Leave from
        // the held pose when the sequence is late, rather than waiting for it.
        let cancelSettling: (() => void) | undefined;
        const settleDeadline = setTimeout(() => {
          cancelSettling?.();
          cancelSettling = undefined;
          startExit(revision);
          scaleDown();
        }, SETTLE_DEADLINE_MS);
        cancelSettling = prepareReturnToIdleFrames(sourceIndex, (settling) => {
          clearTimeout(settleDeadline);
          idleFrames.set(settling);
          idleFrameIndex.set(
            withTiming(
              settling.length - 1,
              { duration: IDLE_MORPH_SECONDS * 1000, easing: Easing.linear, reduceMotion: ReduceMotion.System },
              (finished) => {
                if (!finished) return;
                scheduleOnRN(startExit, revision);
                scaleDown();
              },
            ),
          );
        });
        cancelPreparation = () => {
          clearTimeout(settleDeadline);
          cancelSettling?.();
        };
      }
    }
    return () => {
      exitRevision.current += 1;
      cancelPreparation?.();
      cancelExitDeadline?.();
      cancelAnimation(idleFrameIndex);
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [
    enterInstantly,
    finishExit,
    frameIndex,
    frames,
    idleFrameIndex,
    idleFrames,
    opacity,
    reducedMotion,
    scale,
    startExit,
    visible,
  ]);
  useEffect(() => {
    if (active) return retainPlayback();
  }, [active, retainPlayback]);

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={loaderStyle}
    >
      <Svg width={112} height={112} viewBox="-158 -158 316 316" accessible={false} accessibilityElementsHidden>
        <AnimatedPath fill={LOADER_COLOR} animatedProps={bodyProps} />
        <LoaderEye frame={frame} index={0} fill={background} />
        <LoaderEye frame={frame} index={1} fill={background} />
        <LoaderDot frame={frame} index={0} fill={LOADER_COLOR} />
        <LoaderDot frame={frame} index={1} fill={LOADER_COLOR} />
      </Svg>
    </Animated.View>
  );
}

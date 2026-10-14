import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useReducedMotion } from "@/shared/lib/motion";
import { SPLASH_EASE_IN_OUT, SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

/** The loader draws its 100-unit body radius in a 316-unit view box at 112 pt. */
const LOADER_BODY_SIZE = (112 * 200) / 316;
// The mark travels, then turns into the loader in the last part of the trip, when both overlap.
const FLIGHT_MS = 420;
const REDUCED_FLIGHT_MS = 160;
const MORPH_START = 0.55;
// A flight that never reports its end must not keep the loader away from the app.
const LANDING_DEADLINE_MS = FLIGHT_MS + 600;

/**
 * A view on the screen below that turns into the loader: a square frame in window coordinates, or
 * a square of this size in the centre of the screen.
 */
export type LoaderFlightOrigin = {
  size: number;
  /** A copy of the view at that frame. Without one, the loader itself grows out of the frame. */
  mark: ReactNode | null;
} & ({ x: number; y: number } | { centered: true });

export type LoaderFlightPlan = LoaderFlightOrigin & { id: number };

interface Route {
  id: number;
  /** The origin centre minus the overlay centre. */
  dx: number;
  dy: number;
  left: number;
  top: number;
  size: number;
}

/**
 * Moves a mark from a screen into the centred loader. The mark and the loader travel together and
 * cross-fade where they overlap, so the user sees one object arrive. Only views fade and move: the
 * SVG inside the mark and the loader keeps its own props, because an animated opacity on a filtered
 * SVG group crashes Android (react-native-svg `GroupView.drawGroup`).
 */
export function LoaderFlight({
  flight,
  onShown,
  onLanded,
  children,
}: {
  flight: LoaderFlightPlan | null;
  /** The mark is on screen at the origin. The screen below can now hide its own copy. */
  onShown: (id: number) => void;
  onLanded: (id: number) => void;
  children: ReactNode;
}) {
  const container = useRef<View>(null);
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  const [route, setRoute] = useState<Route | null>(null);

  useLayoutEffect(() => {
    if (!flight) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    // Back to the start now, while the loader is hidden: the first frame of the flight must not
    // show the end of the last one.
    cancelAnimation(progress);
    progress.set(0);
    container.current?.measureInWindow((x, y, width, height) => {
      if (cancelled || width <= 0 || height <= 0) return;
      const left = "centered" in flight ? (width - flight.size) / 2 : flight.x - x;
      const top = "centered" in flight ? (height - flight.size) / 2 : flight.y - y;
      setRoute({
        id: flight.id,
        dx: left + flight.size / 2 - width / 2,
        dy: top + flight.size / 2 - height / 2,
        left,
        top,
        size: flight.size,
      });
    });
    // A missing measurement lands at once: the loader then enters in the centre.
    const deadline = setTimeout(() => {
      if (cancelled) return;
      onShown(flight.id);
      onLanded(flight.id);
    }, LANDING_DEADLINE_MS);
    return () => {
      cancelled = true;
      clearTimeout(deadline);
    };
  }, [flight, onLanded, onShown, progress]);

  useEffect(() => {
    if (!route) return;
    // The mark is drawn at the origin in this frame. Report it on the next one.
    const frame = requestAnimationFrame(() => onShown(route.id));
    progress.set(
      withTiming(
        1,
        {
          duration: reduced ? REDUCED_FLIGHT_MS : FLIGHT_MS,
          easing: reduced ? SPLASH_EASE_OUT : SPLASH_EASE_IN_OUT,
          reduceMotion: ReduceMotion.Never,
        },
        (finished) => {
          if (finished) scheduleOnRN(onLanded, route.id);
        },
      ),
    );
    return () => {
      cancelAnimation(progress);
      cancelAnimationFrame(frame);
    };
  }, [onLanded, onShown, progress, reduced, route]);

  const hasMark = Boolean(flight?.mark);
  // The loader waits, hidden, until the flight knows where it starts.
  const measuring = flight !== null && route?.id !== flight.id;
  const loaderStyle = useAnimatedStyle(() => {
    if (measuring) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    if (!route) return { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const p = progress.get();
    const morph = !hasMark || reduced ? p : Math.max(0, (p - MORPH_START) / (1 - MORPH_START));
    // Reduced motion keeps the cross-fade in place and drops the travel.
    if (reduced) return { opacity: morph, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const startScale = route.size / LOADER_BODY_SIZE;
    return {
      opacity: morph,
      transform: [
        { translateX: route.dx * (1 - p) },
        { translateY: route.dy * (1 - p) },
        { scale: startScale + (1 - startScale) * p },
      ],
    };
  });
  const markStyle = useAnimatedStyle(() => {
    if (!route) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const p = progress.get();
    const morph = reduced ? p : Math.max(0, (p - MORPH_START) / (1 - MORPH_START));
    if (reduced) return { opacity: 1 - morph, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    return {
      opacity: 1 - morph,
      transform: [
        { translateX: -route.dx * p },
        { translateY: -route.dy * p },
        { scale: 1 + (LOADER_BODY_SIZE / route.size - 1) * p },
      ],
    };
  });

  return (
    <View ref={container} collapsable={false} className="absolute inset-0 items-center justify-center">
      <Animated.View style={loaderStyle}>{children}</Animated.View>
      {flight?.mark && route?.id === flight.id ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            { position: "absolute", left: route.left, top: route.top, width: route.size, height: route.size },
            markStyle,
          ]}
        >
          {flight.mark}
        </Animated.View>
      ) : null}
    </View>
  );
}

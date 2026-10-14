import { useIsFocused, usePathname } from "expo-router";
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
import { BackHandler, View } from "react-native";
import { BloubLoader } from "@/shared/components/bloub-loader";
import { LoaderFlight, type LoaderFlightOrigin, type LoaderFlightPlan } from "@/shared/components/loader-flight";
import { isAndroid } from "@/shared/lib/platform";

interface AppLoadingOverlayContextValue {
  setLoadingLabel: (label: string | null) => void;
  isLoaderPresent: boolean;
  /** The loader has started to leave. The screen below may start to appear under it. */
  isLoaderLeaving: boolean;
  /** A screen asked for the loader. True also while `holdLoader` keeps it out of sight. */
  isLoaderRequested: boolean;
  /** A view from the screen below is on its way into the loader (see `handOff`). */
  isLoaderFlying: boolean;
  /**
   * Flies a view from the screen below into the centred loader. Resolves when the copy is on
   * screen, so the screen can hide its own view before it is replaced.
   */
  handOff: (origin: LoaderFlightOrigin) => Promise<void>;
  /** Keeps a requested loader out of sight, for example while the splash still covers the app. */
  holdLoader: (held: boolean) => void;
}

type OverlayState = {
  label: string | null;
  present: boolean;
  flight: LoaderFlightPlan | null;
  leaving: boolean;
  held: boolean;
};

const AppLoadingOverlayContext = createContext<AppLoadingOverlayContextValue | null>(null);
// The exit animation reports its own end, and that report blocks the app until it
// arrives. A lost animation callback, or a loader unmounted part way through its
// exit, left the loader over the conversation with no way back. Longer than the
// whole exit takes, so a healthy exit still owns its own timing.
const EXIT_DEADLINE_MS = 2000;
// The screen below waits this long at most for the flying copy to show.
const HANDOFF_SHOWN_DEADLINE_MS = 250;

export function AppLoadingOverlayProvider({ children }: PropsWithChildren) {
  // Starts idle: the splash backdrop covers account loading on its own, so no
  // loader is present until a screen raises one with setLoadingLabel.
  const [{ label, present, flight, leaving, held }, setOverlay] = useState<OverlayState>({
    label: null,
    present: false,
    flight: null,
    leaving: false,
    held: false,
  });
  // A flight shows the loader before the next screen asks for it, so the two meet without a gap.
  const visible = label !== null || flight !== null;
  const flights = useRef(0);
  const shown = useRef(new Map<number, () => void>());
  const setLoadingLabel = useCallback((nextLabel: string | null) => {
    setOverlay((current) =>
      current.label === nextLabel
        ? current
        : {
            ...current,
            label: nextLabel,
            // A held loader is already out of sight and plays no exit, so it releases the app at once.
            present: nextLabel !== null || (current.present && !(current.held && current.flight === null)),
            leaving: nextLabel !== null ? false : current.leaving,
          },
    );
  }, []);
  const handleExitStart = useCallback(() => {
    setOverlay((current) =>
      current.label === null && current.flight === null ? { ...current, leaving: true } : current,
    );
  }, []);
  const handleExitComplete = useCallback(() => {
    setOverlay((current) =>
      current.label === null && current.flight === null && current.present
        ? { ...current, present: false, leaving: false }
        : current,
    );
  }, []);
  const handOff = useCallback((origin: LoaderFlightOrigin) => {
    const id = ++flights.current;
    setOverlay((current) => ({ ...current, present: true, leaving: false, flight: { ...origin, id } }));
    return new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        shown.current.delete(id);
        resolve();
      }, HANDOFF_SHOWN_DEADLINE_MS);
      shown.current.set(id, () => {
        clearTimeout(deadline);
        resolve();
      });
    });
  }, []);
  const handleShown = useCallback((id: number) => {
    shown.current.get(id)?.();
    shown.current.delete(id);
  }, []);
  const handleLanded = useCallback((id: number) => {
    setOverlay((current) => (current.flight?.id === id ? { ...current, flight: null } : current));
  }, []);
  const holdLoader = useCallback((nextHeld: boolean) => {
    setOverlay((current) => (current.held === nextHeld ? current : { ...current, held: nextHeld }));
  }, []);
  const value = useMemo(
    () => ({
      setLoadingLabel,
      isLoaderPresent: present,
      isLoaderLeaving: leaving,
      isLoaderRequested: label !== null,
      isLoaderFlying: flight !== null,
      handOff,
      holdLoader,
    }),
    [flight, handOff, holdLoader, label, leaving, present, setLoadingLabel],
  );

  useEffect(() => {
    if (!present) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [present]);

  useEffect(() => {
    if (visible || !present) return;
    const deadline = setTimeout(handleExitComplete, EXIT_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [handleExitComplete, present, visible]);

  return (
    <AppLoadingOverlayContext.Provider value={value}>
      <View className="flex-1">
        <View
          className="flex-1"
          pointerEvents={present ? "none" : "auto"}
          accessibilityElementsHidden={present}
          importantForAccessibility={present ? "no-hide-descendants" : "auto"}
        >
          {children}
        </View>
        <View
          className="absolute inset-0"
          // Android can stop the exit animation before the loader reaches scale 0, and the loader
          // then stays over the app. Once the overlay is gone, hide it there.
          style={isAndroid && !present ? { opacity: 0 } : undefined}
          pointerEvents={present ? "auto" : "none"}
          accessibilityElementsHidden={!present}
          importantForAccessibility={present ? "auto" : "no-hide-descendants"}
        >
          <LoaderFlight flight={flight} onShown={handleShown} onLanded={handleLanded}>
            {/* Keep the native SVG mounted across account loading and workspace navigation. A held
                loader leaves the screen, but the overlay keeps the app covered until it is released. */}
            <BloubLoader
              active={visible && (!held || flight !== null)}
              visible={visible && (!held || flight !== null)}
              enterInstantly={flight !== null}
              label={label ?? "Loading"}
              onExitStart={handleExitStart}
              onExitComplete={handleExitComplete}
            />
          </LoaderFlight>
        </View>
      </View>
    </AppLoadingOverlayContext.Provider>
  );
}

// Hold the app loading label for one screen, while that screen is the route on top.
// The overlay blocks the whole app, and a screen stays mounted under a pushed chat,
// so ownership needs the route as well as focus: a late focus report from the screen
// below must never raise a blocking loader over the conversation.
export function useScreenLoadingLabel(route: string, label: string | null) {
  const { setLoadingLabel } = useAppLoadingOverlay();
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const ownsOverlay = isFocused && pathname === route;

  useLayoutEffect(() => {
    if (!ownsOverlay) return;
    setLoadingLabel(label);
    return () => setLoadingLabel(null);
  }, [label, ownsOverlay, setLoadingLabel]);
}

export function useAppLoadingOverlay() {
  const value = useContext(AppLoadingOverlayContext);
  if (!value) throw new Error("useAppLoadingOverlay requires AppLoadingOverlayProvider.");
  return value;
}

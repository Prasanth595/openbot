import { type AppAppearance, DEFAULT_APP_APPEARANCE, isAppAppearance } from "@openbot/contracts/app-appearance";
import { createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";
import { syncColorScheme } from "./color-scheme";

/** The Settings control state. Set optimistically, and reverted if main refuses the write. */
export function useAppearanceChoice() {
  const [appearance, setAppearance] = createSignal<AppAppearance>(DEFAULT_APP_APPEARANCE);
  let confirmed: AppAppearance = DEFAULT_APP_APPEARANCE;
  let latestRequest = 0;
  let pending = 0;

  /** A saved value from main. A choice that is still in flight is newer, so it stays on screen. */
  function confirm(next: AppAppearance): void {
    confirmed = next;
    if (pending === 0) setAppearance(next);
  }

  function changeAppearance(next: AppAppearance): void {
    const request = ++latestRequest;
    pending += 1;
    setAppearance(next);
    void appPort()
      .setAppAppearancePreference({ appearance: next })
      .then((preference) => {
        confirmed = preference.appearance;
        if (request === latestRequest) setAppearance(preference.appearance);
      })
      .catch(() => {
        if (request === latestRequest) setAppearance(confirmed);
      })
      .finally(() => {
        pending -= 1;
      });
  }

  onSettled(() => {
    void appPort()
      .getAppAppearancePreference()
      .then((preference) => confirm(preference.appearance))
      .catch(() => undefined);
    return appPort().onAppAppearancePreference((preference) => confirm(preference.appearance));
  });

  return { appearance, changeAppearance };
}

/** This window's copy of the choice, so the first paint after a launch has the saved colors. */
const CACHED_APPEARANCE_KEY = "openbot.appearance";

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
function cachedAppearance(): AppAppearance {
  try {
    const value = window.localStorage.getItem(CACHED_APPEARANCE_KEY);
    return isAppAppearance(value) ? value : DEFAULT_APP_APPEARANCE;
  } catch {
    return DEFAULT_APP_APPEARANCE;
  }
}

/**
 * Keeps a desktop window on the appearance that main keeps. The copy in browser storage gives the
 * first paint; main's value then replaces it. The Dynamic Island does not call this: it stays dark.
 */
export function syncAppearance(): void {
  let appearance = cachedAppearance();
  const scheme = syncColorScheme(() => appearance);
  const apply = (next: AppAppearance) => {
    appearance = next;
    try {
      window.localStorage.setItem(CACHED_APPEARANCE_KEY, next);
    } catch {
      // Main's value still applies; only the next first paint can show the default.
    }
    scheme.refresh();
  };
  void appPort()
    .getAppAppearancePreference()
    .then((preference) => apply(preference.appearance))
    .catch(() => undefined);
  appPort().onAppAppearancePreference((preference) => apply(preference.appearance));
}

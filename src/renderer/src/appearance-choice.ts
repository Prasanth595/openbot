import { type AppAppearance, DEFAULT_APP_APPEARANCE } from "@openbot/contracts/app-appearance";
import { createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";

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

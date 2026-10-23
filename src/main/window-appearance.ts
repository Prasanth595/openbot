import { type AppAppearance, DEFAULT_APP_APPEARANCE } from "@openbot/contracts/app-appearance";
import { type BrowserWindow, nativeTheme } from "electron";

/** The light canvas, `--openbot-bg-canvas` in `tokens-light.css`, so a light window opens without a dark frame. */
const LIGHT_WINDOW_BACKGROUND = "#f5f5f6";

let current: AppAppearance = DEFAULT_APP_APPEARANCE;
const listeners = new Set<() => void>();

/**
 * Sets the appearance that window backgrounds follow. Main does not set `nativeTheme.themeSource`:
 * that would also change visited websites and the native menus, which follow the computer.
 */
export function setWindowAppearance(appearance: AppAppearance): void {
  current = appearance;
  for (const listener of listeners) listener();
}

/** The background a window shows before its page paints, and around it while it resizes. */
export function windowBackgroundColor(darkColor: string): string {
  const dark = current === "system" ? nativeTheme.shouldUseDarkColors : current === "dark";
  return dark ? darkColor : LIGHT_WINDOW_BACKGROUND;
}

/** Keeps an opaque window's background on the current appearance until the window closes. */
export function followAppearance(window: BrowserWindow, darkColor: string): void {
  const update = () => {
    if (!window.isDestroyed()) window.setBackgroundColor(windowBackgroundColor(darkColor));
  };
  nativeTheme.on("updated", update);
  listeners.add(update);
  window.once("closed", () => {
    nativeTheme.off("updated", update);
    listeners.delete(update);
  });
}

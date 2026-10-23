import { type BrowserWindow, nativeTheme } from "electron";

/** The light canvas, `--openbot-bg-canvas` in `tokens-light.css`, so a light window opens without a dark frame. */
const LIGHT_WINDOW_BACKGROUND = "#f5f5f6";

/**
 * The background a window shows before its page paints, and around it while it resizes. Main sets
 * `nativeTheme.themeSource` from the saved appearance, so this matches the colors the page takes
 * from `prefers-color-scheme`.
 */
export function windowBackgroundColor(darkColor: string): string {
  return nativeTheme.shouldUseDarkColors ? darkColor : LIGHT_WINDOW_BACKGROUND;
}

/** Keeps an opaque window's background on the current appearance until the window closes. */
export function followAppearance(window: BrowserWindow, darkColor: string): void {
  const update = () => {
    if (!window.isDestroyed()) window.setBackgroundColor(windowBackgroundColor(darkColor));
  };
  nativeTheme.on("updated", update);
  window.once("closed", () => nativeTheme.off("updated", update));
}

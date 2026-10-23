/**
 * The color scheme the user picks for the desktop app: follow the system, or always light or dark.
 * The main process holds it and sets Electron's `nativeTheme.themeSource` from it, so every window
 * and the native menus follow the same choice.
 *
 * The identifiers cross the IPC boundary and are saved as written. Add one, never rename one: a
 * renamed identifier reads back as the default on the next launch. The order is the Settings order.
 */
export const APP_APPEARANCES = ["system", "light", "dark"] as const;

export type AppAppearance = (typeof APP_APPEARANCES)[number];

/** Dark: OpenBot was dark only before this choice existed, so an update does not change the look. */
export const DEFAULT_APP_APPEARANCE: AppAppearance = "dark";

/** The preference as it is stored and as it crosses IPC. */
export interface AppAppearancePreference {
  appearance: AppAppearance;
}

export type SetAppAppearancePreferenceInput = AppAppearancePreference;

export function isAppAppearance(value: unknown): value is AppAppearance {
  return APP_APPEARANCES.some((appearance) => appearance === value);
}

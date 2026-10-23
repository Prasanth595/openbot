import type { AppAppearance } from "@openbot/contracts/app-appearance";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * `tokens-light.css` changes the palette when the root element has `data-openbot-color-scheme="light"`.
 * Code that cannot use the tokens in CSS reads the attribute through `@openbot/ui/document-color-scheme`.
 */
function applyColorScheme(scheme: "light" | "dark"): void {
  document.documentElement.dataset.openbotColorScheme = scheme;
}

/**
 * Keeps this window's colors on the appearance choice, and returns the function that stops it and
 * refreshes it. On the desktop the choice is already in `prefers-color-scheme`: main sets
 * `nativeTheme.themeSource` before the first window loads, so each window calls this with no
 * argument and needs no IPC. The Dynamic Island does not call it: it stays dark. The web client passes its saved choice, because a
 * browser's `prefers-color-scheme` is the system's.
 */
export function syncColorScheme(choice: () => AppAppearance = () => "system") {
  const query = window.matchMedia(LIGHT_QUERY);
  const refresh = () => {
    const appearance = choice();
    applyColorScheme(appearance === "system" ? (query.matches ? "light" : "dark") : appearance);
  };
  refresh();
  query.addEventListener("change", refresh);
  return {
    refresh,
    stop() {
      query.removeEventListener("change", refresh);
      delete document.documentElement.dataset.openbotColorScheme;
    },
  };
}

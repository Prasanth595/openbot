// How the desktop app starts and stops: at login, and when its main window closes.

/** As it crosses IPC. Null marks a choice that this run of the app does not offer. */
export interface AppBehaviorPreference {
  /** Open OpenBot when the user signs in. Null in a development run and on a server. */
  launchAtLogin: boolean | null;
  /**
   * Hide the main window on close and show a tray icon, rather than quit. Null on macOS, where
   * OpenBot always keeps running after its window closes, and on a server.
   */
  keepRunningInBackground: boolean | null;
}

/** The choices to change. A choice that is not given keeps its value. */
export interface AppBehaviorPreferenceChange {
  launchAtLogin?: boolean;
  keepRunningInBackground?: boolean;
}

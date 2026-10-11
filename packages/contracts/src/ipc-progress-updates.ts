import { isBoolean, isDynamicRecord } from "./runtime-values";

// The app choice to let agents show progress updates in the chat while they work.

/** As it is stored and as it crosses IPC. */
export interface ProgressUpdatePreference {
  /** Agents can post short checkpoints during a turn that works on a user message. */
  enabled: boolean;
}

/** Off, so an agent answers only at the end of its turn, as every agent did before the setting existed. */
export const DEFAULT_PROGRESS_UPDATE_PREFERENCE: ProgressUpdatePreference = { enabled: false };

/** The switch as main, the preload or a remote host sends it. Throws on any other shape. */
export function decodeProgressUpdatePreference(value: unknown): ProgressUpdatePreference {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid progress update setting.");
  return { enabled: value.enabled };
}

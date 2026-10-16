import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { DEFAULT_LOOP_GUARD_SETTINGS, LOOP_GUARD_LIMITS, type LoopGuardSettings } from "../backend/agent/loop-guard";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile } from "./preference-file";

/**
 * The loop guard settings of this computer, read once at start. The backend reads them for each
 * completed tool step, so they are held in memory.
 *
 * The file is optional: `{ "version": 1, "enabled": true, "warnAt": 3, "stopAt": 6 }`. A field that
 * is missing or out of range keeps its default, and a file that is missing or not JSON gives the
 * defaults, which warn at 3 identical failures and never stop a turn.
 */
export class LoopGuardPreferenceStore {
  readonly #path: string;
  #settings: LoopGuardSettings = { ...DEFAULT_LOOP_GUARD_SETTINGS };

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, parseLoopGuardSettings));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#settings = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): LoopGuardSettings {
    return { ...this.#settings };
  }
}

function parseLoopGuardSettings(parsed: unknown): LoopGuardSettings | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
  const defaults = DEFAULT_LOOP_GUARD_SETTINGS;
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaults.enabled,
    warnAt: isThreshold(parsed.warnAt) ? parsed.warnAt : defaults.warnAt,
    stopAt: parsed.stopAt === null || isThreshold(parsed.stopAt) ? parsed.stopAt : defaults.stopAt,
  };
}

function isThreshold(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= LOOP_GUARD_LIMITS.min && value <= LOOP_GUARD_LIMITS.max;
}

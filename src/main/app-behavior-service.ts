import type { AppBehaviorPreference, AppBehaviorPreferenceChange } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import type { LoginItem, LoginItemFailure } from "./login-item";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const logger = createOpenBotLogger("app-behavior");

/**
 * How OpenBot starts and stops on this computer.
 *
 * The keep-running choice is stored here, because main reads it each time the main window closes.
 * The launch-at-login choice is not stored: the operating system holds it, and the user can change
 * it there.
 *
 * A file that is missing, unreadable as JSON or without the switch reads as off. Writes of the file
 * and of the login item are chained for the reason `update-preference-store.ts` chains its own: on
 * Linux, a removal of the autostart entry must not finish before an earlier write of it.
 */
export class AppBehaviorService {
  readonly #path: string;
  /** Null where this run cannot open itself at login. */
  readonly #loginItem: LoginItem | null;
  /** False on macOS, which always keeps running, and on a server, which has no window to close. */
  readonly #offersBackground: boolean;
  #keepRunningInBackground = false;
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(keepRunningInBackground: boolean) => void>();

  constructor(input: { path: string; loginItem: LoginItem | null; offersBackground: boolean }) {
    this.#path = input.path;
    this.#loginItem = input.loginItem;
    this.#offersBackground = input.offersBackground;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): boolean | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.keepRunningInBackground)
            ? parsed.keepRunningInBackground
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success !== null) this.#keepRunningInBackground = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  /** Read on each close of the main window. */
  get keepRunningInBackground(): boolean {
    return this.#offersBackground && this.#keepRunningInBackground;
  }

  readonly get = Effect.fn("AppBehavior.get")(function* (this: AppBehaviorService) {
    const preference: AppBehaviorPreference = {
      launchAtLogin: yield* this.#readLoginItem(),
      keepRunningInBackground: this.#offersBackground ? this.#keepRunningInBackground : null,
    };
    return preference;
  });

  /**
   * A login item that cannot be read is not offered, as in a development run. The keep-running
   * switch does not depend on it, so its failure must not hide that switch or fail a save of it.
   */
  #readLoginItem(): Effect.Effect<boolean | null> {
    if (!this.#loginItem) return Effect.succeed(null);
    return this.#loginItem.read().pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("The login item could not be read.", toLogValue(error));
          return null;
        }),
      ),
    );
  }

  readonly set = Effect.fn("AppBehavior.set")(function* (
    this: AppBehaviorService,
    change: AppBehaviorPreferenceChange,
  ): Effect.fn.Return<AppBehaviorPreference, LoginItemFailure | PreferenceFileFailure> {
    const launchAtLogin = change.launchAtLogin;
    const loginItem = this.#loginItem;
    if (launchAtLogin !== undefined && loginItem)
      yield* this.#writes.withPermit(Effect.uninterruptible(loginItem.write(launchAtLogin)));
    const keepRunningInBackground = change.keepRunningInBackground;
    if (keepRunningInBackground !== undefined && this.#offersBackground) {
      yield* this.#writes.withPermit(
        Effect.uninterruptible(
          writePreferenceFile(this.#path, { version: 1, keepRunningInBackground }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                this.#keepRunningInBackground = keepRunningInBackground;
              }),
            ),
          ),
        ),
      );
      for (const listener of this.#listeners) listener(this.keepRunningInBackground);
    }
    return yield* this.get();
  });

  /** Points an existing login item at the running copy, which an update can move on Linux. */
  refreshLoginItem(): Effect.Effect<void, LoginItemFailure> {
    return this.#loginItem ? this.#writes.withPermit(Effect.uninterruptible(this.#loginItem.refresh())) : Effect.void;
  }

  /** Called when the keep-running choice is saved. */
  subscribe(listener: (keepRunningInBackground: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

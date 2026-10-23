import {
  DEFAULT_REMOTE_NETWORK_ROUTE,
  isRemoteNetworkRoute,
  type RemoteNetworkRoutePreference,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The network that devices use to connect to this computer. The host reads it each time it connects
 * to Signal, so it is held in memory after `load`.
 *
 * A file that is missing, unreadable as JSON or names an unknown route reads as `openbot`, which is
 * how every connection worked before the setting existed. Writes are chained for the reason
 * `update-preference-store.ts` chains its own: an earlier rename that lands last would persist the
 * value the user just changed.
 */
export class RemoteNetworkRoutePreferenceStore {
  readonly #path: string;
  #preference: RemoteNetworkRoutePreference = { route: DEFAULT_REMOTE_NETWORK_ROUTE };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): RemoteNetworkRoutePreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isRemoteNetworkRoute(parsed.route)
            ? { route: parsed.route }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): RemoteNetworkRoutePreference {
    return { ...this.#preference };
  }

  readonly set = Effect.fn("RemoteNetworkRoutePreference.set")(function* (
    this: RemoteNetworkRoutePreferenceStore,
    { route }: RemoteNetworkRoutePreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, route }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = { route };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}

import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  PUSH_NOTIFICATION_SOUNDS,
  PUSH_NOTIFICATIONS_CODECS,
  PUSH_NOTIFICATIONS_ROUTES,
  type PushNotificationRegistration,
} from "@openbot/contracts/team-protocol/push-notifications-v1";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/** One phone that gets notifications, with what the host needs to know what its member can see. */
export interface StoredPushRegistration {
  sessionId: string;
  memberId: string;
  /** The Team API protocol and capabilities of the phone, which decide the agents it can see. */
  protocol: number;
  capabilities: string[];
  value: PushNotificationRegistration;
}

/** More phones than members can have sessions is a fault. The oldest go first. */
const REGISTRATION_LIMIT = 500;
const decodeRegistration = PUSH_NOTIFICATIONS_CODECS.get(PUSH_NOTIFICATIONS_ROUTES.register)?.request;

/**
 * The phones of this host that get notifications. A phone registers when it connects, but a phone in
 * a pocket does not connect after this computer restarts, so the host keeps the list in a file that
 * only the user can read. Each entry has the push token and the sealing secret of one phone.
 *
 * Writes are chained, as `NotificationPreferenceStore` chains its own.
 */
export class PushNotificationStore {
  readonly #path: string;
  #registrations: StoredPushRegistration[] = [];
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeFile));
      if (Result.isSuccess(loaded)) this.#registrations = loaded.success;
      else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  list(): readonly StoredPushRegistration[] {
    return this.#registrations;
  }

  /** Replaces the list. The phone's `away` changes all the time and is not kept: a restart starts away. */
  replace(registrations: readonly StoredPushRegistration[]): Effect.Effect<void, PreferenceFileFailure> {
    const next = registrations
      .slice(-REGISTRATION_LIMIT)
      .map((registration) => ({ ...registration, value: { ...registration.value, away: true } }));
    return this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() =>
          JSON.stringify(next) === JSON.stringify(this.#registrations)
            ? Effect.void
            : writePreferenceFile(this.#path, { version: 1, registrations: next }).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    this.#registrations = next;
                  }),
                ),
              ),
        ),
      ),
    );
  }
}

/** An entry that the current contract does not accept is dropped; the phone registers it again. */
function decodeFile(parsed: unknown): StoredPushRegistration[] {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.registrations)) return [];
  return parsed.registrations.flatMap((entry): StoredPushRegistration[] => {
    if (
      !isDynamicRecord(entry) ||
      !isString(entry.sessionId) ||
      !isString(entry.memberId) ||
      typeof entry.protocol !== "number" ||
      !Array.isArray(entry.capabilities) ||
      !entry.capabilities.every(isString)
    )
      return [];
    let value: PushNotificationRegistration | null;
    try {
      value = readPushRegistration(decodeRegistration?.(entry.value));
    } catch {
      return [];
    }
    if (!value) return [];
    const { sessionId, memberId, protocol, capabilities } = entry;
    return [{ sessionId, memberId, protocol, capabilities, value }];
  });
}

/** Reads a registration that the frozen `push-notifications-v1` codec has accepted. */
export function readPushRegistration(value: unknown): PushNotificationRegistration | null {
  if (!isDynamicRecord(value)) return null;
  const {
    serverId,
    token,
    environment,
    secret,
    locale,
    away,
    level,
    mutedUntil,
    preview,
    sound,
    liveActivityStartedAt,
  } = value;
  if (!isString(serverId) || (token !== null && !isString(token)) || !isString(secret) || !isString(locale))
    return null;
  if (environment !== "production" && environment !== "development") return null;
  if (level !== "all" && level !== "needs-me") return null;
  const choice = PUSH_NOTIFICATION_SOUNDS.find((known) => known === sound);
  if (!choice) return null;
  if (typeof away !== "boolean" || typeof preview !== "boolean") return null;
  if (mutedUntil !== null && typeof mutedUntil !== "number") return null;
  if (liveActivityStartedAt !== null && typeof liveActivityStartedAt !== "number") return null;
  return {
    serverId,
    token,
    environment,
    secret,
    locale,
    away,
    level,
    mutedUntil,
    preview,
    sound: choice,
    liveActivityStartedAt,
  };
}

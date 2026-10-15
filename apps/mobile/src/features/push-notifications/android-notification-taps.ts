import { ANDROID_NOTIFICATION_SEALED_LIMIT } from "@openbot/contracts/android-notification-relay";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { encodeLiveActivityBytes, liveActivityHostSecret } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { openSealedLiveActivity } from "../live-activity/model/live-activity-open";

interface AndroidTapOptions {
  servers(): readonly { id: string }[];
  secret(): Promise<Uint8Array>;
  open(agentId: string, serverId: string): void;
}
// Expo can replay the last response after a route remount. Bound the retained ciphertext identities.
const handled = new Set<string>();

/** The only Android notification navigation input is a seal from a current local host. */
export class AndroidNotificationTaps {
  readonly #options: AndroidTapOptions;
  #disposed = false;
  #pending = new Set<string>();

  constructor(options: AndroidTapOptions) {
    this.#options = options;
  }

  async receive(identifier: string, data: unknown): Promise<void> {
    if (this.#disposed || !identifier || identifier.length > 512 || !isDynamicRecord(data)) return;
    const sealed = data.sealed;
    if (
      !isString(sealed) ||
      !sealed ||
      sealed.length > ANDROID_NOTIFICATION_SEALED_LIMIT ||
      !/^[A-Za-z0-9_-]+$/u.test(sealed)
    )
      return;
    const key = `${identifier}:${sealed}`;
    if (handled.has(key) || this.#pending.has(key)) return;
    this.#pending.add(key);
    try {
      const secret = await this.#options.secret();
      if (this.#disposed) return;
      for (const server of this.#options.servers()) {
        const keys = pushNotificationKeys(liveActivityHostSecret(secret, server.id));
        const text = openSealedLiveActivity(
          sealed,
          encodeLiveActivityBytes(keys.seal),
          encodeLiveActivityBytes(keys.tag),
        );
        if (text === null) continue;
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          return;
        }
        if (
          !isDynamicRecord(value) ||
          value.serverId !== server.id ||
          !isString(value.agentId) ||
          !value.agentId ||
          value.agentId.length > 128 ||
          !isString(value.title) ||
          !isString(value.body) ||
          (value.threadId !== null && !isString(value.threadId)) ||
          (value.kind !== "reply" &&
            value.kind !== "failed" &&
            value.kind !== "input" &&
            value.kind !== "approval" &&
            value.kind !== "browser")
        )
          return;
        if (this.#disposed || !this.#options.servers().some((candidate) => candidate.id === server.id)) return;
        handled.add(key);
        if (handled.size > 64) {
          const first = handled.values().next().value;
          if (first !== undefined) handled.delete(first);
        }
        this.#options.open(value.agentId, server.id);
        return;
      }
    } finally {
      this.#pending.delete(key);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending.clear();
  }
}

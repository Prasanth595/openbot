import type { NotificationSound } from "@openbot/contracts/notification-relay";
import {
  ANDROID_PUSH_NOTIFICATIONS_ROUTES,
  type AndroidPushNotificationRegistration,
} from "@openbot/contracts/team-protocol/android-push-notifications-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { PushNotificationsNative } from "./push-notifications-native.types";

export interface AndroidPushState {
  servers: readonly { id: string; state: string }[];
  foreground: boolean;
  ready: boolean;
  enabled: boolean;
  playSound: boolean;
  sound: NotificationSound;
  locale: string;
  settings: Readonly<Record<string, { level: "all" | "needs-me" | "nothing"; mute: { until: number | null } | null }>>;
  secret(serverId: string): string;
}

interface AndroidPushOptions {
  native: Pick<PushNotificationsNative, "permission" | "deviceToken" | "onDeviceToken">;
  supports(serverId: string): boolean;
  post(serverId: string, path: string, body: TeamProtocolV2Json): Promise<unknown>;
  permission(value: "granted" | "denied" | "undetermined"): void;
  now?: () => number;
  schedule?: (run: () => void, milliseconds: number) => () => void;
}

/** Owns Android registration order, token refresh, foreground permission reads and teardown. */
export class AndroidPushRegistration {
  readonly #options: AndroidPushOptions;
  #state: AndroidPushState | null = null;
  #permission: "granted" | "denied" | "undetermined" | null = null;
  #token: string | null = null;
  #tokenReady = false;
  #tokenRevision = 0;
  readonly #touched = new Set<string>();
  #permissionGeneration = 0;
  #permissionPending = false;
  #disposed = false;
  #cancelRetry: (() => void) | null = null;
  readonly #sent = new Map<string, { key: string; removed: boolean }>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #unsubscribe: () => void;

  constructor(options: AndroidPushOptions) {
    this.#options = options;
    this.#unsubscribe = options.native.onDeviceToken((token) => {
      if (this.#disposed) return;
      this.#tokenRevision += 1;
      this.#token = token;
      this.#tokenReady = true;
      this.#sync();
    });
  }

  update(state: AndroidPushState): void {
    if (this.#disposed) return;
    const previous = this.#state;
    this.#state = state;
    if (
      state.ready &&
      state.enabled &&
      state.foreground &&
      (!previous?.foreground || !previous.ready || !previous.enabled)
    )
      void this.#readPermission();
    if (!state.foreground || !state.enabled) {
      this.#permissionGeneration += 1;
      this.#permissionPending = false;
    }
    this.#sync();
  }

  async #readPermission(): Promise<void> {
    const generation = ++this.#permissionGeneration;
    this.#permissionPending = true;
    try {
      const permission = await this.#options.native.permission();
      if (this.#disposed || generation !== this.#permissionGeneration) return;
      this.#permissionPending = false;
      this.#permission = permission;
      this.#options.permission(permission);
      if (permission !== "granted") {
        this.#token = null;
        this.#tokenReady = true;
        this.#sync();
        return;
      }
      const tokenRevision = this.#tokenRevision;
      const token = await this.#options.native.deviceToken();
      if (this.#disposed || generation !== this.#permissionGeneration) return;
      if (tokenRevision === this.#tokenRevision) this.#token = token;
      this.#tokenReady = true;
      this.#sync();
    } catch {
      if (this.#disposed || generation !== this.#permissionGeneration) return;
      this.#retry();
      this.#sync();
    }
  }

  #retry(): void {
    if (this.#disposed || this.#cancelRetry) return;
    const schedule =
      this.#options.schedule ??
      ((run: () => void, milliseconds: number) => {
        const timer = setTimeout(run, milliseconds);
        return () => clearTimeout(timer);
      });
    this.#cancelRetry = schedule(() => {
      this.#cancelRetry = null;
      if (this.#state?.foreground && this.#state.enabled) void this.#readPermission();
      this.#sync();
    }, 30_000);
  }

  #sync(): void {
    const state = this.#state;
    if (this.#disposed || !state?.ready) return;
    // A foreground return must confirm permission before it can use the previous token again.
    if (
      state.enabled &&
      (this.#permissionPending || this.#permission === null || (this.#permission === "granted" && !this.#tokenReady))
    )
      return;
    const now = (this.#options.now ?? Date.now)();
    for (const server of state.servers) {
      if (server.state !== "online") {
        this.#sent.delete(server.id);
        continue;
      }
      if (!this.#options.supports(server.id)) continue;
      const setting = state.settings[server.id] ?? { level: "all", mute: null };
      const muted =
        setting.mute?.until === null ? Infinity : setting.mute && setting.mute.until > now ? setting.mute.until : null;
      const value: AndroidPushNotificationRegistration | null =
        state.enabled &&
        this.#permission === "granted" &&
        this.#token &&
        setting.level !== "nothing" &&
        muted !== Infinity
          ? {
              serverId: server.id,
              transport: "fcm",
              token: this.#token,
              environment: "production",
              secret: state.secret(server.id),
              locale: state.locale,
              away: !state.foreground,
              level: setting.level,
              mutedUntil: muted === null ? null : Math.ceil(muted / 1_000),
              preview: false,
              sound: state.playSound ? state.sound : "none",
              liveActivityStartedAt: null,
            }
          : null;
      const key = JSON.stringify(value);
      if (this.#sent.get(server.id)?.key === key) continue;
      this.#sent.set(server.id, { key, removed: value === null });
      if (value) this.#touched.add(server.id);
      this.#enqueue(server.id, async () => {
        if (this.#disposed) return;
        try {
          await this.#options.post(
            server.id,
            value ? ANDROID_PUSH_NOTIFICATIONS_ROUTES.register : ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove,
            value ? { ...value } : {},
          );
        } catch {
          if (this.#sent.get(server.id)?.key === key) this.#sent.delete(server.id);
          this.#retry();
        }
      });
    }
  }

  #enqueue(serverId: string, run: () => Promise<void>): void {
    this.#queues.set(serverId, (this.#queues.get(serverId) ?? Promise.resolve()).then(run));
  }

  /** Includes registration work already in flight before removing each host entry. */
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#permissionGeneration += 1;
    this.#permissionPending = false;
    this.#unsubscribe();
    this.#cancelRetry?.();
    this.#cancelRetry = null;
    const servers = [...this.#touched];
    this.#touched.clear();
    this.#sent.clear();
    this.#state = null;
    this.#token = null;
    await Promise.all(
      servers.map(async (serverId) => {
        await this.#queues.get(serverId);
        await this.#options.post(serverId, ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove, {}).catch(() => undefined);
      }),
    );
    this.#queues.clear();
  }
}

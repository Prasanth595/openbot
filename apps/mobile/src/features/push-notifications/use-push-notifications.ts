import {
  PUSH_NOTIFICATIONS_ROUTES,
  type PushNotificationRegistration,
} from "@openbot/contracts/team-protocol/push-notifications-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { encodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveActivityHost } from "@/features/live-activity/model/live-activity-host";
import { liveActivityHostKeys, loadLiveActivitySecret } from "@/features/live-activity/model/live-activity-keys";
import { useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import {
  loadPushNotificationPreference,
  mutedUntil,
  registeredSound,
  serverNotificationSetting,
  setNotificationPermission,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { pushEnvironment } from "@/shared/lib/push-environment";
import { currentLocale } from "@/shared/lib/text";
import { pushNotificationsNative as native } from "./push-notifications-native";

interface PushNotificationsInput {
  servers: readonly Pick<MobileServer, "id" | "name" | "state">[];
  /** While the app is on screen, the hosts send nothing: the app shows the event itself. */
  foreground: boolean;
  post(serverId: string, path: string, body: TeamProtocolV2Json): Promise<unknown>;
  supportsPush(serverId: string): boolean;
}

/** A request that failed is sent again after this time, or at the next change or connection. */
const RETRY_MS = 30_000;

/**
 * Gives each connected server that supports `push-notifications-v1` the push token of the app, the
 * events that the user chose, and whether the app is on screen. With notifications off, the phone
 * still registers without a token when the Live Activity plays the sound, because the host decides
 * when it does. A host keeps the registration also when it restarts, so the phone tells each host
 * again after each connection, and removes it when the user turns both off for that host or signs out.
 */
export function usePushNotifications({ servers, foreground, post, supportsPush }: PushNotificationsInput): void {
  const preference = usePushNotificationPreference();
  const liveActivities = useLiveActivitiesPreference();
  const activityHost = useLiveActivityHost();
  const [token, setToken] = useState<string | null>(null);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  /** What the phone last told each host, so an unchanged state is not sent again. */
  const registered = useRef(new Map<string, { key: string; removed: boolean }>());
  const postRef = useRef(post);
  postRef.current = post;
  const queues = useRef(new Map<string, Promise<void>>());
  /**
   * A removal cannot reach a host before the registration that it removes. Each server has its own
   * queue, so a host that does not answer does not hold the others.
   */
  const enqueue = useCallback((serverId: string, run: () => Promise<void>) => {
    queues.current.set(
      serverId,
      (queues.current.get(serverId) ?? Promise.resolve()).then(run).catch(() => undefined),
    );
  }, []);
  const [attempt, setAttempt] = useState(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = preference.ready && preference.enabled;

  useEffect(() => {
    if (!native) return;
    let current = true;
    void loadLiveActivitySecret().then(
      (loaded) => {
        if (current) setSecret(loaded);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (native && foreground) void loadPushNotificationPreference().catch(() => undefined);
  }, [foreground]);

  // iOS asks once. The answer can change in iOS Settings while the app is away, so it is read again.
  useEffect(() => {
    if (!native || !enabled || !foreground) return;
    let current = true;
    void (async () => {
      const permission = await native.permission();
      if (!current) return;
      setNotificationPermission(permission);
      if (permission !== "granted") return;
      const device = await native.deviceToken();
      if (current) setToken(device);
    })().catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled, foreground]);

  useEffect(() => native?.onDeviceToken(setToken), []);

  // The file is written again only when a server or its name changes.
  useEffect(() => {
    if (!native || !secret) return;
    try {
      native.writeKeys(
        servers.map(({ id, name }) => {
          const keys = pushNotificationKeys(liveActivityHostKeys(secret, id).secret);
          // `NotificationService.swift` reads these field names.
          return {
            serverId: id,
            name,
            seal: encodeLiveActivityBytes(keys.seal),
            tag: encodeLiveActivityBytes(keys.tag),
          };
        }),
      );
    } catch {
      // Without the file the extension shows the app name only.
    }
  }, [secret, servers]);

  useEffect(() => {
    if (!native || !preference.ready || !liveActivities.ready || !secret) return;
    // Wait for iOS and the token, so a phone that has notifications does not remove them at launch.
    if (preference.enabled && preference.permission === null) return;
    const deliverable = preference.enabled && preference.permission === "granted";
    if (deliverable && !token) return;
    // With notifications off, the Live Activity can still play the sound, which the host starts.
    const activitySound = liveActivities.enabled && preference.playSound;
    const now = Date.now();
    for (const server of servers) {
      // A host forgets nothing when the phone goes offline, but the phone tells it again on reconnect.
      if (server.state !== "online") {
        registered.current.delete(server.id);
        continue;
      }
      if (!supportsPush(server.id)) continue;
      const setting = serverNotificationSetting(preference, server.id);
      const muted = mutedUntil(setting, now);
      const registration: PushNotificationRegistration | null =
        (deliverable || activitySound) && setting.level !== "nothing" && muted !== Number.POSITIVE_INFINITY
          ? {
              serverId: server.id,
              token: deliverable ? token : null,
              environment: pushEnvironment(),
              secret: encodeLiveActivityBytes(liveActivityHostKeys(secret, server.id).secret),
              locale: currentLocale(),
              away: !foreground,
              level: setting.level,
              mutedUntil: muted === null ? null : Math.ceil(muted / 1_000),
              preview: preference.preview,
              sound: registeredSound(preference),
              liveActivityStartedAt:
                activityHost.serverId === server.id && activityHost.startedAt !== null
                  ? Math.floor(activityHost.startedAt / 1_000)
                  : null,
            }
          : null;
      // A retry after a failed request sends the state again.
      const key = `${attempt}:${JSON.stringify(registration)}`;
      if (registered.current.get(server.id)?.key === key) continue;
      registered.current.set(server.id, { key, removed: registration === null });
      const serverId = server.id;
      enqueue(serverId, async () => {
        try {
          await postRef.current(
            serverId,
            registration ? PUSH_NOTIFICATIONS_ROUTES.register : PUSH_NOTIFICATIONS_ROUTES.remove,
            registration ? { ...registration } : {},
          );
        } catch {
          if (registered.current.get(serverId)?.key !== key) return;
          registered.current.delete(serverId);
          retry.current ??= setTimeout(() => {
            retry.current = null;
            setAttempt((count) => count + 1);
          }, RETRY_MS);
        }
      });
    }
  }, [servers, foreground, token, secret, preference, liveActivities, activityHost, supportsPush, enqueue, attempt]);

  useEffect(() => {
    const sent = registered.current;
    return () => {
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      // Sign-out removes the workspace. Its hosts must not notify about it, and the extension must not
      // open a notification of it. The requests go at once: the server connections close after this
      // cleanup. A host that does not get one learns it from the account service, which refuses the
      // ended session.
      for (const [serverId, { removed }] of sent) {
        if (!removed) void postRef.current(serverId, PUSH_NOTIFICATIONS_ROUTES.remove, {}).catch(() => undefined);
      }
      sent.clear();
      try {
        native?.removeKeys();
      } catch {
        // The keys open nothing after sign-out: the phone secret changes.
      }
    };
  }, []);
}

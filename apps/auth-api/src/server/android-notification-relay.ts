import {
  ANDROID_NOTIFICATION_CHANNEL_PREFIX,
  type AndroidNotificationRelayPush,
} from "@openbot/contracts/android-notification-relay";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { importPKCS8, SignJWT } from "jose";
import type { ApnsRelayResult } from "./live-activity-relay";

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface FcmNotificationSender {
  sendNotification(push: AndroidNotificationRelayPush): Effect.Effect<ApnsRelayResult>;
}

type FcmResponse =
  | { kind: "token"; accessToken: string; expiresIn: number }
  | { kind: "message"; name: string }
  | { kind: "unregistered" }
  | { kind: "invalid" };
type RelayFetch = (input: string, init: RequestInit) => Promise<Response>;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TIMEOUT_MS = 5_000;
const RESPONSE_LIMIT = 8_192;

/** Only generic brand text and authenticated ciphertext leave the account service. */
export class FcmRelaySender implements FcmNotificationSender {
  readonly #config: FcmConfig;
  readonly #fetch: RelayFetch;
  readonly #now: () => number;
  #key: Awaited<ReturnType<typeof importPKCS8>> | null = null;
  #token: { value: string; expiresAt: number } | null = null;

  constructor(config: FcmConfig, fetch: RelayFetch, now: () => number = Date.now) {
    this.#config = config;
    this.#fetch = fetch;
    this.#now = now;
  }

  sendNotification = Effect.fn("FcmRelay.sendNotification")(function* (
    this: FcmRelaySender,
    push: AndroidNotificationRelayPush,
  ) {
    return yield* Effect.tryPromise({
      try: async (signal): Promise<ApnsRelayResult> => {
        const token = await this.#accessToken(signal);
        const response = await this.#fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.#config.projectId)}/messages:send`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
            body: JSON.stringify({
              message: {
                token: push.token,
                notification: { title: "OpenBot", body: "OpenBot" },
                // Expo 57 reads Android content.data from the JSON value of FCM data.body.
                data: { body: JSON.stringify({ sealed: push.sealed }) },
                android: {
                  priority: "high",
                  ttl: `${Math.max(0, Math.min(86_400, push.timestamp + 86_400 - Math.floor(this.#now() / 1_000)))}s`,
                  notification: { channel_id: `${ANDROID_NOTIFICATION_CHANNEL_PREFIX}${push.sound ?? "none"}` },
                },
              },
            }),
          },
        );
        const body = await readFcmResponse(response);
        if (response.ok)
          return body.kind === "message" && body.name.startsWith(`projects/${this.#config.projectId}/messages/`)
            ? "sent"
            : "unavailable";
        if (response.status === 401) this.#token = null;
        if (response.status === 404 && body.kind === "unregistered") return "gone";
        // INVALID_ARGUMENT can describe our envelope, so it must not erase a usable device token.
        return response.status === 400 || response.status === 403 ? "rejected" : "unavailable";
      },
      catch: () => "unavailable" as const,
    }).pipe(Effect.catch(() => Effect.succeed("unavailable" as const)));
  });

  #accessToken(signal: AbortSignal): Promise<string> {
    if (this.#token && this.#token.expiresAt - 60_000 > this.#now()) return Promise.resolve(this.#token.value);
    // Workers cannot share a pending request promise across invocations. Cache resolved tokens only.
    return this.#loadToken(signal);
  }

  async #loadToken(signal: AbortSignal): Promise<string> {
    this.#key ??= await importPKCS8(this.#config.privateKey, "RS256");
    const now = Math.floor(this.#now() / 1_000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.#config.clientEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3_600)
      .sign(this.#key);
    const response = await this.#fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    const body = await readFcmResponse(response);
    if (!response.ok || body.kind !== "token") throw new Error("The Android push sender is unavailable.");
    this.#token = { value: body.accessToken, expiresAt: this.#now() + body.expiresIn * 1_000 };
    return body.accessToken;
  }
}

async function readFcmResponse(response: Response): Promise<FcmResponse> {
  const reader = response.body?.getReader();
  if (!reader) return { kind: "invalid" };
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > RESPONSE_LIMIT) throw new Error("The Android push response is too large.");
      parts.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { kind: "invalid" };
  }
  if (!isDynamicRecord(value)) return { kind: "invalid" };
  if (
    isString(value.access_token) &&
    /^[A-Za-z0-9._~-]{1,4096}$/u.test(value.access_token) &&
    value.token_type === "Bearer" &&
    typeof value.expires_in === "number" &&
    Number.isSafeInteger(value.expires_in) &&
    value.expires_in >= 120 &&
    value.expires_in <= 3_600
  ) {
    return { kind: "token", accessToken: value.access_token, expiresIn: value.expires_in };
  }
  if (isString(value.name)) return { kind: "message", name: value.name };
  if (
    isDynamicRecord(value.error) &&
    Array.isArray(value.error.details) &&
    value.error.details.some(
      (detail) =>
        isDynamicRecord(detail) &&
        detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
        detail.errorCode === "UNREGISTERED",
    )
  )
    return { kind: "unregistered" };
  return { kind: "invalid" };
}

let shared: { config: FcmConfig; sender: FcmRelaySender } | null = null;
export function sharedFcmSender(config: FcmConfig): FcmRelaySender {
  if (
    shared &&
    shared.config.projectId === config.projectId &&
    shared.config.clientEmail === config.clientEmail &&
    shared.config.privateKey === config.privateKey
  )
    return shared.sender;
  const sender = new FcmRelaySender(config, (input, init) => fetch(input, init));
  shared = { config, sender };
  return sender;
}

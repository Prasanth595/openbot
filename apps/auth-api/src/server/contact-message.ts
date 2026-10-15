import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { CONTACT_LIMITS, contactTopicLabel } from "../lib/contact";
import {
  type AuthOperationError,
  AuthServiceError,
  emailDeliveryFailure,
  isEmailDeliveryFailure,
  normalizeEmail,
} from "./auth-service";
import type { ContactMessageDelivery } from "./types";

export interface ContactMessageServices {
  /** False when the limit for this key is spent. */
  allow(key: string): Effect.Effect<boolean, AuthOperationError>;
  delivery: () => ContactMessageDelivery | null;
}

const ContactForm = Schema.Struct({
  name: Schema.optional(Schema.String),
  email: Schema.String,
  company: Schema.optional(Schema.String),
  topic: Schema.String,
  message: Schema.String,
});

// Each message spends the hourly quota of the mailbox that also sends sign-in codes, so one total
// limit stops a flood from different addresses before it blocks sign-in.
const TOTAL_LIMIT_KEY = "all";
const RATE_LIMIT_RETRY_SECONDS = 60;

export const sendContactMessage = Effect.fn("ContactMessage.send")(function* (
  services: ContactMessageServices,
  input: DynamicRecord,
  sourceIp: string,
) {
  const invalid = () => new AuthServiceError(400, "invalid_contact", "The message is invalid.");
  const body = yield* Schema.decodeUnknownEffect(ContactForm)(input).pipe(Effect.mapError(invalid));
  const name = optionalLine(body.name, CONTACT_LIMITS.name);
  const company = optionalLine(body.company, CONTACT_LIMITS.company);
  const topic = contactTopicLabel(body.topic);
  const message = body.message.trim();
  if (name === undefined || company === undefined || !topic || !message || message.length > CONTACT_LIMITS.message)
    return yield* invalid();
  const email = yield* Effect.try({
    try: () => normalizeEmail(body.email),
    catch: (error) => (error instanceof AuthServiceError ? error : invalid()),
  });

  for (const key of [`ip:${sourceIp}`, TOTAL_LIMIT_KEY]) {
    if (!(yield* services.allow(key))) {
      return yield* new AuthServiceError(
        429,
        "contact_rate_limited",
        "Too many messages were sent. Try again later.",
        RATE_LIMIT_RETRY_SECONDS,
      );
    }
  }

  const delivery = services.delivery();
  if (!delivery)
    return yield* new AuthServiceError(503, "email_delivery_not_configured", "Email delivery is unavailable.");
  yield* delivery
    .send({ name, email, company, topic, message })
    .pipe(
      Effect.mapError((error) =>
        isEmailDeliveryFailure(error)
          ? emailDeliveryFailure(error.message, "OpenBot could not send the message.")
          : new AuthServiceError(502, "email_delivery_failed", "OpenBot could not send the message."),
      ),
    );
});

/** One line of text, or `null` when it is empty. `undefined` when it is too long or has a line break. */
function optionalLine(value: string | undefined, limit: number): string | null | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.length > limit || /[\r\n]/u.test(trimmed) ? undefined : trimmed;
}

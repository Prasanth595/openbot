import { Effect } from "effect";
import type { MessagingAdapterError } from "./messaging-types";

/**
 * The most names one prompt or tool call looks up. Each is one platform call on a cache miss, and the
 * prompt context has a short deadline.
 */
const NAME_LOOKUPS = 20;

/**
 * The display name of each user id, for `withMentionNames`. An id whose lookup fails, or that is past
 * the lookup limit, keeps no name and so stays an id.
 */
export function mentionNames(
  ids: Iterable<string>,
  nameOf: (userId: string) => Effect.Effect<string, MessagingAdapterError>,
): Effect.Effect<ReadonlyMap<string, string>> {
  return Effect.forEach(
    [...new Set(ids)].slice(0, NAME_LOOKUPS),
    (id) =>
      nameOf(id).pipe(
        Effect.map((name) => [id, name.replace(/\s+/g, " ").trim()] as const),
        Effect.catch(() => Effect.succeed([id, ""] as const)),
      ),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => new Map(entries.filter(([id, name]) => name && name !== id))));
}

/** Writes each `@<id>` that has a name as `@<name>`. */
export function withMentionNames(text: string, names: ReadonlyMap<string, string>): string {
  if (names.size === 0) return text;
  return text.replace(/@([A-Za-z0-9]+)/g, (mention, id: string) => {
    const name = names.get(id);
    return name ? `@${name}` : mention;
  });
}

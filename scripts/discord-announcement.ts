// What the Discord release posts of the desktop app and the mobile app share: the checks of the
// highlights and the post through a channel webhook. Each app has its own file, version, webhook
// and workflow: `discord-release-announcement.ts` and `discord-mobile-release-announcement.ts`.
//
// No package imports: the release workflows run this before `bun install`.

export const MIN_HIGHLIGHTS = 3;
export const MAX_HIGHLIGHTS = 5;
/** The longest message that Discord accepts. */
export const MAX_CONTENT = 2000;
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b/;
/** `@everyone`, `@here`, and user, role and channel mentions. */
const MENTION = /@(everyone|here)\b|<[@#][!&]?\d+>/;
/** How long Discord can take to answer before the post counts as failed. */
const SEND_TIMEOUT_MS = 30_000;

/** The parsed announcement file, or the problem that stops it from being read. */
export function parseAnnouncement(
  announcement: string,
  file: string,
): { version?: unknown; highlights?: unknown } | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(announcement);
  } catch {
    return `${file} is not valid JSON.`;
  }
  if (typeof parsed !== "object" || parsed === null) return `${file} is not an object.`;
  return parsed;
}

/** What stops the highlights of `file` from being posted. Empty when they are ready. */
export function highlightProblems(highlights: readonly unknown[], file: string): string[] {
  const problems: string[] = [];
  if (highlights.length < MIN_HIGHLIGHTS || highlights.length > MAX_HIGHLIGHTS) {
    problems.push(`${file} must have ${MIN_HIGHLIGHTS} to ${MAX_HIGHLIGHTS} highlights.`);
  }
  for (const [index, highlight] of highlights.entries()) {
    if (typeof highlight !== "string" || highlight.trim() === "") {
      problems.push(`Highlight ${index + 1} has no text.`);
    } else if (PLACEHOLDER.test(highlight)) {
      problems.push(`Highlight ${index + 1} has a placeholder.`);
    } else if (/[\r\n]/.test(highlight)) {
      problems.push(`Highlight ${index + 1} has a line break.`);
    } else if (MENTION.test(highlight)) {
      // The post mentions its audience, so a mention in a highlight would notify people again.
      problems.push(`Highlight ${index + 1} has a mention.`);
    }
  }
  return problems;
}

/** The anchor of `version` on /changelog, as `releaseAnchor` in `apps/auth-api/src/lib/changelog.ts` makes it. */
export function releaseAnchor(version: string): string {
  return `v${version.replace(/[^0-9a-z]+/gi, "-").toLowerCase()}`;
}

/** `allowed_mentions` of a Discord webhook post: https://discord.com/developers/docs/resources/message#allowed-mentions-object */
export interface AllowedMentions {
  parse: ("everyone" | "roles" | "users")[];
  roles?: string[];
}

/**
 * Posts `content` as OpenBot through the webhook in the environment variable `webhookVariable`.
 * Returns the problem when Discord did not post it. `docs` is where the reader finds the setup.
 */
export async function postAnnouncement(
  content: string,
  allowedMentions: AllowedMentions,
  webhookVariable: string,
  docs: string,
): Promise<string | undefined> {
  const webhook = process.env[webhookVariable];
  if (!webhook) return `${webhookVariable} is not set. See ${docs}.`;
  // The webhook URL is a secret, so only the status and Discord's answer are printed. A URL error
  // or a network error can name the URL, so neither is printed.
  let response: Response;
  try {
    // `wait` makes Discord answer with an error when it does not post the message.
    const url = new URL(webhook);
    url.searchParams.set("wait", "true");
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "OpenBot",
        avatar_url: "https://openbot.run/icon-512x512.png",
        content,
        allowed_mentions: allowedMentions,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    // After a timeout, Discord can still have posted the message. Look in the channel before a re-run.
    return `Could not reach the Discord webhook in ${webhookVariable}, or it did not answer in time.`;
  }
  if (!response.ok) return `Discord did not post the announcement: ${response.status} ${await response.text()}`;
  return undefined;
}

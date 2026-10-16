// The Discord post of a desktop release. The release preparation writes the highlights in
// `.github/release-announcement.json`, and `release.yml` posts them after the GitHub Release exists.
//
//   bun scripts/discord-release-announcement.ts check <version>  checks the file and prints the message
//   bun scripts/discord-release-announcement.ts send <version>   also posts it to DISCORD_RELEASE_WEBHOOK_URL
//
// No package imports: `release.yml` runs this before `bun install`.

import { readFileSync } from "node:fs";

export const ANNOUNCEMENT_FILE = ".github/release-announcement.json";

const MIN_HIGHLIGHTS = 3;
const MAX_HIGHLIGHTS = 5;
/** The longest message that Discord accepts. */
const MAX_CONTENT = 2000;
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b/;

/** What stops `announcement` from being posted for `version`. Empty when it is ready. */
export function announcementProblems(announcement: string, version: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(announcement);
  } catch {
    return [`${ANNOUNCEMENT_FILE} is not valid JSON.`];
  }
  if (typeof parsed !== "object" || parsed === null) return [`${ANNOUNCEMENT_FILE} is not an object.`];
  const record: { version?: unknown; highlights?: unknown } = parsed;
  const problems: string[] = [];
  if (record.version !== version) {
    problems.push(`${ANNOUNCEMENT_FILE} is for version ${String(record.version)}, not ${version}.`);
  }
  const highlights = Array.isArray(record.highlights) ? record.highlights : [];
  if (highlights.length < MIN_HIGHLIGHTS || highlights.length > MAX_HIGHLIGHTS) {
    problems.push(`${ANNOUNCEMENT_FILE} must have ${MIN_HIGHLIGHTS} to ${MAX_HIGHLIGHTS} highlights.`);
  }
  for (const [index, highlight] of highlights.entries()) {
    if (typeof highlight !== "string" || highlight.trim() === "") {
      problems.push(`Highlight ${index + 1} has no text.`);
    } else if (PLACEHOLDER.test(highlight)) {
      problems.push(`Highlight ${index + 1} has a placeholder.`);
    }
  }
  if (problems.length === 0 && announcementMessage(highlights, version).length > MAX_CONTENT) {
    problems.push(`The message is longer than the ${MAX_CONTENT} characters that Discord accepts.`);
  }
  return problems;
}

/** The anchor of `version` on /changelog, as `releaseAnchor` in `apps/auth-api/src/lib/changelog.ts` makes it. */
function changelogUrl(version: string): string {
  return `https://openbot.run/changelog#v${version.replace(/[^0-9a-z]+/gi, "-").toLowerCase()}`;
}

function announcementMessage(highlights: readonly unknown[], version: string): string {
  return [
    "@everyone",
    `**OpenBot v${version} is out**`,
    "",
    ...highlights.map((highlight) => `- ${String(highlight).trim()}`),
    "",
    `Full changelog: ${changelogUrl(version)}`,
  ].join("\n");
}

if (import.meta.main) {
  const [command, version] = process.argv.slice(2);
  if ((command !== "check" && command !== "send") || version === undefined) {
    process.stderr.write("Usage: bun scripts/discord-release-announcement.ts <check|send> <version>\n");
    process.exit(1);
  }
  const announcement = readFileSync(ANNOUNCEMENT_FILE, "utf8");
  const problems = announcementProblems(announcement, version);
  if (problems.length > 0) {
    process.stderr.write(
      [
        `The Discord announcement for OpenBot ${version} is not ready:`,
        ...problems.map((problem) => `- ${problem}`),
        "",
        "See docs/RELEASING.md#discord-announcement.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  const content = announcementMessage(JSON.parse(announcement).highlights, version);
  process.stdout.write(`${content}\n`);

  if (command === "send") {
    const webhook = process.env.DISCORD_RELEASE_WEBHOOK_URL;
    if (!webhook) {
      process.stderr.write("DISCORD_RELEASE_WEBHOOK_URL is not set. See docs/RELEASING.md#discord-announcement.\n");
      process.exit(1);
    }
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
          allowed_mentions: { parse: ["everyone"] },
        }),
      });
    } catch {
      process.stderr.write("Could not reach the Discord webhook in DISCORD_RELEASE_WEBHOOK_URL.\n");
      process.exit(1);
    }
    if (!response.ok) {
      process.stderr.write(`Discord did not post the announcement: ${response.status} ${await response.text()}\n`);
      process.exit(1);
    }
    process.stdout.write("Posted the announcement to Discord.\n");
  }
}

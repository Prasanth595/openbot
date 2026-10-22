// The Discord post of a desktop release. The release preparation writes the highlights in
// `.github/release-announcement.json`, and `release.yml` posts them after the GitHub Release exists.
// The mobile app has its own post: `discord-mobile-release-announcement.ts`.
//
//   bun scripts/discord-release-announcement.ts check <version>  checks the file and prints the message
//   bun scripts/discord-release-announcement.ts send <version>   also posts it to DISCORD_RELEASE_WEBHOOK_URL
//
// No package imports: `release.yml` runs this before `bun install`.

import { readFileSync } from "node:fs";
import { announcementFileProblems, postAnnouncement, releaseAnchor } from "./discord-announcement";

export const ANNOUNCEMENT_FILE = ".github/release-announcement.json";
const DOCS = "docs/RELEASING.md#discord-announcement";

/** What stops `announcement` from being posted for `version`. Empty when it is ready. */
export function announcementProblems(announcement: string, version: string): string[] {
  return announcementFileProblems(announcement, version, ANNOUNCEMENT_FILE, (highlights) =>
    announcementMessage(highlights, version),
  );
}

function changelogUrl(version: string): string {
  return `https://openbot.run/changelog#${releaseAnchor(version)}`;
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
        `See ${DOCS}.`,
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  const content = announcementMessage(JSON.parse(announcement).highlights, version);
  process.stdout.write(`${content}\n`);

  if (command === "send") {
    const failure = await postAnnouncement(content, { parse: ["everyone"] }, "DISCORD_RELEASE_WEBHOOK_URL", DOCS);
    if (failure !== undefined) {
      process.stderr.write(`${failure}\n`);
      process.exit(1);
    }
    process.stdout.write("Posted the announcement to Discord.\n");
  }
}

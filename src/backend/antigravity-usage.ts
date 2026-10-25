// The Gemini plan quota, read from the Antigravity ACP server's `/usage` command.
//
// From 1.4.1 (`antigravityAnswersUsageCommand`) the server answers a prompt that starts with
// `/usage` itself, with no model turn: it reads the signed-in Google account's quota summary, sends
// one Markdown answer and ends the turn. The answer is text for people, so this reads only the lines
// of its "Quota Limits" section:
//
//   ### Quota Limits
//   - **Gemini Models**
//     *(Models within this group: Gemini Flash, Gemini Pro)*
//     - **Weekly Limit Remaining:** 96% remaining (resets Oct 29, 2026, 10:12 UTC)
//   - **Claude and GPT models**
//     - **Weekly Limit Remaining:** 100% remaining
//
// An API key sign-in has no plan quota: the section then says "Not applicable for current
// authentication method", which reads as no usage.

import type { AccountRateLimitsReadResult, AccountRateLimitWindowResult } from "./protocol";

export const ANTIGRAVITY_USAGE_PROMPT = "/usage";

const FIVE_HOUR_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

const SECTION = /^#+\s*Quota Limits\s*$/iu;
const GROUP = /^-\s+\*\*(.+?)\*\*\s*$/u;
const BUCKET = /^\s+-\s+\*\*(.+?):\*\*\s+(\d+(?:\.\d+)?)% remaining(?:\s+\(resets ([^)]+)\))?\s*$/u;
const RESET = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) UTC$/u;

type UsageWindow = AccountRateLimitWindowResult & { usedPercent: number };

/**
 * The Gemini groups only: the dock row is Gemini's, and Claude and GPT models through Antigravity
 * share another limit. A five-hour bucket is the first window and a weekly one the second, as for
 * Codex. When two Gemini groups fill the same window, the one closer to its limit stops turns first.
 */
export function antigravityRateLimits(answer: string): AccountRateLimitsReadResult {
  let inSection = false;
  let inGemini = false;
  let primary: UsageWindow | null = null;
  let secondary: UsageWindow | null = null;
  for (const line of answer.split(/\r?\n/u)) {
    if (/^#/u.test(line)) {
      inSection = SECTION.test(line);
      continue;
    }
    if (!inSection) continue;
    const group = GROUP.exec(line);
    if (group) {
      inGemini = /^gemini\b/iu.test(group[1] ?? "");
      continue;
    }
    const bucket = inGemini ? BUCKET.exec(line) : null;
    if (!bucket) continue;
    const name = bucket[1] ?? "";
    const window: UsageWindow = {
      usedPercent: Math.max(0, Math.min(100, 100 - Number(bucket[2]))),
      windowDurationMins: /week/iu.test(name)
        ? WEEKLY_WINDOW_MINS
        : /\b5\s*-?\s*h/iu.test(name)
          ? FIVE_HOUR_WINDOW_MINS
          : null,
      resetsAt: resetSeconds(bucket[3]),
    };
    if (window.windowDurationMins === FIVE_HOUR_WINDOW_MINS) primary = bindingWindow(primary, window);
    else secondary = bindingWindow(secondary, window);
  }
  if (!primary && !secondary) return NO_USAGE;
  return { rateLimits: { limitId: "antigravity", primary, secondary }, rateLimitsByLimitId: null };
}

function bindingWindow(current: UsageWindow | null, next: UsageWindow): UsageWindow {
  return current && current.usedPercent >= next.usedPercent ? current : next;
}

/** The server writes the reset as "Oct 29, 2026, 10:12 UTC". */
function resetSeconds(text: string | undefined): number | null {
  const match = text ? RESET.exec(text.trim()) : null;
  if (!match) return null;
  const month = MONTHS.indexOf(match[1] ?? "");
  if (month < 0) return null;
  const milliseconds = Date.UTC(Number(match[3]), month, Number(match[2]), Number(match[4]), Number(match[5]));
  return Number.isFinite(milliseconds) ? milliseconds / 1_000 : null;
}

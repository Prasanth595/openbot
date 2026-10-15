// Run against this worktree's Storybook:
// bun scripts/spreadsheet-prefix-e2e.ts --storybook=http://localhost:6006 --phase=before
// Use --phase=after (the default) to keep the baseline report and screenshot.
// Artifacts: .openbot-build/spreadsheet-prefix-e2e/<phase>/report.json and screenshot.png.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = "packages/ui/src/features/conversation/SpreadsheetFilePreview.tsx";
const STORY = "conversation-filepreviewpanel--spreadsheet-literal-prefixes";
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length) ?? "after";
const OUT = resolve(ROOT, ".openbot-build/spreadsheet-prefix-e2e", phase === "before" ? "before" : "after");
const expected = [
  ["$1,234.50", "USD 1234.50", "Gain 12.5%", "2.50 kg", "1,234.50", "12.5%", "1234.5", "% 1.00", "2024-01-01", "12:00"],
];

interface Report {
  passed: boolean;
  phase: string;
  story: string;
  source: string;
  sourceSha256: string | null;
  observed: string[][];
  expected: string[][];
  error: string | null;
  screenshot: string | null;
  screenshotError: string | null;
}

const report: Report = {
  passed: false,
  phase,
  story: STORY,
  source: SOURCE,
  sourceSha256: null,
  observed: [],
  expected,
  error: null,
  screenshot: null,
  screenshotError: null,
};

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  report.error = report.error ? `${report.error}\n${message}` : message;
  report.passed = false;
  process.exitCode = 1;
}

let browser: Browser | undefined;
let page: Page | undefined;
try {
  mkdirSync(OUT, { recursive: true });
  report.sourceSha256 = createHash("sha256")
    .update(readFileSync(resolve(ROOT, SOURCE)))
    .digest("hex");
  assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");
  assert.ok(phase === "before" || phase === "after", "Pass --phase=before or --phase=after.");
  const url = new URL("iframe.html", `${storybook.replace(/\/+$/u, "")}/`);
  url.searchParams.set("id", STORY);
  url.searchParams.set("viewMode", "story");

  browser = await chromium.launch({ channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  await page.goto(url.href);
  const table = page.getByRole("table", { name: "Literal prefixes", exact: true });
  await table.waitFor({ state: "visible" });
  // Read the real sheet data. Header rows have no cells with the "cell" role.
  const rows = table.getByRole("row").filter({ has: page.getByRole("cell") });
  await rows.first().getByRole("cell").first().waitFor({ state: "visible" });
  for (const row of await rows.all()) {
    report.observed.push(await row.getByRole("cell").allTextContents());
  }
  assert.deepEqual(report.observed, expected, "Spreadsheet cells must match the expected formatted values.");
  report.passed = true;
} catch (error) {
  fail(error);
} finally {
  if (page) {
    try {
      await page.evaluate(() =>
        Promise.allSettled(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished),
        ),
      );
      await page.screenshot({ path: resolve(OUT, "screenshot.png"), timeout: 10_000 });
      report.screenshot = "screenshot.png";
    } catch (error) {
      report.screenshotError = error instanceof Error ? error.message : String(error);
      fail(error);
    }
  } else {
    const error = new Error("No browser page is available for a screenshot.");
    report.screenshotError = error.message;
    fail(error);
  }
  try {
    await browser?.close();
  } catch (error) {
    fail(error);
  } finally {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
}

// Smoke test of the public status page (`apps/status`).
//   bun scripts/status-page-smoke.ts [--browser-executable=<path>] [--skip-live]
// 1. Runs `update.ts --dry-run` against a local fake of the 5 probes: a bootstrap run, two failed
//    Marketplace runs, then healthy runs. It checks the planned issue writes, the state and the
//    daily minutes, and that only maintainer issues and comments reach the page.
// 2. Runs one `--dry-run` against the live services and GitHub. It writes nothing remote.
// 3. Builds the page, serves it with the files of step 1, and checks it in Chrome: the banner, the
//    5 rows, the 30 and 90 day views, an incident that opens, plain-text updates, no console errors,
//    and no axe-core violations, at 1440 and 390 px.
// Writes .openbot-build/status-page/report.json and the screenshots beside it.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium } from "playwright-core";

const logger = createOpenBotLogger("status-page-smoke");
const run = promisify(execFile);

const ROOT = resolve(import.meta.dirname, "..");
const APP = resolve(ROOT, "apps/status");
const OUT = resolve(ROOT, ".openbot-build/status-page");
const WORK = resolve(OUT, "work");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");
const skipLive = process.argv.includes("--skip-live");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const listen = (server: Server) =>
  new Promise<number>((done) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      done(address.port);
    }),
  );

// 1. Update runs against a fake service -------------------------------------------

/** Services whose probe answers 503. */
const failing = new Set<string>();
const probeServer = createServer((request, response) => {
  const path = request.url ?? "/";
  const reply = (service: string, body: string) => {
    if (failing.has(service)) {
      response.writeHead(503).end("{}");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" }).end(body);
  };
  if (path === "/api/health/ready") return reply("accounts", '{"status":"ready"}');
  if (path === "/signal/health/ready") return reply("connections", '{"status":"ready"}');
  if (path === "/api/health/hosting") return reply("hosted", '{"status":"ok"}');
  if (path === "/api/v1/skills?limit=1") return reply("marketplace", '{"skills":[]}');
  if (/^\/github\/nightly-labs\/openbot\/releases\/latest\/download\/latest(-mac|-linux)?\.yml$/.test(path)) {
    return reply("updates", "version: 0.42.0\n");
  }
  response.writeHead(404).end();
});
const probePort = await listen(probeServer);

const MEMBER = { login: "maintainer" };
const STRANGER = { login: "someone" };
const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([label, value]) => `### ${label}\n\n${value}`)
    .join("\n\n");
interface FixtureComment {
  user: { login: string };
  author_association: string;
  body: string;
  created_at: string;
}

/** The fields of a GitHub issue that `update.ts` reads; `comment_list` replaces the comment API. */
interface FixtureIssue {
  number: number;
  title: string;
  body: string;
  created_at: string;
  state?: "open" | "closed";
  state_reason?: string | null;
  user?: { login: string };
  author_association?: string;
  closed_at?: string | null;
  comments?: number;
  comment_list?: FixtureComment[];
}

const issue = (fields: FixtureIssue) => ({
  html_url: `https://github.com/nightly-labs/openbot/issues/${fields.number}`,
  state: "open",
  state_reason: null,
  user: MEMBER,
  author_association: "MEMBER",
  closed_at: null,
  comments: 0,
  comment_list: [],
  ...fields,
});

const ISSUES = [
  issue({
    number: 101,
    title: "Marketplace pages load slowly",
    created_at: "2026-10-16T09:12:00Z",
    body: form({
      Kind: "Incident",
      Services: "Marketplace",
      Impact: "Degraded",
      Update: "Investigating: Search takes 20 s. <b>Installed</b> skills work.",
    }),
    comments: 2,
    comment_list: [
      {
        user: { login: "owner" },
        author_association: "OWNER",
        body: "**Identified:** A slow query on the search index.",
        created_at: "2026-10-16T09:41:00Z",
      },
      { user: STRANGER, author_association: "NONE", body: "Resolved: fake news", created_at: "2026-10-16T09:50:00Z" },
    ],
  }),
  issue({
    number: 102,
    title: "Everything is down (not from a maintainer)",
    created_at: "2026-10-16T09:30:00Z",
    user: STRANGER,
    author_association: "NONE",
    body: form({ Kind: "Incident", Services: "Accounts and sign-in", Impact: "Major outage", Update: "Down" }),
  }),
  issue({
    number: 103,
    title: "Connections server upgrade",
    created_at: "2026-10-15T14:00:00Z",
    body: form({
      Kind: "Maintenance",
      Services: "Connections",
      Impact: "_No response_",
      "Maintenance start (UTC)": "2026-10-20 06:00",
      "Maintenance end (UTC)": "2026-10-20 06:30",
      Update: "Phones can disconnect for up to one minute.",
    }),
  }),
  issue({
    number: 104,
    title: "False alarm",
    created_at: "2026-10-14T10:00:00Z",
    state: "closed",
    state_reason: "not_planned",
    closed_at: "2026-10-14T10:10:00Z",
    body: form({ Kind: "Incident", Services: "Hosted servers", Impact: "Major outage", Update: "Down" }),
  }),
  issue({
    number: 105,
    title: "No known service",
    created_at: "2026-10-14T10:00:00Z",
    body: form({ Kind: "Incident", Services: "Something else", Impact: "Major outage", Update: "Down" }),
  }),
  issue({
    number: 106,
    title: "Phones and teammates could not connect",
    created_at: "2026-10-11T07:10:00Z",
    state: "closed",
    state_reason: "completed",
    closed_at: "2026-10-11T08:05:00Z",
    body: form({
      Kind: "Incident",
      Services: "Connections, Hosted servers",
      Impact: "Partial outage",
      Update: "Some connections fail.",
    }),
  }),
];
const issuesFile = resolve(WORK, "issues.json");
writeFileSync(issuesFile, JSON.stringify(ISSUES));

const STATE = resolve(WORK, "state.json");
const SITE = resolve(WORK, "site");

interface RunReport {
  actions: { type: string; service: string; issue: number }[];
  outcomes: Record<string, { result: string; attempts: number; reason: string | null }>;
  incidents: number[];
}

interface ServiceStateJson {
  result: string;
  failedRuns: number;
  healthyRuns: number;
  openIssue: number | null;
  days: { date: string; checks: number; minutes: number; failedMinutes: number; degradedMinutes: number }[];
}

const readJson = <T>(path: string): T => {
  const value: T = JSON.parse(readFileSync(path, "utf8"));
  return value;
};

/** The child gets no GitHub token, so even a mistake in `--dry-run` cannot write an issue. */
const childEnv = () => {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  return env;
};

async function update(name: string, now: string, extra: string[] = []): Promise<RunReport> {
  const report = resolve(WORK, `${name}.json`);
  await run(
    "bun",
    [
      resolve(APP, "scripts/update.ts"),
      "--state",
      STATE,
      "--out",
      SITE,
      "--report",
      report,
      "--dry-run",
      "--probe-base",
      `http://127.0.0.1:${probePort}`,
      "--issues-file",
      issuesFile,
      "--now",
      now,
      "--retry-delay",
      "10",
      ...extra,
    ],
    { cwd: ROOT, env: childEnv() },
  );
  return readJson<RunReport>(report);
}

const marketplace = () => readJson<{ services: Record<string, ServiceStateJson> }>(STATE).services.marketplace;
const steps: { name: string; actions: RunReport["actions"]; marketplace: ServiceStateJson }[] = [];
const record = (name: string, report: RunReport) => {
  const service = marketplace();
  assert.ok(service);
  steps.push({ name, actions: report.actions, marketplace: service });
  return service;
};

// A run with no history and no --bootstrap must stop and write nothing.
await assert.rejects(update("no-history", "2026-10-16T09:55:00Z"), "A run without history must fail.");
assert.equal(existsSync(STATE), false, "A failed run wrote a state file.");

let report = await update("bootstrap", "2026-10-16T10:00:00Z", ["--bootstrap"]);
let service = record("bootstrap", report);
assert.deepEqual(report.actions, []);
assert.equal(service.result, "ok");
assert.deepEqual(report.incidents, [103, 101, 106], "Only maintainer issues with a known service reach the page.");

failing.add("marketplace");
report = await update("fail-1", "2026-10-16T10:05:00Z");
service = record("fail-1", report);
assert.equal(report.outcomes.marketplace?.result, "down");
assert.equal(report.outcomes.marketplace?.attempts, 2, "A failed probe is tried again once.");
assert.deepEqual(report.actions, [], "One failed run opens no issue.");
assert.equal(service.failedRuns, 1);

report = await update("fail-2", "2026-10-16T10:10:00Z");
service = record("fail-2", report);
assert.deepEqual(
  report.actions.map((action) => [action.type, action.service]),
  [["open-issue", "marketplace"]],
);
assert.equal(service.openIssue, 0, "The dry run keeps the planned issue.");

failing.clear();
report = await update("recover-1", "2026-10-16T10:15:00Z");
service = record("recover-1", report);
assert.deepEqual(report.actions, [], "One healthy run closes no issue.");

report = await update("recover-2", "2026-10-16T10:20:00Z");
service = record("recover-2", report);
assert.deepEqual(
  report.actions.map((action) => [action.type, action.service]),
  [["close-issue", "marketplace"]],
);
assert.equal(service.openIssue, null);

// 30 minutes without a run: the check covers at most 15 of them.
report = await update("late", "2026-10-16T10:50:00Z");
service = record("late", report);
const today = service.days.at(-1);
assert.deepEqual(today, {
  date: "2026-10-16",
  checks: 6,
  minutes: 5 + 5 + 5 + 5 + 5 + 15,
  failedMinutes: 10,
  degradedMinutes: 0,
});
const accounts = readJson<{ services: Record<string, ServiceStateJson> }>(STATE).services.accounts;
assert.equal(accounts?.days.at(-1)?.failedMinutes, 0);

// An issue event only reads the issues again: anyone can start one, so it must not count a run.
failing.add("marketplace");
const stateBefore = readFileSync(STATE, "utf8");
report = await update("incidents-only", "2026-10-16T10:52:00Z", ["--incidents-only"]);
assert.deepEqual(report.outcomes, {}, "An issue event probed the services.");
assert.deepEqual(report.actions, []);
assert.equal(readFileSync(STATE, "utf8"), stateBefore, "An issue event changed the check history.");
assert.deepEqual(report.incidents, [103, 101, 106]);
assert.equal(
  readJson<{ checkedAt: string }>(resolve(SITE, "status.json")).checkedAt,
  "2026-10-16T10:50:00Z",
  "An issue event moved the time of the last check.",
);
await assert.rejects(
  update("incidents-only-bootstrap", "2026-10-16T10:53:00Z", ["--incidents-only", "--bootstrap"]),
  "--incidents-only with --bootstrap must fail.",
);
failing.clear();
probeServer.close();

const status = readJson<{ incidents: { id: number; updates: { stage: string; body: string }[] }[] }>(
  resolve(SITE, "status.json"),
);
const slow = status.incidents.find((incident) => incident.id === 101);
assert.deepEqual(
  slow?.updates.map((item) => item.stage),
  ["identified", "investigating"],
  "The comment of a person without write access is not an update.",
);
const feed = readFileSync(resolve(SITE, "feed.xml"), "utf8");
assert.match(feed, /&lt;b&gt;Installed&lt;\/b&gt;/, "The feed escapes update text.");
assert.equal(feed.match(/<entry>/g)?.length, 5);
logger.info("Update runs: passed.");

// 2. One read-only run against the live services ----------------------------------------

let live: RunReport["outcomes"] | null = null;
if (!skipLive) {
  const liveDir = resolve(WORK, "live");
  const liveReport = resolve(liveDir, "report.json");
  await run(
    "bun",
    [
      resolve(APP, "scripts/update.ts"),
      "--state",
      resolve(liveDir, "state.json"),
      "--out",
      resolve(liveDir, "site"),
      "--report",
      liveReport,
      "--dry-run",
      "--bootstrap",
    ],
    { cwd: ROOT, env: childEnv() },
  );
  live = readJson<RunReport>(liveReport).outcomes;
  for (const [id, outcome] of Object.entries(live)) {
    assert.match(outcome.result, /^(ok|degraded|down)$/);
    logger.info(`Live ${id}: ${outcome.result}${outcome.reason ? ` (${outcome.reason})` : ""}`);
  }
}

// 3. The built page in Chrome ---------------------------------------------------------

await run("bun", ["run", "build"], { cwd: APP });
const PAGES = resolve(WORK, "pages");
cpSync(resolve(APP, "dist"), PAGES, { recursive: true });
cpSync(resolve(SITE, "status.json"), resolve(PAGES, "status.json"));
cpSync(resolve(SITE, "feed.xml"), resolve(PAGES, "feed.xml"));

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".xml": "application/atom+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const pageServer = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolve(PAGES, `.${path === "/" ? "/index.html" : path}`);
  if (!file.startsWith(PAGES) || !existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
const pagePort = await listen(pageServer);

// axe-core comes with the Storybook accessibility add-on.
const AXE = new URL(import.meta.resolve("axe-core/axe.min.js")).pathname;

interface AxeViolation {
  id: string;
  nodes: { target: string[] }[];
}

declare global {
  interface Window {
    axe?: { run: () => Promise<{ violations: AxeViolation[] }> };
  }
}

/** The page reads the clock: 40 minutes after the last run, so the checks are late. */
const PAGE_NOW = new Date("2026-10-16T11:30:00Z");

const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
const views: { name: string; width: number; height: number; screenshot: string }[] = [];
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, timezoneId: "Europe/Warsaw" });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(PAGE_NOW);

    await page.goto(`http://127.0.0.1:${pagePort}/`);
    const banner = page.getByRole("region", { name: "Current status" });
    await banner.getByRole("heading").waitFor();
    // Incident 101 is open, and the run at 10:50 is 40 minutes old.
    assert.equal(await banner.getByRole("heading").textContent(), "1 of 5 services affected");
    assert.match((await banner.textContent()) ?? "", /Checks are late/);

    const services = page.getByRole("region", { name: "Services" });
    const bars = services.getByRole("img");
    assert.equal(await services.getByRole("heading", { level: 3 }).count(), 5);
    assert.equal(await bars.count(), 5);
    assert.match((await bars.first().getAttribute("aria-label")) ?? "", /in the last 90 days/);
    await page.getByRole("button", { name: "30 days" }).click();
    assert.match((await bars.first().getAttribute("aria-label")) ?? "", /in the last 30 days/);
    assert.equal(await page.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed"), "true");

    // The active incident shows its update as text, not as markup.
    const notice = page.getByRole("article").filter({ hasText: "Marketplace pages load slowly" });
    assert.equal(await notice.locator("b").count(), 0);
    assert.match((await notice.textContent()) ?? "", /<b>Installed<\/b>/);
    assert.equal(await page.getByRole("article").filter({ hasText: "Connections server upgrade" }).count(), 1);
    assert.equal(await page.getByText("Everything is down").count(), 0, "An issue from a stranger is on the page.");

    const history = page.getByRole("button", { name: "Phones and teammates could not connect" });
    assert.equal(await history.getAttribute("aria-expanded"), "false");
    await history.click();
    assert.equal(await history.getAttribute("aria-expanded"), "true");
    await page.getByRole("link", { name: "Open the issue" }).waitFor();

    await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(async () => {
      if (!window.axe) throw new Error("axe-core did not load.");
      const result = await window.axe.run();
      return result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target.join(" ")),
      }));
    });
    assert.deepEqual(violations, [], `axe-core violations at ${viewport.width} px`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `The page scrolls sideways at ${viewport.width} px.`);

    const screenshot = resolve(OUT, `${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    assert.deepEqual(errors, [], "Console errors");
    views.push({ ...viewport, screenshot });
    await page.close();
  }
} finally {
  await browser.close();
  pageServer.close();
}

writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ passed: true, steps, live, views }, null, 2)}\n`);
logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);

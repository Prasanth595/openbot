// Checks that a saved Anthropic API key reaches the Claude CLI, through the real Claude driver and
// client. A fake `claude` CLI records the environment of each process it starts and answers
// `auth status --json` as Claude Code 2.1.310 does: with `ANTHROPIC_API_KEY` set it reports
// `authMethod: "api_key"` and no email, also when a claude.ai login exists. Cases: a saved key reaches
// the account check and the SDK process that turns and model probes use; no saved key leaves the
// claude.ai login; an account after the first, with its own `CLAUDE_CONFIG_DIR`, never gets the key.
// `bun scripts/claude-api-key-e2e.ts`. Writes .openbot-build/claude-api-key-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-api-key-e2e");
const KEY = "sk-ant-e2e-0f3c9a71";
const root = await mkdtemp(join(tmpdir(), "openbot-claude-api-key-"));
const executable = join(root, "claude.cjs");
const logPath = join(root, "claude.jsonl");
// A key in the shell would reach the CLI in every case.
delete process.env.ANTHROPIC_API_KEY;
process.env.FAKE_CLAUDE_LOG = logPath;

/** Records each start, never the key itself: only whether it is the expected one. */
const FAKE_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const key = process.env.ANTHROPIC_API_KEY;
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
  args: process.argv.slice(2).slice(0, 3),
  configDir: process.env.CLAUDE_CONFIG_DIR ?? null,
  key: key === undefined ? "absent" : key === ${JSON.stringify(KEY)} ? "saved" : "other",
}) + NL);
if (process.argv.includes("--version")) { process.stdout.write("2.1.310 (Claude Code)" + NL); process.exit(0); }
if (process.argv.slice(2).join(" ") === "auth status --json") {
  process.stdout.write(JSON.stringify(key
    ? { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" }
    : { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "owner@example.invalid", subscriptionType: "max" }));
  process.exit(0);
}
process.exit(2);
`;

interface LogEntry {
  readonly args: readonly string[];
  readonly configDir: string | null;
  readonly key: "absent" | "saved" | "other";
}

function readLog(): LogEntry[] {
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const driver = BUILT_IN_PROVIDER_DRIVERS.find((item) => item.id === "claude");
assert.ok(driver, "no Claude driver");
const claudeDriver = driver;

interface CaseResult {
  readonly name: string;
  readonly account: unknown;
  readonly starts: readonly LogEntry[];
}

/** Runs the account check and a model probe through a client built from `apiKey` and `accountEnvironment`. */
async function runCase(
  name: string,
  apiKey: string | null,
  accountEnvironment?: Readonly<Record<string, string>>,
): Promise<CaseResult> {
  const before = readLog().length;
  const client = claudeDriver.createClient({ executable, version: "2.1.310" }, 5_000, {
    ...NO_PROVIDER_CREDENTIALS,
    apiKey: (provider) => (provider === "claude" ? apiKey : null),
    ...(accountEnvironment ? { accountEnvironment } : {}),
  });
  client.start();
  try {
    const account = await runCauseEffect(client.request("account/read", {}, (value) => value));
    // The probe fails, because the fake CLI is no SDK process. Only its start matters.
    await runCauseEffect(Effect.ignore(client.request("model/list", {}, (value) => value, 5_000)));
    return { name, account, starts: readLog().slice(before) };
  } finally {
    await runCauseEffect(client.stop());
  }
}

const report: { cases: CaseResult[]; result?: "pass" | "fail"; error?: string } = { cases: [] };
try {
  await writeFile(executable, FAKE_CLAUDE);
  await chmod(executable, 0o755);

  const saved = await runCase("saved-key", KEY);
  report.cases.push(saved);
  assert.deepEqual(saved.account, {
    account: { type: "claude", email: null, planType: null },
    requiresOpenaiAuth: false,
  });
  const savedStatus = saved.starts.filter((entry) => entry.args[0] === "auth");
  const savedSdk = saved.starts.filter((entry) => entry.args[0] !== "auth");
  assert.ok(savedStatus.length > 0 && savedStatus.every((entry) => entry.key === "saved"), "account check without key");
  assert.ok(savedSdk.length > 0, "the model probe started no Claude process");
  assert.ok(
    savedSdk.every((entry) => entry.key === "saved"),
    "SDK process without key",
  );

  const none = await runCase("no-key", null);
  report.cases.push(none);
  assert.deepEqual(none.account, {
    account: { type: "claude", email: "owner@example.invalid", planType: "max" },
    requiresOpenaiAuth: false,
  });
  assert.ok(none.starts.length > 0 && none.starts.every((entry) => entry.key === "absent"), "key without a saved key");

  const secondDir = join(root, "account-2");
  const second = await runCase("second-account", KEY, { CLAUDE_CONFIG_DIR: secondDir });
  report.cases.push(second);
  assert.ok(second.starts.length > 0, "the second account started no Claude process");
  assert.ok(
    second.starts.every((entry) => entry.key === "absent" && entry.configDir === secondDir),
    "the second account got the key or another folder",
  );
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`PASS claude-api-key-e2e: ${join(OUT, "report.json")}\n`);

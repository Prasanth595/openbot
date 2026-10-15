#!/usr/bin/env bun
/**
 * Run: bun scripts/usage-account-summary-e2e.ts
 * Report: .openbot-build/usage-account-summary/report.json
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type AccountUsage, DEFAULT_PROVIDER_ACCOUNT_ID, type ProviderAccountStatus } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import {
  type AccountUsageProviderRow,
  accountUsageProviderRows,
  accountUsageSummary,
} from "../packages/ui/src/features/account/account-usage-view";
import { ProviderAccountStore } from "../src/backend/agent/provider-account-store";
import {
  ProviderAccountFailed,
  ProviderAccounts,
  type ProviderAccountsHost,
} from "../src/backend/agent/provider-accounts";
import { ProviderSignInError } from "../src/backend/provider-client-effects";

const workspace = resolve(dirname(import.meta.filename), "..");
const output = join(workspace, ".openbot-build", "usage-account-summary");
interface CheckResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface UsageReport {
  status: "passed" | "failed";
  checks: CheckResult[];
  transitions: ProviderAccountStatus[][];
  persisted?: Schema.JsonObject;
  accounts?: ProviderAccountStatus[];
  usage?: AccountUsage;
  rows?: AccountUsageProviderRow[];
  error?: string;
  selectorSha256?: string;
}

const checks: CheckResult[] = [];
const report: UsageReport = { status: "failed", checks, transitions: [] };

function check(name: string, verify: () => void): void {
  try {
    verify();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

// Default readings enter at the external provider boundary. Secondary readings come from the service.
const defaultUsage: AccountUsage = {
  limits: [
    { id: "codex", primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: null }, secondary: null },
    { id: "grok", primary: { usedPercent: 85, windowDurationMins: 10080, resetsAt: null }, secondary: null },
    { id: "opencode", primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: null }, secondary: null },
  ],
};

async function run(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "openbot-usage-account-summary-"));
  try {
    const path = join(temporary, "accounts.json");
    const root = join(temporary, "homes");
    const initial = new ProviderAccountStore(path, root);
    await Effect.runPromise(initial.load());
    const secondary = await Effect.runPromise(initial.create("codex"));
    assert.ok(secondary, "The real store must create a secondary account.");
    const persisted = Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(await readFile(path, "utf8")));
    assert.deepEqual(persisted.accounts, [secondary]);
    assert.ok((await stat(initial.home(secondary))).isDirectory());

    // Load a new store from disk so the service does not rely on the creator's in-memory list.
    const store = new ProviderAccountStore(path, root);
    await Effect.runPromise(store.load());
    assert.deepEqual(store.list("codex"), [secondary]);
    const events = new EventEmitter();
    const authEnvironments: Readonly<Record<string, string>>[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const host: ProviderAccountsHost = {
            scope: () => scope,
            cli: (_provider) => ({ executable: process.execPath, version: "e2e", source: "system" }),
            defaultEmail: (_provider) => "default@example.com",
            authenticate: (_provider, _cli, environment) => {
              authEnvironments.push(environment);
              return Effect.fail(
                new ProviderAccountFailed({ cause: new ProviderSignInError({ message: "Signed out." }) }),
              );
            },
            stopClient: (_client) => Effect.void,
            agentClient: (_provider, _accountId) => null,
            stopAgentClients: (_provider, _accountId) => Effect.void,
            readUsage: (_client, _model) => Effect.die(new Error("A signed-out account must not read usage.")),
            changed: () => {
              const rows = accounts.rows("codex", host.defaultEmail("codex"));
              if (!rows) throw new Error("Codex account rows must be available.");
              report.transitions.push(rows);
              if (rows?.find((row) => row.id === secondary.id)?.state === "signed-out") events.emit("signed-out");
            },
            redact: (text) => text,
          };
          const accounts = new ProviderAccounts(store, host);
          const signedOut = once(events, "signed-out", { signal: AbortSignal.timeout(10000) });
          yield* accounts.checkAll("codex");
          yield* Effect.promise(() => signedOut);
          const accountRows = accounts.rows("codex", host.defaultEmail("codex"));
          if (!accountRows) throw new Error("Codex account rows must be available.");
          const secondaryUsage = yield* accounts.usage("codex", "gpt-5.6-luna");
          const providers = [
            { id: "codex", state: "available", accounts: accountRows },
            { id: "grok", state: "available" },
            { id: "opencode", state: "available" },
          ];
          const usage = { limits: [...defaultUsage.limits, ...secondaryUsage] };
          const rows = accountUsageProviderRows(usage, providers);
          report.persisted = persisted;
          report.accounts = accountRows;
          report.usage = usage;
          report.rows = rows;
          check("checkAll emits checking then signed-out", () => {
            assert.deepEqual(
              report.transitions.map((snapshot) => snapshot.find((row) => row.id === secondary.id)?.state),
              ["checking", "signed-out"],
            );
            assert.deepEqual(authEnvironments, [{ CODEX_HOME: store.home(secondary) }]);
          });
          check("signed-out secondary has no service usage or consumer row", () => {
            assert.deepEqual(secondaryUsage, []);
            assert.equal(
              rows.some((row) => row.accountId === secondary.id),
              false,
            );
          });
          check("selected signed-out secondary does not inherit default quota", () => {
            assert.equal(accountUsageSummary(rows, "codex", "gpt-5.6-luna", secondary.id), null);
          });
          for (const accountId of [null, undefined, DEFAULT_PROVIDER_ACCOUNT_ID]) {
            check(`default selection: ${String(accountId)}`, () => {
              const selected = accountUsageSummary(rows, "codex", "gpt-5.6-luna", accountId);
              assert.equal(selected?.provider, "codex");
              assert.equal(selected?.accountId, null);
              assert.equal(selected?.remainingPercent, 65);
            });
          }
          check("missing account and missing provider stay unknown", () => {
            assert.equal(accountUsageSummary(rows, "codex", "gpt-5.6-luna", "removed-account"), null);
            assert.equal(accountUsageSummary(rows, "claude", "claude-sonnet-5", null), null);
          });
          check("no-agent overview keeps the lowest quota", () => {
            assert.equal(accountUsageSummary(rows)?.provider, "grok");
            assert.equal(accountUsageSummary(rows)?.remainingPercent, 15);
          });
          check("model coverage remains intact", () => {
            assert.equal(accountUsageSummary(rows, "opencode", "other/model", null), null);
            assert.equal(accountUsageSummary(rows, "opencode", "opencode-go/model", null)?.remainingPercent, 50);
          });
        }),
      ),
    );
    report.status = checks.every((result) => result.passed) ? "passed" : "failed";
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  report.selectorSha256 = createHash("sha256")
    .update(await readFile(join(workspace, "packages/ui/src/features/account/account-usage-view.ts")))
    .digest("hex");
  await mkdir(output, { recursive: true });
  const path = join(output, "report.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, report: path, checks })}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}

// Runs the real host, file store, account route, D1 policy and mobile controllers with owned inputs.
// Native callbacks and OAuth/FCM are synthetic. This does not verify a device or external delivery.
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { redactText } from "@openbot/logging";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/android-push-e2e");
const SOURCE_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/release-android.yml",
  "PRIVACY.md",
  "apps/auth-api/README.md",
  "apps/auth-api/migrations/0001_google_auth.sql",
  "apps/auth-api/migrations/0002_email_login_codes.sql",
  "apps/auth-api/migrations/0003_remove_google_oauth.sql",
  "apps/auth-api/migrations/0004_team_auth_tickets.sql",
  "apps/auth-api/migrations/0005_team_tunnels.sql",
  "apps/auth-api/migrations/0006_one_team_server_per_user.sql",
  "apps/auth-api/migrations/0007_team_host_machine_tokens.sql",
  "apps/auth-api/migrations/0008_remove_team_tunnel_vnc.sql",
  "apps/auth-api/migrations/0009_skills_marketplace.sql",
  "apps/auth-api/migrations/0010_agents_marketplace.sql",
  "apps/auth-api/migrations/0011_marketplace_catalog_indexes.sql",
  "apps/auth-api/migrations/0012_remote_control_plane.sql",
  "apps/auth-api/migrations/0013_remote_session_lifecycle.sql",
  "apps/auth-api/migrations/0014_mobile_auth_sessions.sql",
  "apps/auth-api/migrations/0015_email_challenge_delivery_state.sql",
  "apps/auth-api/migrations/0016_hosted_sites.sql",
  "apps/auth-api/migrations/0017_mobile_session_security.sql",
  "apps/auth-api/migrations/0018_remote_device_sessions.sql",
  "apps/auth-api/migrations/0019_marketplace_presentation.sql",
  "apps/auth-api/migrations/0020_permanent_invites.sql",
  "apps/auth-api/migrations/0021_agent_templates.sql",
  "apps/auth-api/migrations/0022_billing.sql",
  "apps/auth-api/migrations/0023_hosted_servers.sql",
  "apps/auth-api/migrations/0024_hosted_site_servers.sql",
  "apps/auth-api/migrations/0025_slack_workspace_routes.sql",
  "apps/auth-api/migrations/0026_discord_guild_routes.sql",
  "apps/auth-api/migrations/0027_webhook_routes.sql",
  "apps/auth-api/migrations/0028_hosted_server_lifecycle.sql",
  "apps/auth-api/migrations/0029_telegram_chat_routes.sql",
  "apps/auth-api/migrations/0030_sales_analytics.sql",
  "apps/auth-api/migrations/0031_billing_sales.sql",
  "apps/auth-api/migrations/0032_mobile_connect_links.sql",
  "apps/auth-api/migrations/0033_mobile_session_connect_link.sql",
  "apps/auth-api/migrations/0034_account_attribution.sql",
  "apps/auth-api/migrations/0034_server_claims.sql",
  "apps/auth-api/src/routeTree.gen.ts",
  "apps/auth-api/src/routes/v2/remote/hosts/$hostId/android-notification.ts",
  "apps/auth-api/src/server/android-notification-relay.ts",
  "apps/auth-api/src/server/android-notification-route.ts",
  "apps/auth-api/src/server/crypto.ts",
  "apps/auth-api/src/server/effect-runtime.ts",
  "apps/auth-api/src/server/json-body.ts",
  "apps/auth-api/src/server/live-activity-relay.ts",
  "apps/auth-api/src/server/remote-control-plane.ts",
  "apps/auth-api/src/server/request-auth.ts",
  "apps/auth-api/src/server/runtime-env.ts",
  "apps/auth-api/src/server/types.ts",
  "apps/mobile/.gitignore",
  "apps/mobile/README.md",
  "apps/mobile/app.json",
  "apps/mobile/changelog.d/android-background-push.md",
  "apps/mobile/plugins/with-android-push.js",
  "apps/mobile/plugins/with-ios-notification-sounds.js",
  "apps/mobile/src/app/(app)/_layout.tsx",
  "apps/mobile/src/features/chat/screens/agent-chat-screen.tsx",
  "apps/mobile/src/features/live-activity/model/live-activity-open.ts",
  "apps/mobile/src/features/push-notifications/android-notification-taps.ts",
  "apps/mobile/src/features/push-notifications/android-push-native.ts",
  "apps/mobile/src/features/push-notifications/android-push-registration.ts",
  "apps/mobile/src/features/push-notifications/push-notifications-native.android.ts",
  "apps/mobile/src/features/push-notifications/push-notifications-native.types.ts",
  "apps/mobile/src/features/push-notifications/use-notification-taps.android.ts",
  "apps/mobile/src/features/push-notifications/use-push-notifications.android.ts",
  "apps/mobile/src/features/settings/model/push-notifications.ts",
  "apps/mobile/src/features/settings/screens/notifications-settings-screen.tsx",
  "apps/mobile/src/features/settings/screens/settings-screen.tsx",
  "apps/mobile/src/features/workspace/context/mobile-workspace-context.tsx",
  "bun.lock",
  "changelog.d/android-background-push.md",
  "docs/architecture/channels-and-messaging.md",
  "package.json",
  "packages/contracts/package.json",
  "packages/contracts/src/android-notification-relay.ts",
  "packages/contracts/src/notification-relay.ts",
  "packages/contracts/src/team-protocol/admin-wire.ts",
  "packages/contracts/src/team-protocol/android-push-notifications-v1.ts",
  "packages/contracts/src/team-protocol/current.ts",
  "packages/contracts/src/team-protocol/optional-routes.ts",
  "packages/contracts/src/team-protocol/push-notifications-v1.ts",
  "packages/i18n/src/messages/en/mobile/settings.ts",
  "packages/logging/src/index.ts",
  "packages/team-client/src/agent-notifications.ts",
  "packages/team-client/src/live-activity-seal.ts",
  "packages/team-client/src/push-notification-seal.ts",
  "scripts/android-push-e2e-fixture.mjs",
  "scripts/android-push-e2e.ts",
  "scripts/deploy-auth-api.ts",
  "src/backend/atomic-json-file.ts",
  "src/main/central-auth-manager.ts",
  "src/main/host-service.ts",
  "src/main/preference-file.ts",
  "src/main/push-notification-store.ts",
  "src/main/push-notifications.ts",
  "src/main/team-api-server.ts",
  "src/main/team-api/client-use.ts",
  "src/main/team-api/request-helpers.ts",
  "src/main/team-api/route-push-notifications.ts",
] as const;
const fixtureSchema = z.object({
  nonce: z.string().uuid(),
  passed: z.boolean(),
  requiredCases: z.literal(15),
  executedCases: z.number().int().min(0).max(15),
  passedCases: z.number().int().min(0).max(15),
  cases: z
    .array(z.object({ name: z.string().max(160), passed: z.boolean(), error: z.string().max(1_500).optional() }))
    .max(15),
  cleanupPassed: z.boolean(),
  cleanupRequired: z.number().int().min(1).max(64),
  cleanupReceipts: z.array(z.object({ resource: z.string().max(80), passed: z.boolean() })).max(64),
  cleanupErrors: z
    .array(
      z.object({
        resource: z.string().max(80),
        name: z.string().max(80),
        code: z.string().max(80),
        message: z.string().max(1_500),
      }),
    )
    .max(64),
  failure: z.string().max(1_500).nullable(),
  runtime: z.object({ bun: z.string().nullable(), nodeCompatibility: z.string() }),
  nativeDeliveryVerified: z.literal(false),
  externalRequests: z.literal(0),
});
const nonce = randomUUID();
const runDirectory = join(OUT, nonce);
const exec = promisify(execFile);
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const privateValues = [ROOT, runDirectory, homedir()];

function safe(value: string, maximum: number): string {
  let text = redactText(value);
  for (const item of privateValues)
    text = text.replaceAll(item, "[private]").replaceAll(JSON.stringify(item).slice(1, -1), "[private]");
  if (Buffer.byteLength(text) > maximum) {
    const before = Buffer.byteLength(text);
    text = Buffer.from(text)
      .subarray(0, maximum - 4)
      .toString("utf8");
    droppedBytes += before - Buffer.byteLength(text);
  }
  for (const item of privateValues)
    if (text.includes(item) || text.includes(JSON.stringify(item).slice(1, -1)))
      throw new Error("The diagnostic contains a private path.");
  return text;
}
async function bounded<A>(operation: Promise<A>, label: string, milliseconds = 10_000): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function inventory() {
  return Promise.all(SOURCE_FILES.map(async (path) => ({ path, sha256: digest(await readFile(join(ROOT, path))) })));
}

await mkdir(runDirectory, { recursive: true });
let child: ReturnType<typeof spawn> | null = null;
let childExited = false;
let output = "";
let diagnostics = "";
let droppedBytes = 0;
let sourceHead = "";
let actualNode = "";
let sourceManifest: Awaited<ReturnType<typeof inventory>> = [];
let sourceManifestDigest = "";
let result: z.infer<typeof fixtureSchema> | null = null;
let failure: string | null = null;
let sourceUnchanged: boolean | null = null;
let sourceCheckError: string | null = null;
let parentCleanup = false;
try {
  if (resolve(process.cwd()) !== ROOT || process.versions.bun !== "1.4.2")
    throw new Error("Run this worktree with the pinned Bun version.");
  sourceHead = (
    await exec("git", ["rev-parse", "HEAD"], { cwd: ROOT, timeout: 10_000, maxBuffer: 1_024 })
  ).stdout.trim();
  actualNode = (await exec("node", ["--version"], { cwd: ROOT, timeout: 10_000, maxBuffer: 1_024 })).stdout.trim();
  if (!/^v24\./u.test(actualNode)) throw new Error("Node 24 is required for this check.");
  sourceManifest = await inventory();
  sourceManifestDigest = digest(JSON.stringify(sourceManifest));
  child = spawn(process.execPath, [join(ROOT, "scripts/android-push-e2e-fixture.mjs")], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      TMPDIR: runDirectory,
      OPENBOT_ANDROID_PUSH_E2E_NONCE: nonce,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(runDirectory, "transpiler-cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = (target: "output" | "diagnostics", bytes: Buffer) => {
    const current = target === "output" ? output : diagnostics;
    if (Buffer.byteLength(current) + bytes.length > 256 * 1_024) {
      droppedBytes += bytes.length;
      child?.kill("SIGTERM");
      return;
    }
    if (target === "output") output += bytes.toString("utf8");
    else diagnostics += bytes.toString("utf8");
  };
  child.stdout?.on("data", (bytes: Buffer) => append("output", bytes));
  child.stderr?.on("data", (bytes: Buffer) => append("diagnostics", bytes));
  const exit = await bounded(
    new Promise<number | null>((accept, reject) => {
      child?.once("error", reject);
      child?.once("close", (code) => {
        childExited = true;
        accept(code);
      });
    }),
    "Android push fixture",
    180_000,
  );
  result = fixtureSchema.parse(JSON.parse(output.trim()));
  if (
    result.nonce !== nonce ||
    result.executedCases !== 15 ||
    result.passedCases !== 15 ||
    result.cases.length !== 15 ||
    new Set(result.cases.map((item) => item.name)).size !== 15 ||
    result.cases.some((item) => !item.passed) ||
    result.failure !== null ||
    droppedBytes !== 0
  )
    throw new Error(result.failure ?? "The Android push fixture did not pass all required cases.");
  if (
    !result.cleanupPassed ||
    result.cleanupErrors.length !== 0 ||
    result.cleanupReceipts.length !== result.cleanupRequired ||
    new Set(result.cleanupReceipts.map((receipt) => receipt.resource)).size !== result.cleanupRequired ||
    result.cleanupReceipts.some((receipt) => !receipt.passed)
  )
    throw new Error("Fixture resource cleanup failed.");
  if (exit !== 0 || !result.passed) throw new Error("The Android push fixture result was not successful.");
} catch (error) {
  failure = safe(error instanceof Error ? error.message : "The Android push check failed.", 8_192);
} finally {
  try {
    if (child && !childExited) {
      child.kill("SIGTERM");
      try {
        await bounded(
          new Promise<void>((accept) =>
            child?.once("close", () => {
              childExited = true;
              accept();
            }),
          ),
          "Fixture stop",
          5_000,
        );
      } catch {
        child.kill("SIGKILL");
        await bounded(
          new Promise<void>((accept) =>
            child?.once("close", () => {
              childExited = true;
              accept();
            }),
          ),
          "Fixture kill",
          5_000,
        );
      }
    }
    await bounded(rm(runDirectory, { recursive: true, force: true }), "Parent temporary files");
    parentCleanup = child === null || childExited;
  } catch {
    failure ??= "The parent could not confirm cleanup.";
  }
  // Check source even when a behavioral group failed. Unknown and changed are different outcomes.
  if (sourceManifestDigest) {
    try {
      sourceUnchanged =
        digest(JSON.stringify(await bounded(inventory(), "Final source inventory"))) === sourceManifestDigest;
      if (!sourceUnchanged) failure ??= "Source changed during the check.";
    } catch (error) {
      sourceCheckError = safe(error instanceof Error ? error.message : "The final source check failed.", 8_192);
      failure ??= "The final source check failed.";
    }
  }
}

const log = safe(
  `${diagnostics}\n${result?.cases.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.name}${item.error ? `: ${item.error}` : ""}`).join("\n") ?? "No fixture receipt."}\n${result?.cleanupReceipts.map((item) => `CLEAN ${item.passed ? "PASS" : "FAIL"} ${item.resource}`).join("\n") ?? "No cleanup receipts."}\n${result?.cleanupErrors.map((item) => `${item.resource} ${item.name} ${item.code}: ${item.message}`).join("\n") ?? ""}\n${failure ?? ""}\n`,
  256 * 1_024,
);
let logWritten = false;
let reportWritten = false;
const artifactErrors: string[] = [];
try {
  await bounded(writeFile(join(OUT, "execution.log"), log, { mode: 0o600 }), "Execution log write");
  logWritten = true;
} catch {
  artifactErrors.push("Execution log write failed.");
}
const report = {
  version: 1,
  nonce,
  sourceHead,
  sourceManifest,
  sourceManifestDigest,
  sourceUnchanged,
  sourceCheckError,
  runtime: { bun: process.versions.bun ?? null, actualNode },
  requiredCases: 15,
  executedCases: result?.executedCases ?? 0,
  passedCases: result?.passedCases ?? 0,
  cases: result?.cases ?? [],
  passed:
    failure === null &&
    result?.passed === true &&
    sourceUnchanged === true &&
    parentCleanup &&
    logWritten &&
    droppedBytes === 0,
  cleanup: { parent: parentCleanup, fixture: result?.cleanupPassed ?? false },
  cleanupRequired: result?.cleanupRequired ?? null,
  cleanupReceipts: result?.cleanupReceipts ?? [],
  cleanupErrors: result?.cleanupErrors ?? [],
  droppedBytes,
  nativeDeliveryVerified: false,
  externalPushRequests: 0,
  failure,
  fixtureFailure: result?.failure ?? null,
  logWritten,
  artifactErrors,
};
try {
  await bounded(
    writeFile(join(OUT, "report.json"), safe(`${JSON.stringify(report, null, 2)}\n`, 1_024 * 1_024), { mode: 0o600 }),
    "Report write",
  );
  reportWritten = true;
} catch {
  artifactErrors.push("Report write failed.");
}
// Machine-readable: artifact receipts are emitted only after each independent write completes.
process.stdout.write(
  `${JSON.stringify({
    nonce,
    sourceHead,
    sourceManifestDigest,
    requiredCases: 15,
    executedCases: report.executedCases,
    passedCases: report.passedCases,
    passed: report.passed && reportWritten,
    cleanup: report.cleanup,
    cleanupErrorCount: report.cleanupErrors.length,
    logWritten,
    reportWritten,
    artifactErrors,
  })}\n`,
);
process.exitCode = report.passed && reportWritten ? 0 : 1;

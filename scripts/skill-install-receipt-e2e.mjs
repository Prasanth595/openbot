import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Result, Schema } from "effect";
import { zipSync } from "fflate";
import { SkillMarketplaceService } from "../src/main/skill-marketplace-service.ts";

// The injected auth boundary uses the released CentralAuthManager error contract.
class CentralAuthOperationError extends Schema.TaggedError()("CentralAuthOperationError", {
  cause: Schema.Defect(),
}) {}

const files = {
  "SKILL.md": Buffer.from("---\nname: Receipt Skill\ndescription: Test install receipts.\n---\nUse this skill.\n"),
  "references/example.txt": Buffer.from("Installed bundle bytes.\n"),
};
const bundle = zipSync(files);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const detail = {
  id: "receipt-skill",
  versionId: "receipt-version-1",
  slug: "receipt-skill",
  name: "Receipt Skill",
  description: "Test install receipts.",
  category: "development",
  creatorName: "Test Author",
  creatorAvatarUrl: null,
  version: 1,
  installs: 0,
  featured: false,
  iconUrl: null,
  updatedAt: "2026-10-14T00:00:00.000Z",
  instructions: "Use this skill.",
  files: Object.keys(files),
  bundleSha256: hash(bundle),
};
const input = { agentId: "receipt-agent", skillId: detail.id };
const roots = [".agents/skills", ".claude/skills"];
const report = { status: "running", cases: [] };

async function installedLock(workspace) {
  const lock = JSON.parse(await readFile(join(workspace, ".openbot/skills-lock.json"), "utf8"));
  assert.equal(lock.version, 1);
  assert.deepEqual(Object.keys(lock.skills), [detail.id]);
  const entry = lock.skills[detail.id];
  assert.equal(entry.skillId, detail.id);
  assert.equal(entry.versionId, detail.versionId);
  assert.equal(entry.slug, detail.slug);
  assert.equal(entry.version, detail.version);
  assert.equal(entry.bundleSha256, detail.bundleSha256);
  assert.match(entry.receiptId, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(entry.files, Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])));
  for (const root of roots) {
    for (const [name, bytes] of Object.entries(files)) {
      assert.deepEqual(await readFile(join(workspace, root, detail.slug, name)), bytes);
    }
  }
  return entry;
}

async function notInstalled(workspace) {
  for (const path of [".openbot/skills-lock.json", ...roots.map((root) => `${root}/${detail.slug}`)]) {
    await assert.rejects(readFile(join(workspace, path)), (error) => error.code === "ENOENT");
  }
}

async function scenario(name, options, check) {
  const workspace = await mkdtemp(join(tmpdir(), "openbot-skill-receipt-"));
  const receipts = [];
  const committedReceipts = [];
  let downloads = 0;
  let refreshes = 0;
  let receiptAttempts = 0;
  const auth = {
    resolveApiUrl: (path) => `https://example.invalid${path}`,
    requestAuthorized: (path, init, decode) =>
      Effect.gen(function* () {
        if (init.method === "GET") {
          assert.equal(path, `/v1/skills/${detail.id}`);
          return { ...detail, ...options.detail };
        }
        assert.equal(init.method, "POST");
        assert.equal(path, `/v1/skills/${detail.id}/install`);
        receiptAttempts += 1;
        const receipt = JSON.parse(init.body);
        const entry = yield* Effect.promise(() => installedLock(workspace));
        assert.deepEqual(receipt, { receiptId: entry.receiptId });
        committedReceipts.push(entry.receiptId);
        if (options.receiptDefect) return yield* Effect.die(new Error("Test receipt defect."));
        if (options.receiptInterrupt) return yield* Effect.interrupt;
        if (options.unexpectedReceiptFailure) return yield* Effect.fail({ _tag: "UnexpectedReceiptError" });
        receipts.push(receipt);
        if (options.receiptFailure) return yield* Effect.fail(new CentralAuthOperationError({ cause: "test-receipt" }));
        return decode({ installed: true });
      }),
    downloadAuthorized: (path) =>
      Effect.gen(function* () {
        assert.equal(path, `/v1/skills/${detail.id}/content`);
        downloads += 1;
        if (options.downloadFailure)
          return yield* Effect.fail(new CentralAuthOperationError({ cause: "test-download" }));
        return options.bytes ?? bundle;
      }),
  };
  try {
    const service = new SkillMarketplaceService(
      auth,
      () => [{ id: input.agentId, provider: "codex", workspacePath: workspace }],
      (id) =>
        Effect.gen(function* () {
          assert.equal(id, input.agentId);
          refreshes += 1;
          yield* Effect.promise(() => installedLock(workspace));
          if (options.refreshFailure)
            return yield* Effect.fail({ _tag: "AgentLifecycleFailed", cause: "test-refresh" });
        }),
    );
    if (options.diskFailure) await writeFile(join(workspace, ".agents"), "Blocked install directory.\n");
    const result = await Effect.runPromiseExit(service.install(input));
    const state = { workspace, service, result, receipts, committedReceipts };
    await check(state);
    assert.equal(downloads, options.reinstall ? 2 : 1);
    assert.equal(receiptAttempts, options.receiptAttempts ?? (options.reinstall ? 2 : 1));
    assert.equal(refreshes, options.refreshes ?? (options.reinstall ? 2 : 1));
    report.cases.push({ name, status: "pass", downloads, receiptAttempts, receipts: receipts.length, refreshes });
  } catch {
    report.cases.push({ name, status: "fail", downloads, receiptAttempts, receipts: receipts.length, refreshes });
    process.stderr.write(`FAIL: ${name}\n`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function successfulInstall({ workspace, service, result, receipts, committedReceipts }) {
  assert.ok(Exit.isSuccess(result));
  assert.equal(result.value.skillId, detail.id);
  assert.equal(result.value.state, "installed");
  const entry = await installedLock(workspace);
  assert.deepEqual(receipts, [{ receiptId: entry.receiptId }]);
  assert.deepEqual(committedReceipts, [entry.receiptId]);
  const installed = await Effect.runPromise(service.listInstalled(input.agentId));
  assert.deepEqual(installed, [result.value]);
}

async function rejectedBeforeInstall({ workspace, service, result, receipts }) {
  assert.ok(Exit.isFailure(result));
  assert.ok(!Exit.hasDies(result) && !Exit.hasInterrupts(result));
  await notInstalled(workspace);
  assert.deepEqual(await Effect.runPromise(service.listInstalled(input.agentId)), []);
  assert.deepEqual(receipts, []);
}

await scenario("successful receipt", {}, successfulInstall);
await scenario("failed receipt after commit", { receiptFailure: true, reinstall: true }, async (state) => {
  await successfulInstall(state);
  const first = await installedLock(state.workspace);
  const second = await Effect.runPromise(state.service.install(input));
  assert.deepEqual(second, state.result.value);
  assert.equal((await installedLock(state.workspace)).receiptId, first.receiptId);
  assert.deepEqual(state.receipts, [{ receiptId: first.receiptId }, { receiptId: first.receiptId }]);
});
await scenario("download failure", { downloadFailure: true, receiptAttempts: 0, refreshes: 0 }, rejectedBeforeInstall);
const invalidBundle = zipSync({ "README.md": Buffer.from("No skill metadata.\n") });
await scenario(
  "invalid bundle",
  { bytes: invalidBundle, detail: { bundleSha256: hash(invalidBundle) }, receiptAttempts: 0, refreshes: 0 },
  rejectedBeforeInstall,
);
await scenario(
  "hash mismatch",
  { detail: { bundleSha256: "0".repeat(64) }, receiptAttempts: 0, refreshes: 0 },
  rejectedBeforeInstall,
);
await scenario("local disk failure", { diskFailure: true, receiptAttempts: 0, refreshes: 0 }, async (state) => {
  assert.ok(Exit.isFailure(state.result));
  assert.ok(!Exit.hasDies(state.result));
  await assert.rejects(
    readFile(join(state.workspace, ".openbot/skills-lock.json")),
    (error) => error.code === "ENOENT",
  );
  assert.deepEqual(state.receipts, []);
});
await scenario("runtime refresh failure", { receiptFailure: true, refreshFailure: true }, async (state) => {
  const result = await Effect.runPromise(Effect.result(Effect.suspend(() => state.result)));
  assert.ok(Result.isFailure(result));
  assert.equal(result.failure._tag, "SkillMarketplaceFailure");
  assert.equal(result.failure.cause, "test-refresh");
  await installedLock(state.workspace);
  assert.equal(state.receipts.length, 1);
});
for (const [name, options, predicate] of [
  ["receipt defect", { receiptDefect: true }, Exit.hasDies],
  ["receipt interruption", { receiptInterrupt: true }, Exit.hasInterrupts],
  ["unexpected receipt error", { unexpectedReceiptFailure: true }, Exit.isFailure],
]) {
  await scenario(name, { ...options, refreshes: 0 }, async (state) => {
    assert.ok(predicate(state.result));
    await installedLock(state.workspace);
    assert.deepEqual(state.receipts, []);
  });
}

report.status = report.cases.every((item) => item.status === "pass") ? "pass" : "fail";
await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/skill-install-receipt-e2e.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = report.status === "pass" ? 0 : 1;

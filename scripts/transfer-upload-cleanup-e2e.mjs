import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  INSTANCE_TRANSFER_FORMAT,
  INSTANCE_TRANSFER_MANIFEST,
  INSTANCE_TRANSFER_VERSION,
} from "../src/main/instance-transfer-manifest.ts";
import { InstanceTransferService } from "../src/main/instance-transfer-service.ts";

const run = Effect.runPromise;
const exportInput = { agentIds: [], includeFiles: false, includeSettings: false };
const manifest = {
  format: INSTANCE_TRANSFER_FORMAT,
  version: INSTANCE_TRANSFER_VERSION,
  source: { appVersion: "e2e", exportedAt: "2026-10-14T00:00:00.000Z" },
  agents: [],
  settings: { mcpServers: [], customProviders: [], customAgents: [], sidebarSections: [], routineFlows: [] },
  shared: null,
  signedIn: [],
};
const bytes = zipSync({ [INSTANCE_TRANSFER_MANIFEST]: strToU8(JSON.stringify(manifest)) });

function service(uploadDirectory) {
  return new InstanceTransferService({
    uploadDirectory,
    sharedRoot: join(dirname(uploadDirectory), "shared"),
    appVersion: "e2e",
    agents: { listAgents: () => [] },
    skills: {},
    settings: { signedInProviders: () => [] },
    timezone: () => "UTC",
  });
}

async function names(directory) {
  return (await readdir(directory)).sort();
}

async function verifyArchives(directory, expected) {
  const files = await names(directory);
  assert.equal(files.length, expected);
  for (const file of files) {
    const archive = unzipSync(await readFile(join(directory, file)));
    const value = JSON.parse(strFromU8(archive[INSTANCE_TRANSFER_MANIFEST]));
    assert.equal(value.format, INSTANCE_TRANSFER_FORMAT);
    assert.equal(value.version, INSTANCE_TRANSFER_VERSION);
  }
  return files;
}

async function seed(directory) {
  const previous = service(directory);
  await run(previous.stageUpload(async () => bytes, "previous-owner"));
  await run(previous.exportForMember(exportInput));
  await writeFile(join(directory, "interrupted.zip.part"), bytes);
  return names(directory);
}

async function restart(directory) {
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "--seed", directory],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const orphans = JSON.parse(child.stdout);
  assert.equal(orphans.length, 3);
  return orphans;
}

async function checkRestart(root, firstWriter) {
  const directory = join(root, firstWriter, "instance-transfer-uploads");
  const orphans = await restart(directory);
  const current = service(directory);
  let exported;
  if (firstWriter === "export") exported = await run(current.exportForMember(exportInput));
  const [alice, bob] = await Promise.all([
    run(current.stageUpload(async () => bytes, "alice")),
    run(current.stageUpload(async () => bytes, "bob")),
  ]);
  for (const orphan of orphans) {
    await assert.rejects(readFile(join(directory, orphan)), { code: "ENOENT" }, `Old file remains: ${orphan}`);
  }
  if (!exported) exported = await run(current.exportForMember(exportInput));
  await verifyArchives(directory, 3);
  const before = await names(directory);
  await run(current.discard(alice.token, "bob"));
  await assert.rejects(run(current.apply({ token: alice.token, keys: [], includeSettings: false }, "bob")));
  assert.deepEqual(await names(directory), before);
  await run(current.discard(alice.token, "alice"));
  await verifyArchives(directory, 2);
  const result = await run(current.apply({ token: bob.token, keys: [], includeSettings: false }, "bob"));
  assert.deepEqual(result.agents, []);
  assert.deepEqual(await names(directory), [exported.slice(directory.length + 1)]);
  await assert.rejects(run(current.apply({ token: bob.token, keys: [], includeSettings: false }, "bob")));
  await rm(exported);
}

async function checkConcurrent(root) {
  const directory = join(root, "concurrent", "instance-transfer-uploads");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "old.zip"), bytes);
  const current = service(directory);
  const [alice, exported, bob] = await Promise.all([
    run(current.stageUpload(async () => bytes, "alice")),
    run(current.exportForMember(exportInput)),
    run(current.stageUpload(async () => bytes, "bob")),
  ]);
  await verifyArchives(directory, 3);
  await assert.rejects(readFile(join(directory, "old.zip")), { code: "ENOENT" });
  await Promise.all([
    run(current.apply({ token: alice.token, keys: [], includeSettings: false }, "alice")),
    run(current.apply({ token: bob.token, keys: [], includeSettings: false }, "bob")),
  ]);
  await readFile(exported);
  await rm(exported);
}

async function checkRetry(root) {
  const blocker = join(root, "blocked");
  const directory = join(blocker, "instance-transfer-uploads");
  await writeFile(blocker, "A file blocks the parent directory.");
  const current = service(directory);
  const failed = await Promise.allSettled([
    run(current.stageUpload(async () => bytes, "alice")),
    run(current.exportForMember(exportInput)),
  ]);
  assert.ok(failed.every((result) => result.status === "rejected"));
  await rm(blocker);
  const preview = await run(current.stageUpload(async () => bytes, "alice"));
  await verifyArchives(directory, 1);
  await run(current.discard(preview.token, "alice"));
  assert.deepEqual(await names(directory), []);
}

async function checkLocal(root) {
  const path = join(root, "user-owned.zip");
  await writeFile(path, bytes);
  const current = service(join(root, "local", "instance-transfer-uploads"));
  const local = await run(current.stage(path));
  const uploaded = await run(current.stageUpload(async () => bytes, "alice"));
  await run(current.discard(local.token));
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
  await assert.rejects(run(current.stageUpload(async () => new Uint8Array([1, 2, 3]), "alice")));
  await verifyArchives(join(root, "local", "instance-transfer-uploads"), 1);
  await run(current.apply({ token: uploaded.token, keys: [], includeSettings: false }, "alice"));
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
}

if (process.argv[2] === "--seed") {
  process.stdout.write(JSON.stringify(await seed(process.argv[3])));
} else {
  const reportPath = fileURLToPath(new URL("../.openbot-build/transfer-upload-cleanup-e2e.json", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "transfer-upload-cleanup-"));
  const report = { status: "running", checks: [] };
  try {
    for (const [name, check] of [
      ["restart-upload-first", () => checkRestart(root, "upload")],
      ["restart-export-first", () => checkRestart(root, "export")],
      ["concurrent-writers", () => checkConcurrent(root)],
      ["preparation-retry", () => checkRetry(root)],
      ["local-file-and-invalid-upload", () => checkLocal(root)],
    ]) {
      await check();
      report.checks.push({ name, status: "passed" });
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
}

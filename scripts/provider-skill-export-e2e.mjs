#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { strFromU8, unzipSync } from "fflate";
import { InstanceTransferService } from "../src/main/instance-transfer-service.ts";

const reportPath = new URL("../.openbot-build/provider-skill-export-e2e.json", import.meta.url);
const report = { status: "failed", cases: [], cleaned: false };
const root = await mkdtemp(join(tmpdir(), "openbot-provider-skill-export-"));

async function skill(folder, slug, content) {
  const directory = join(root, "workspace", folder, slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), content);
  return directory;
}

try {
  const agentsContent = "---\nname: duplicate\ndescription: Agents copy\n---\nAgents bytes.\n";
  const claudeContent = "---\nname: duplicate\ndescription: Claude copy\n---\nClaude bytes.\n";
  await skill(".agents/skills", "duplicate", agentsContent);
  await skill(".claude/skills", "duplicate", claudeContent);
  await writeFile(join(root, "workspace/.agents/skills/duplicate/data.bin"), new Uint8Array([0, 1, 255]));
  await writeFile(join(root, "workspace/.claude/skills/duplicate/data.bin"), new Uint8Array([255, 2, 0]));
  const agentsOnly = "---\nname: agents-only\ndescription: Fallback\n---\nAgents fallback.\n";
  const claudeOnly = "---\nname: claude-only\ndescription: Fallback\n---\nClaude fallback.\n";
  await skill(".agents/skills", "agents-only", agentsOnly);
  await skill(".claude/skills", "claude-only", claudeOnly);
  for (const folder of [".agents/skills", ".claude/skills"]) {
    const managed = await skill(folder, "managed", "Managed bytes.\n");
    await writeFile(join(managed, ".openbot-managed.json"), "{}\n");
  }
  const linkedContent = "---\nname: linked\ndescription: Linked folder\n---\nLinked bytes.\n";
  await mkdir(join(root, "linked-source"));
  await writeFile(join(root, "linked-source/SKILL.md"), linkedContent);
  await symlink(join(root, "linked-source"), join(root, "workspace/.agents/skills/linked"), "dir");

  for (const provider of ["codex", "claude"]) {
    const agent = {
      id: "export-agent",
      name: "Export agent",
      title: "",
      description: "Export fixture",
      avatarSeed: "export-agent",
      avatarHue: null,
      avatarUrl: null,
      workspacePath: join(root, "workspace"),
      provider,
      model: "fixture-model",
      reasoningEffort: "medium",
      notifications: true,
    };
    const service = new InstanceTransferService({
      agents: {
        listAgents: () => [agent],
        listRoutines: () => [],
        listMemories: () => [],
        getMemorySelection: () => ({ selections: [] }),
        resolveAvatar: () => null,
      },
      settings: { signedInProviders: () => [] },
      sharedRoot: join(root, "shared"),
      appVersion: "0.39.1",
      now: () => new Date("2026-10-14T00:00:00.000Z"),
    });
    const summary = await Effect.runPromise(service.summary());
    assert.equal(summary.agents[0].skillCount, 4);
    const path = join(root, `${provider}.zip`);
    const result = await Effect.runPromise(
      service.exportTo(path, { agentIds: [agent.id], includeFiles: false, includeSettings: false }),
    );
    assert.equal(result.saved, true);
    assert.deepEqual(result.warnings, []);
    const entries = unzipSync(await readFile(path));
    const manifest = JSON.parse(strFromU8(entries["openbot-transfer.json"]));
    assert.equal(manifest.format, "openbot-instance-transfer");
    assert.equal(manifest.version, 1);
    assert.equal(manifest.agents.length, 1);
    assert.equal(manifest.agents[0].provider, provider);
    assert.equal(manifest.agents[0].files, null);
    assert.equal(manifest.settings, null);
    assert.equal(manifest.shared, null);
    const prefix = "agents/export-agent/skills/";
    assert.deepEqual(
      manifest.agents[0].skills,
      ["agents-only", "claude-only", "duplicate", "linked"].map((slug) => `${prefix}${slug}`),
    );
    assert.deepEqual(Object.keys(entries).sort(), [
      `${prefix}agents-only/SKILL.md`,
      `${prefix}claude-only/SKILL.md`,
      `${prefix}duplicate/SKILL.md`,
      `${prefix}duplicate/data.bin`,
      `${prefix}linked/SKILL.md`,
      "openbot-transfer.json",
    ]);
    assert.equal(strFromU8(entries[`${prefix}agents-only/SKILL.md`]), agentsOnly);
    assert.equal(strFromU8(entries[`${prefix}claude-only/SKILL.md`]), claudeOnly);
    assert.equal(strFromU8(entries[`${prefix}linked/SKILL.md`]), linkedContent);
    const actual = strFromU8(entries[`${prefix}duplicate/SKILL.md`]);
    const expected = provider === "claude" ? claudeContent : agentsContent;
    report.cases.push({ provider, duplicateBytesMatch: actual === expected, fallback: true, symlink: true });
    assert.equal(actual, expected, `${provider}: export must use the current provider's skill copy`);
    assert.deepEqual(
      entries[`${prefix}duplicate/data.bin`],
      new Uint8Array(provider === "claude" ? [255, 2, 0] : [0, 1, 255]),
    );
  }
  report.status = "passed";
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "E2E failed."}\n`);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  report.cleaned = true;
  await mkdir(new URL("../.openbot-build/", import.meta.url), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Provider skill export E2E: ${report.status}.\n`);
}

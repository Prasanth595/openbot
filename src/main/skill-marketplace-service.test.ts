import { Effect } from "effect";
// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { zipSync } from "fflate";
import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { CentralAuthManager } from "./central-auth-manager";
import { SkillMarketplaceService } from "./skill-marketplace-service";

const encoder = new TextEncoder();
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-skills-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SkillMarketplaceService", () => {
  it("installs into both provider directories and protects modified files", async () => {
    const skillContents = "---\nname: Release Notes\ndescription: Writes release notes.\n---\n";
    const bundle = zipSync({
      "SKILL.md": encoder.encode(skillContents),
      "references/template.md": encoder.encode("Template"),
    });
    const hash = createHash("sha256").update(bundle).digest("hex");
    const sessionPath = join(root, "session.bin");
    await writeFile(
      sessionPath,
      Buffer.from(JSON.stringify({ version: 2, sessionToken: "token", teamHostTokens: {} })).toString("base64"),
    );
    const requests: string[] = [];
    const auth = new CentralAuthManager({
      apiUrl: "http://127.0.0.1:3100",
      storagePath: sessionPath,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
      fetch: async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        requests.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/v1/me")
          return Response.json({ id: "user-1", email: "ada@example.com", name: "Ada", avatarUrl: null });
        if (path === "/v1/skills/skill-1")
          return Response.json({
            id: "skill-1",
            slug: "release-notes",
            name: "Release Notes",
            description: "Writes release notes.",
            category: "documents",
            creatorName: "Ada",
            version: 1,
            installs: 0,
            featured: true,
            iconUrl: null,
            updatedAt: "2026-08-25T00:00:00.000Z",
            versionId: "version-1",
            bundleSha256: hash,
            files: ["SKILL.md", "references/template.md"],
            instructions: "Writes release notes.",
            examplePrompt: "Write notes for the latest commits.",
          });
        if (path.endsWith("/content")) {
          return new Response(Uint8Array.from(bundle).buffer, {
            headers: { "Content-Type": "application/zip" },
          });
        }
        if (path.endsWith("/install")) return Response.json({ installed: true });
        return new Response(null, { status: 404 });
      },
    });
    await runCauseEffect(auth.initialize());
    const agent: AgentSummary = {
      id: "writer",
      provider: "codex",
      name: "Writer",
      title: "",
      description: "",
      notifications: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: null,
      workspacePath: join(root, "writer"),
      preview: "",
      updatedAt: null,
      avatarSeed: "writer",
      avatarHue: null,
      avatarUrl: null,
    };
    const refreshedAgents: string[] = [];
    const service = new SkillMarketplaceService(
      auth,
      () => [agent],
      (agentId) =>
        Effect.sync(() => {
          refreshedAgents.push(agentId);
        }),
    );

    await expect(runCauseEffect(service.get("skill-1"))).resolves.toMatchObject({
      examplePrompt: "Write notes for the latest commits.",
    });

    await expect(runCauseEffect(service.install({ agentId: agent.id, skillId: "skill-1" }))).resolves.toMatchObject({
      state: "installed",
      description: "Writes release notes.",
    });
    await expect(
      readFile(join(agent.workspacePath, ".agents", "skills", "release-notes", "SKILL.md"), "utf8"),
    ).resolves.toContain("Release Notes");
    await expect(
      readFile(join(agent.workspacePath, ".claude", "skills", "release-notes", "SKILL.md"), "utf8"),
    ).resolves.toContain("Release Notes");
    expect(requests).toContain("POST /v1/skills/skill-1/install");
    expect(refreshedAgents).toEqual([agent.id]);

    const claudeSkill = join(agent.workspacePath, ".claude", "skills", "release-notes", "SKILL.md");
    const agentsSkill = join(agent.workspacePath, ".agents", "skills", "release-notes", "SKILL.md");
    await rm(agentsSkill);
    await expect(
      runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "skill-1", enabled: false })),
    ).rejects.toThrow("This skill needs repair before it can be disabled.");
    await expect(readFile(claudeSkill, "utf8")).resolves.toBe(skillContents);
    const [installed] = await runCauseEffect(service.listInstalled(agent.id));
    assert(installed);
    expect(installed.enabled).not.toBe(false);
    await writeFile(agentsSkill, skillContents);
    await writeFile(claudeSkill, "Claude edits");
    const agentsReference = join(
      agent.workspacePath,
      ".agents",
      "skills",
      "release-notes",
      "references",
      "template.md",
    );
    await rm(agentsReference);
    await expect(
      runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "skill-1", enabled: false })),
    ).rejects.toThrow("local changes");
    await expect(readFile(claudeSkill, "utf8")).resolves.toBe("Claude edits");
    await writeFile(agentsReference, "Template");
    await writeFile(claudeSkill, skillContents);
    const gitMetadata = join(agent.workspacePath, ".agents", "skills", "release-notes", ".git");
    await mkdir(gitMetadata);
    await writeFile(join(gitMetadata, "HEAD"), "ref: refs/heads/main");
    await expect(
      runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "skill-1", enabled: false })),
    ).rejects.toThrow("local changes");
    await expect(readFile(join(gitMetadata, "HEAD"), "utf8")).resolves.toBe("ref: refs/heads/main");
    await rm(gitMetadata, { recursive: true });
    await runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "skill-1", enabled: false }));
    expect(await runCauseEffect(service.listPublishable(agent.id))).toEqual([]);
    await mkdir(dirname(claudeSkill), { recursive: true });
    await writeFile(claudeSkill, "New user files");
    await expect(
      runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "skill-1", enabled: true })),
    ).rejects.toThrow("occupied");
    await expect(readFile(claudeSkill, "utf8")).resolves.toBe("New user files");
    await rm(dirname(claudeSkill), { recursive: true });
    await runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "skill-1", enabled: true }));
    expect(await runCauseEffect(service.listPublishable(agent.id))).toEqual([
      expect.objectContaining({ skillId: "skill-1", version: 1 }),
    ]);
    await writeFile(join(agent.workspacePath, ".agents", "skills", "release-notes", "SKILL.md"), "locally changed");
    requests.length = 0;
    await expect(runCauseEffect(service.listInstalledForChatTags(agent.id))).resolves.toEqual([
      expect.objectContaining({ state: "modified", description: "Writes release notes." }),
    ]);
    expect(requests).toEqual([]);
    await expect(runCauseEffect(service.listInstalled(agent.id))).resolves.toEqual([
      expect.objectContaining({ state: "modified" }),
    ]);
    await expect(runCauseEffect(service.uninstall({ agentId: agent.id, skillId: "skill-1" }))).rejects.toThrow(
      "local changes",
    );
    await writeFile(join(agent.workspacePath, ".agents", "skills", "release-notes", "SKILL.md"), skillContents);
    await rm(join(agent.workspacePath, ".claude", "skills", "release-notes", "references", "template.md"));
    await expect(runCauseEffect(service.listInstalledForChatTags(agent.id))).resolves.toEqual([
      expect.objectContaining({ state: "needs-repair" }),
    ]);
    await expect(
      runCauseEffect(service.uninstall({ agentId: agent.id, skillId: "skill-1", removeModified: true })),
    ).resolves.toBeUndefined();
    expect(refreshedAgents).toEqual([agent.id, agent.id, agent.id, agent.id]);
    await runCauseEffect(service.install({ agentId: agent.id, skillId: "skill-1" }));
    await runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "skill-1", enabled: false }));
    await mkdir(dirname(claudeSkill), { recursive: true });
    await writeFile(claudeSkill, "Unowned files after disable");
    await runCauseEffect(service.uninstall({ agentId: agent.id, skillId: "skill-1" }));
    await expect(readFile(claudeSkill, "utf8")).resolves.toBe("Unowned files after disable");
    // The files the user kept are still in a folder the provider reads, so the list shows them.
    await expect(runCauseEffect(service.listInstalled(agent.id))).resolves.toEqual([
      expect.objectContaining({ origin: "workspace", location: ".claude/skills/release-notes" }),
    ]);
  });
  /*
   * A plugin listing pins the version of each skill it brings, so the install must ask for that
   * version and not for whatever is newest. The endpoint it reaches is the whole difference.
   */
  it("installs the pinned version when the caller names one", async () => {
    const bundle = zipSync({ "SKILL.md": encoder.encode("---\nname: Yield\ndescription: Reads yields.\n---\n") });
    const hash = createHash("sha256").update(bundle).digest("hex");
    const sessionPath = join(root, "session.bin");
    await writeFile(
      sessionPath,
      Buffer.from(JSON.stringify({ version: 2, sessionToken: "token", teamHostTokens: {} })).toString("base64"),
    );
    const requests: string[] = [];
    const auth = new CentralAuthManager({
      apiUrl: "http://127.0.0.1:3100",
      storagePath: sessionPath,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
      fetch: async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        requests.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/v1/me")
          return Response.json({ id: "user-1", email: "ada@example.com", name: "Ada", avatarUrl: null });
        if (path.endsWith("/content"))
          return new Response(Uint8Array.from(bundle).buffer, { headers: { "Content-Type": "application/zip" } });
        if (path === "/v1/skills/skill-1/versions/version-7")
          return Response.json({
            id: "skill-1",
            slug: "yield",
            name: "Yield",
            description: "Reads yields.",
            category: "other",
            creatorName: "Ada",
            version: 7,
            installs: 0,
            featured: false,
            iconUrl: null,
            updatedAt: "2026-09-18T00:00:00.000Z",
            versionId: "version-7",
            bundleSha256: hash,
            files: ["SKILL.md"],
            instructions: "Reads yields.",
            examplePrompt: "Where is the best yield?",
          });
        if (path.endsWith("/install")) return Response.json({ installed: true });
        return new Response(null, { status: 404 });
      },
    });
    await runCauseEffect(auth.initialize());
    const agent: AgentSummary = {
      id: "reader",
      provider: "codex",
      name: "Reader",
      title: "",
      description: "",
      notifications: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: null,
      workspacePath: join(root, "reader"),
      preview: "",
      updatedAt: null,
      avatarSeed: "reader",
      avatarHue: null,
      avatarUrl: null,
    };
    const service = new SkillMarketplaceService(
      auth,
      () => [agent],
      () => Effect.void,
    );

    await expect(
      runCauseEffect(service.install({ agentId: agent.id, skillId: "skill-1", versionId: "version-7" })),
    ).resolves.toMatchObject({ installedVersion: 7, state: "installed" });
    expect(requests).toContain("GET /v1/skills/skill-1/versions/version-7");
    expect(requests).toContain("GET /v1/skills/skill-1/versions/version-7/content");
    expect(requests).not.toContain("GET /v1/skills/skill-1");

    await expect(
      runCauseEffect(service.install({ agentId: agent.id, skillId: "local-skill-1", versionId: "version-7" })),
    ).rejects.toThrow("A local skill has no published version.");
  });

  /*
   * A pack installs each `skills/<slug>-<name>/` as a folder of its own, under one lock entry. Ways
   * it can lose or leak files: a folder the user already has is overwritten; disable, enable or
   * removal misses a pack folder; a removed disabled pack deletes files the user put back.
   */
  it("installs each skill of a pack as its own folder and removes them together", async () => {
    const skill = (name: string) => encoder.encode(`---\nname: ${name}\ndescription: The ${name} skill.\n---\n`);
    const bundle = zipSync({
      "SKILL.md": skill("pack"),
      "skills/pack-a/SKILL.md": skill("pack-a"),
      "skills/pack-a/references/notes.md": encoder.encode("Notes"),
      "skills/pack-b/SKILL.md": skill("pack-b"),
    });
    const hash = createHash("sha256").update(bundle).digest("hex");
    const sessionPath = join(root, "session.bin");
    await writeFile(
      sessionPath,
      Buffer.from(JSON.stringify({ version: 2, sessionToken: "token", teamHostTokens: {} })).toString("base64"),
    );
    const requests: string[] = [];
    const auth = new CentralAuthManager({
      apiUrl: "http://127.0.0.1:3100",
      storagePath: sessionPath,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
      fetch: async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        requests.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/v1/me")
          return Response.json({ id: "user-1", email: "ada@example.com", name: "Ada", avatarUrl: null });
        if (path === "/v1/skills/pack-1")
          return Response.json({
            id: "pack-1",
            slug: "pack",
            name: "pack",
            description: "The pack skill.",
            category: "coding",
            creatorName: "Ada",
            version: 1,
            installs: 0,
            featured: false,
            iconUrl: null,
            updatedAt: "2026-10-13T00:00:00.000Z",
            versionId: "version-1",
            bundleSha256: hash,
            files: [],
            instructions: "The pack skill.",
          });
        if (path.endsWith("/content"))
          return new Response(Uint8Array.from(bundle).buffer, { headers: { "Content-Type": "application/zip" } });
        if (path.endsWith("/install")) return Response.json({ installed: true });
        return new Response(null, { status: 404 });
      },
    });
    await runCauseEffect(auth.initialize());
    const agent: AgentSummary = {
      id: "coder",
      provider: "codex",
      name: "Coder",
      title: "",
      description: "",
      notifications: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: null,
      workspacePath: join(root, "coder"),
      preview: "",
      updatedAt: null,
      avatarSeed: "coder",
      avatarHue: null,
      avatarUrl: null,
    };
    const service = new SkillMarketplaceService(
      auth,
      () => [agent],
      () => Effect.void,
    );
    const folder = (provider: ".agents" | ".claude", name: string) =>
      join(agent.workspacePath, provider, "skills", name);
    const install = () => runCauseEffect(service.install({ agentId: agent.id, skillId: "pack-1" }));
    const setEnabled = (enabled: boolean) =>
      runCauseEffect(service.setEnabled({ agentId: agent.id, skillId: "pack-1", enabled }));

    const userFile = join(folder(".claude", "pack-b"), "SKILL.md");
    await mkdir(dirname(userFile), { recursive: true });
    await writeFile(userFile, "The user's own skill");
    await expect(install()).rejects.toThrow("pack-b");
    await expect(readFile(userFile, "utf8")).resolves.toBe("The user's own skill");
    await rm(dirname(userFile), { recursive: true });

    requests.length = 0;
    await expect(install()).resolves.toMatchObject({ state: "installed" });
    expect(requests.filter((request) => request.startsWith("POST"))).toEqual(["POST /v1/skills/pack-1/install"]);
    for (const provider of [".agents", ".claude"] as const) {
      await expect(readFile(join(folder(provider, "pack-a"), "references", "notes.md"), "utf8")).resolves.toBe("Notes");
      await expect(readFile(join(folder(provider, "pack-b"), "SKILL.md"), "utf8")).resolves.toContain("pack-b");
      await expect(readFile(join(folder(provider, "pack"), "SKILL.md"), "utf8")).resolves.toContain("name: pack");
    }
    await expect(runCauseEffect(service.listInstalled(agent.id))).resolves.toEqual([
      expect.objectContaining({ skillId: "pack-1", state: "installed" }),
    ]);
    const tags = await runCauseEffect(service.listInstalledForChatTags(agent.id));
    expect(tags.map((tag) => tag.name).sort()).toEqual(["pack", "pack-a", "pack-b"]);

    await setEnabled(false);
    for (const name of ["pack", "pack-a", "pack-b"]) await expect(readFile(folder(".agents", name))).rejects.toThrow();
    await setEnabled(true);
    await expect(runCauseEffect(service.listInstalled(agent.id))).resolves.toEqual([
      expect.objectContaining({ state: "installed", enabled: true }),
    ]);

    await writeFile(join(folder(".agents", "pack-a"), "SKILL.md"), "Edited");
    await expect(runCauseEffect(service.listInstalled(agent.id))).resolves.toEqual([
      expect.objectContaining({ state: "modified" }),
    ]);
    await expect(runCauseEffect(service.uninstall({ agentId: agent.id, skillId: "pack-1" }))).rejects.toThrow(
      "local changes",
    );
    await runCauseEffect(service.uninstall({ agentId: agent.id, skillId: "pack-1", removeModified: true }));
    for (const provider of [".agents", ".claude"] as const)
      for (const name of ["pack", "pack-a", "pack-b"])
        await expect(readFile(join(folder(provider, name), "SKILL.md"))).rejects.toThrow();

    // A lock entry from before packs has no `folders`: its `skills/` stays inside its own folder.
    const lockFile = join(agent.workspacePath, ".openbot", "skills-lock.json");
    await install();
    const lock = JSON.parse(await readFile(lockFile, "utf8"));
    expect(lock.skills["pack-1"].folders).toEqual(["pack-a", "pack-b"]);
    delete lock.skills["pack-1"].folders;
    await writeFile(lockFile, JSON.stringify(lock));
    for (const provider of [".agents", ".claude"] as const) {
      await rm(folder(provider, "pack-a"), { recursive: true });
      await rm(folder(provider, "pack-b"), { recursive: true });
      await mkdir(join(folder(provider, "pack"), "skills", "pack-a", "references"), { recursive: true });
      await mkdir(join(folder(provider, "pack"), "skills", "pack-b"), { recursive: true });
      await writeFile(join(folder(provider, "pack"), "skills", "pack-a", "SKILL.md"), skill("pack-a"));
      await writeFile(join(folder(provider, "pack"), "skills", "pack-a", "references", "notes.md"), "Notes");
      await writeFile(join(folder(provider, "pack"), "skills", "pack-b", "SKILL.md"), skill("pack-b"));
    }
    await expect(runCauseEffect(service.listInstalled(agent.id))).resolves.toEqual([
      expect.objectContaining({ skillId: "pack-1", state: "installed" }),
    ]);
    await runCauseEffect(service.uninstall({ agentId: agent.id, skillId: "pack-1" }));

    await install();
    await setEnabled(false);
    const keptFile = join(folder(".agents", "pack-a"), "SKILL.md");
    await mkdir(dirname(keptFile), { recursive: true });
    await writeFile(keptFile, "Put back by the user");
    await runCauseEffect(service.uninstall({ agentId: agent.id, skillId: "pack-1" }));
    await expect(readFile(keptFile, "utf8")).resolves.toBe("Put back by the user");
  });
});

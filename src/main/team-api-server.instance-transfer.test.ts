import { Effect } from "effect";
// @vitest-environment node

// Who may move a server's agents and server settings with `instance-transfer-v1`. The authority is
// frozen: only an owner or an admin, because an export holds every agent's memories and files. The
// token is the caller's own, and the wire carries no avatars and no workspace paths.

import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary, InstanceTransferPreview, InstanceTransferSummary } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTeamApiFixture, stopTeamApiFixtures, type TeamApiOptions } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const summary: InstanceTransferSummary = {
  agents: [
    {
      id: "agent-1",
      name: "Research",
      title: "Analyst",
      avatarSeed: "research",
      avatarHue: 30,
      avatarUrl: "openbot-avatar://agent-1/1",
      skillCount: 1,
      routineCount: 2,
      memoryCount: 3,
      fileCount: 4,
      fileBytes: 5,
    },
  ],
};
const wireAgent = {
  key: "research",
  name: "Research",
  title: "Analyst",
  description: "You are research.",
  skillCount: 0,
  routineCount: 0,
  memoryCount: 0,
  fileCount: 0,
  fileBytes: 0,
  nameExists: false,
};
const preview: InstanceTransferPreview = {
  token: "token-1",
  appVersion: "0.9.4",
  exportedAt: null,
  agents: [{ ...wireAgent, avatarUrl: "data:image/png;base64,AAAA" }],
  hasSettings: true,
  warnings: [],
};
const agent: AgentSummary = {
  id: "agent-2",
  name: "Research",
  title: "Analyst",
  description: "You are research.",
  provider: "codex",
  notifications: true,
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/Users/host/OpenBot/agent-2",
  preview: "",
  updatedAt: null,
  avatarSeed: "research",
  avatarHue: null,
  avatarUrl: null,
};

async function createInstanceTransfer() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-transfer-route-"));
  const staged: Array<{ bytes: number[]; owner: string }> = [];
  const applied: string[] = [];
  const calls = { staged, applied };
  const service: NonNullable<TeamApiOptions["instanceTransfer"]> = {
    summary: () => Effect.succeed(summary),
    exportForMember: () =>
      Effect.promise(async () => {
        const path = join(directory, "export.zip");
        await writeFile(path, new Uint8Array([80, 75, 5, 6]));
        return path;
      }),
    stageUpload: (read, owner) =>
      Effect.gen(function* () {
        const bytes = yield* Effect.promise(read);
        calls.staged.push({ bytes: [...bytes], owner });
        return preview;
      }),
    apply: (_input, owner) =>
      Effect.sync(() => {
        if (owner) calls.applied.push(owner);
        return { agents: [agent], skipped: [], signIn: ["claude"], warnings: [] };
      }),
    discard: () => Effect.void,
  };
  return { service, calls, directory };
}

describe("Team API instance transfer", () => {
  it("lets only an owner or admin export and import, with no avatars or paths on the wire", async () => {
    const transfer = await createInstanceTransfer();
    const fixture = await createTeamApiFixture("instance-transfer", { configure: true });
    const { base } = await fixture.start({ instanceTransfer: transfer.service });
    const owner = await fixture.signIn({ protocol: 3 });
    const headers = {
      Authorization: `Bearer ${owner}`,
      "OpenBot-Protocol-Version": "3",
      "OpenBot-Capabilities": "instance-transfer-v1",
    };

    const invite = await Effect.runPromise(fixture.store.createInvite("member"));
    const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "member", "member password"));
    const forbidden = await fetch(`${base}/v1/instance-transfer/summary`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${member.sessionToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(forbidden.status).toBe(403);

    // Without the capability the routes answer 400: the connection did not ask for the feature.
    const refused = await fetch(`${base}/v1/instance-transfer/summary`, {
      method: "POST",
      headers: { ...headers, "OpenBot-Capabilities": "", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(refused.status).toBe(400);

    const listed = await fetch(`${base}/v1/instance-transfer/summary`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(listed.status).toBe(200);
    const { avatarUrl: _avatarUrl, ...wireSummaryAgent } = summary.agents[0] ?? { avatarUrl: null };
    expect(await listed.json()).toEqual({ agents: [wireSummaryAgent] });

    const exported = await fetch(`${base}/v1/instance-transfer/export`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds: ["agent-1"], includeFiles: true, includeSettings: true }),
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("attachment;");
    expect([...new Uint8Array(await exported.arrayBuffer())]).toEqual([80, 75, 5, 6]);
    // The host removes the file once it is sent.
    await vi.waitFor(async () => expect(await readdir(transfer.directory)).toEqual([]));

    const staged = await fetch(`${base}/v1/instance-transfer/stage`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body: new Uint8Array([80, 75, 3, 4]),
    });
    expect(staged.status).toBe(200);
    expect(await staged.json()).toEqual({ ...preview, agents: [wireAgent] });

    const applied = await fetch(`${base}/v1/instance-transfer/apply`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "token-1", keys: ["research"], includeSettings: true, timezone: "Europe/Warsaw" }),
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({
      agents: [{ agentId: "agent-2", name: "Research" }],
      skipped: [],
      signIn: ["claude"],
      warnings: [],
    });
    const [stagedBy] = transfer.calls.staged;
    expect(stagedBy?.bytes).toEqual([80, 75, 3, 4]);
    // The token belongs to the caller, so only the caller can apply it.
    expect(transfer.calls.applied).toEqual([stagedBy?.owner]);

    // A new capability is protocol 7 only: a protocol 6 peer reads at most 64.
    const compatibility = await (
      await fetch(`${base}/v1/compatibility`, { headers: { "OpenBot-Protocol-Version": "7" } })
    ).json();
    expect(compatibility).toMatchObject({ capabilities: expect.arrayContaining(["instance-transfer-v1"]) });
  });

  it("does not advertise instance transfer when the host has no transfer service", async () => {
    const fixture = await createTeamApiFixture("instance-transfer-absent", { configure: true });
    const { base } = await fixture.start({});
    const compatibility = await (
      await fetch(`${base}/v1/compatibility`, { headers: { "OpenBot-Protocol-Version": "7" } })
    ).json();
    expect(compatibility.capabilities).not.toContain("instance-transfer-v1");
  });
});

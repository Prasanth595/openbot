// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentMemoryStore } from "./agent-memory-store";
import { AgentRoutineStore } from "./agent-routine-store";
import { AgentStore } from "./agent-store";
import { runCauseEffect } from "./effect-boundary";

const roots: string[] = [];
const stores: AgentStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function open(root?: string) {
  const directory = root ?? (await mkdtemp(join(tmpdir(), "openbot-recovery-")));
  if (!root) roots.push(directory);
  const store = new AgentStore(join(directory, "data"), join(directory, "home"));
  stores.push(store);
  await runCauseEffect(store.initialize());
  return { store, root: directory };
}

it("preserves identity, conversation, sessions, memory, settings and original files through restart and roster writes", async () => {
  const { store, root } = await open();
  await runCauseEffect(store.getOrCreate("chief"));
  const threadId = await runCauseEffect(store.ensureThreadId("chief"));
  const agent = await runCauseEffect(
    store.updateAgent({
      agentId: "chief",
      access: "workspace",
      allowAutomation: true,
      computerUse: false,
      busyMessageMode: "queue",
    }),
  );
  await writeFile(join(agent.workspacePath, "original.md"), "Keep the original file.");
  const conversation = store.database.persistConversation(
    {
      agentId: agent.id,
      threadId,
      revision: 0,
      activeTurnId: null,
      messages: [
        {
          id: "original-message",
          author: "user",
          text: "Original conversation",
          status: "completed",
          createdAt: new Date().toISOString(),
        },
      ],
    },
    "test.saved",
  );
  const memory = new AgentMemoryStore(store.database).createManual(agent.id, "Original memory");
  const session = store.database.bindProviderSession({
    threadId,
    provider: agent.provider,
    externalSessionId: "original-session",
    model: agent.model,
    effort: agent.reasoningEffort,
  });
  const routine = new AgentRoutineStore(store.database).create({
    agentId: agent.id,
    name: "Kept routine",
    instruction: "Keep settings",
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  await runCauseEffect(store.retainAgent(agent.id));
  await expect(runCauseEffect(store.getOrCreate(agent.id))).rejects.toThrow();
  await runCauseEffect(store.getOrCreate("other"));
  store.database.close();
  const { store: restarted } = await open(root);
  expect(restarted.list().map((entry) => entry.id)).toEqual(["other"]);
  expect(restarted.database.unclaimedThreads()).toEqual([]);
  expect(restarted.lastRetainedAgent()).toEqual(agent);
  await expect(runCauseEffect(restarted.restoreLastRetainedAgent())).resolves.toEqual(agent);
  expect(restarted.database.readConversation(agent.id, threadId)).toMatchObject({
    agentId: conversation.agentId,
    threadId: conversation.threadId,
    activeTurnId: conversation.activeTurnId,
    messages: conversation.messages,
  });
  expect(new AgentMemoryStore(restarted.database).list(agent.id)).toEqual([memory]);
  expect(new AgentRoutineStore(restarted.database).list(agent.id)).toEqual([routine]);
  expect(restarted.database.listProviderSessions(threadId)).toEqual([session]);
  expect(await readFile(join(agent.workspacePath, "original.md"), "utf8")).toBe("Keep the original file.");
  expect(restarted.lastRetainedAgent()).toBeNull();
  await expect(runCauseEffect(restarted.restoreLastRetainedAgent())).resolves.toBeNull();
});

it("permanently deletes retained events and receipts across restart while keeping another candidate", async () => {
  const { store, root } = await open();
  const older = await runCauseEffect(store.getOrCreate("older"));
  await writeFile(join(older.workspacePath, "older.md"), "Older data");
  const latest = await runCauseEffect(store.getOrCreate("latest"));
  await runCauseEffect(store.retainAgent(older.id));
  await runCauseEffect(store.retainAgent(latest.id));
  store.database.close();
  const { store: restarted } = await open(root);
  expect(restarted.retainedAgents().map((entry) => entry.id)).toEqual([older.id, latest.id]);
  expect(restarted.lastRetainedAgent()?.id).toBe(latest.id);
  const retentionCommands = restarted.database.connection
    .prepare(
      "SELECT command_id FROM orchestration_events WHERE aggregate_type = 'agent-retention' AND aggregate_id = ?",
    )
    .all(older.id);
  await runCauseEffect(restarted.deleteAgent(older.id));
  for (const row of retentionCommands) {
    if (typeof row.command_id !== "string") throw new Error("Missing retention command ID");
    expect(
      restarted.database.connection
        .prepare("SELECT command_id FROM orchestration_command_receipts WHERE command_id = ?")
        .get(row.command_id),
    ).toBeUndefined();
  }
  restarted.database.close();
  const { store: afterDelete } = await open(root);
  expect(afterDelete.retainedAgents()).toEqual([latest]);
  expect(afterDelete.lastRetainedAgent()).toEqual(latest);
  await expect(runCauseEffect(afterDelete.restoreLastRetainedAgent())).resolves.toEqual(latest);
  expect(afterDelete.lastRetainedAgent()).toBeNull();
  await expect(readFile(join(older.workspacePath, "older.md"))).rejects.toThrow();
});

it("rolls back retention and restoration with the same durable candidate and profile on a failed roster write", async () => {
  const { store } = await open();
  const agent = await runCauseEffect(store.getOrCreate("chief"));
  store.database.connection.exec(
    "CREATE TRIGGER reject_roster BEFORE DELETE ON projection_agents BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  await expect(runCauseEffect(store.retainAgent(agent.id))).rejects.toThrow("injected failure");
  expect(store.list()).toEqual([agent]);
  expect(store.retainedAgents()).toEqual([]);
  expect(store.database.retainedAgents()).toEqual([]);
  expect(store.lastRetainedAgent()).toBeNull();
  store.database.connection.exec("DROP TRIGGER reject_roster");
  await runCauseEffect(store.retainAgent(agent.id));
  store.database.connection.exec(
    "CREATE TRIGGER reject_restore BEFORE INSERT ON projection_agents BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  await expect(runCauseEffect(store.restoreLastRetainedAgent())).rejects.toThrow("injected failure");
  expect(store.list()).toEqual([]);
  expect(store.lastRetainedAgent()).toEqual(agent);
  expect(store.database.retainedAgents()).toEqual([agent]);
  store.database.connection.exec("DROP TRIGGER reject_restore");
  await expect(runCauseEffect(store.restoreLastRetainedAgent())).resolves.toEqual(agent);
});

it("restores successive removals newest first across restarts", async () => {
  const { store, root } = await open();
  const a = await runCauseEffect(store.getOrCreate("a"));
  const b = await runCauseEffect(store.getOrCreate("b"));
  await runCauseEffect(store.retainAgent(a.id));
  await runCauseEffect(store.retainAgent(b.id));
  store.database.close();
  const { store: second } = await open(root);
  await expect(runCauseEffect(second.restoreLastRetainedAgent())).resolves.toEqual(b);
  expect(second.lastRetainedAgent()).toEqual(a);
  second.database.close();
  const { store: third } = await open(root);
  await expect(runCauseEffect(third.restoreLastRetainedAgent())).resolves.toEqual(a);
  expect(third.lastRetainedAgent()).toBeNull();
  expect(third.list().map((agent) => agent.id)).toEqual([a.id, b.id]);
});

it("permanently deleting the newest retained agent exposes the prior candidate after restart", async () => {
  const { store, root } = await open();
  const a = await runCauseEffect(store.getOrCreate("a"));
  const b = await runCauseEffect(store.getOrCreate("b"));
  await runCauseEffect(store.retainAgent(a.id));
  await runCauseEffect(store.retainAgent(b.id));
  await runCauseEffect(store.deleteAgent(b.id));
  store.database.close();
  const { store: restarted } = await open(root);
  expect(restarted.retainedAgents()).toEqual([a]);
  await expect(runCauseEffect(restarted.restoreLastRetainedAgent())).resolves.toEqual(a);
  expect(restarted.lastRetainedAgent()).toBeNull();
});

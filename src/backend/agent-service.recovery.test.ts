// @vitest-environment node
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RoutineScheduler } from "./agent/routine-scheduler";
import { AgentRoutineStore } from "./agent-routine-store";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  notification,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitForQueue,
} from "./agent-service-test-harness";
import { runCauseEffect } from "./effect-boundary";
import { MailboxStore } from "./mailbox-store";

let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
  vi.useRealTimers();
});

it("excludes retained agents from scheduled and manual work and blocks stale delivery admission across restart", async () => {
  const { store, mailbox } = stores(root);
  service = createTestService({ store, mailbox, clientFactory: (provider) => new FakeAgentClient(provider) });
  await runCauseEffect(service.initialize());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-25T10:00:00.000Z"));
  const agent = await runCauseEffect(store.getOrCreate("chief"));
  const routine = service.createRoutine({
    agentId: agent.id,
    name: "Kept",
    instruction: "Original instruction",
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  expect(service.nextRoutineDueAt()).not.toBeNull();
  const staleAdmission = mailbox.prepareDelivery([agent.id]);
  await runCauseEffect(service.removeAgentForRecovery(agent.id));
  expect(service.nextRoutineDueAt()).toBeNull();
  expect(service.sidebarChatIds().has(agent.id)).toBe(true);
  expect(() => staleAdmission()).toThrow();
  await expect(runCauseEffect(service.sendMessage({ agentId: agent.id, text: "Do not run" }))).rejects.toThrow();
  await expect(runCauseEffect(service.testRoutine({ agentId: agent.id, routineId: routine.id }))).rejects.toThrow();
  expect(new AgentRoutineStore(store.database).listRuns(agent.id, routine.id)).toEqual([]);
  await runCauseEffect(service.stop());
  const restartedMailbox = new MailboxStore(join(root, "user-data"), store.sharedRoot, store.database);
  service = createTestService({
    store,
    mailbox: restartedMailbox,
    clientFactory: (provider) => new FakeAgentClient(provider),
  });
  await runCauseEffect(service.initialize());
  expect(service.listAgents()).toEqual([]);
  expect(service.nextRoutineDueAt()).toBeNull();
  expect(() => restartedMailbox.prepareDelivery([agent.id])).toThrow();
  vi.setSystemTime(new Date("2026-08-25T11:00:00.000Z"));
  const restored = await runCauseEffect(service.restoreLastDeletedAgent());
  expect(restored?.id).toBe(agent.id);
  expect(restored?.threadId).toBe(store.list()[0]?.threadId);
  expect(service.nextRoutineDueAt()).not.toBeNull();
  expect(service.listRoutines(agent.id)).toEqual([
    {
      ...routine,
      trigger: {
        ...routine.trigger,
        nextRunAt: "2026-08-26T09:00:00.000Z",
        updatedAt: "2026-08-25T11:00:00.000Z",
      },
    },
  ]);
  expect(service.nextRoutineDueAt()).toBe("2026-08-26T09:00:00.000Z");
  expect(new AgentRoutineStore(store.database).listRuns(agent.id, routine.id)).toEqual([]);
  expect(() => restartedMailbox.prepareDelivery([agent.id])).not.toThrow();
});

// Failure modes: delayed starts mutate retained history or revive runtime state; restore
// accepts a released session; cleanup prevents the next valid turn from resuming.
it("ignores delayed provider starts during retention and after idle restore, then resumes valid work", async () => {
  const { store, mailbox } = stores(root);
  const client = new FakeAgentClient("codex");
  service = createTestService({ store, mailbox, preferredProvider: "codex", clientFactory: () => client });
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(store.getOrCreate("chief"));
  await runCauseEffect(service.sendMessage({ agentId: agent.id, text: "Original work" }));
  await waitForQueue(service, agent.id, (queue) =>
    queue.deliveries.every((delivery) => delivery.status === "completed"),
  );
  const session = store.activeProviderSession(agent.id);
  const threadId = store.list().find((candidate) => candidate.id === agent.id)?.threadId;
  if (!session || !threadId) throw new Error("The original provider session did not start.");
  const original = store.database.readConversation(agent.id, threadId);
  const events: AgentEvent[] = [];
  service.on("event", (event) => events.push(event));
  await runCauseEffect(service.removeAgentForRecovery(agent.id));
  expect(client.releasedThreads).toContain(session.externalSessionId);
  const delayedStart = async (turnId: string) => {
    const before = store.database.readConversation(agent.id, threadId);
    expect(before.messages).toEqual(original.messages);
    expect(before.activeTurnId).toBeNull();
    events.length = 0;
    client.emit(
      "notification",
      notification("turn/started", { threadId: session.externalSessionId, turn: { id: turnId } }),
    );
    // Let the notification's fork run before reading its user-visible and durable effects.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      events.filter((event) => ["turn-started", "conversation", "conversation-delta"].includes(event.type)),
    ).toEqual([]);
    expect(store.database.readConversation(agent.id, threadId)).toEqual(before);
    expect(store.database.listProviderSessions(threadId)).toContainEqual(session);
  };
  await delayedStart("late-while-removed");
  expect(service.listAgents()).toEqual([]);
  await expect(runCauseEffect(service.restoreLastDeletedAgent())).resolves.toMatchObject({ id: agent.id });
  await delayedStart("late-after-idle-restore");
  await runCauseEffect(service.sendMessage({ agentId: agent.id, text: "New valid work" }));
  await waitForQueue(service, agent.id, (queue) =>
    queue.deliveries.every((delivery) => delivery.status === "completed"),
  );
  expect(events.some((event) => event.type === "turn-started")).toBe(true);
  expect(store.activeProviderSession(agent.id)).toEqual(session);
  expect(client.requests.some((request) => request.method === "thread/resume")).toBe(true);
  expect(
    store.database.readConversation(agent.id, threadId).messages.some((message) => message.text === "New valid work"),
  ).toBe(true);
  // Neither stale start can leave a phantom active turn that blocks another removal.
  await expect(runCauseEffect(service.removeAgentForRecovery(agent.id))).resolves.toBeUndefined();
});

// Failure modes: the failed permanent-delete finalizer releases the retention owner;
// restore leaves an owner behind; pre-removal admission becomes valid after restore.
it("keeps a retained agent blocked after permanent deletion fails, then releases only its retention owner", async () => {
  const { store, mailbox } = stores(root);
  service = createTestService({ store, mailbox, clientFactory: (provider) => new FakeAgentClient(provider) });
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(store.getOrCreate("chief"));
  const stale = mailbox.prepareDelivery([agent.id]);
  await runCauseEffect(service.removeAgentForRecovery(agent.id));
  const failure = vi.spyOn(store.database, "hardDeleteAgent").mockImplementationOnce(() => {
    throw new Error("Injected database deletion failure");
  });
  await expect(runCauseEffect(service.deleteAgent(agent.id))).rejects.toThrow();
  expect(failure).toHaveBeenCalledOnce();
  failure.mockRestore();
  expect(store.isRetained(agent.id)).toBe(true);
  expect(() => mailbox.prepareDelivery([agent.id])).toThrow();
  await expect(
    runCauseEffect(mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Blocked" })),
  ).rejects.toThrow();
  expect(mailbox.listQueue(agent.id).deliveries).toEqual([]);
  const otherOwner = mailbox.blockAgentDeliveries(agent.id);
  await expect(runCauseEffect(service.restoreLastDeletedAgent())).resolves.toMatchObject({ id: agent.id });
  expect(() => mailbox.prepareDelivery([agent.id])).toThrow();
  otherOwner();
  otherOwner();
  expect(() => stale()).toThrow();
  await runCauseEffect(
    mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Valid new admission" }),
  );
  expect(mailbox.listQueue(agent.id).deliveries).toMatchObject([{ text: "Valid new admission", status: "queued" }]);
});

// Failure modes: delegated enqueue or a request waiting behind it enters during retention,
// or silently becomes new work after restore. Delay the existing mailbox boundary.
it.each([false, true])("rejects a pre-removal messaging admission after its wait (restored: %s)", async (restore) => {
  const { store, mailbox } = stores(root);
  service = createTestService({ store, mailbox, clientFactory: (provider) => new FakeAgentClient(provider) });
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(store.getOrCreate("chief"));
  const connection = service.messaging.store.ensureConnection("slack", "workspace", "Workspace");
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalEnqueue = mailbox.enqueue;
  const enqueue = vi
    .spyOn(mailbox, "enqueue")
    .mockImplementationOnce((input) =>
      Effect.promise(() => barrier).pipe(Effect.flatMap(() => originalEnqueue(input))),
    );
  const prepare = vi.spyOn(mailbox, "prepareDelivery");
  const input = {
    connectionId: connection.connectionId,
    agentId: agent.id,
    platformChannelId: "channel",
    threadKey: "thread",
    isDirect: true,
    title: "Conversation",
    text: "Old work",
    sourcePaths: [],
    origin: { authorId: "author", authorName: "Author", platformMessageId: "first" },
    idempotencyKey: "first",
  };
  const first = runCauseEffect(service.messaging.receive(input));
  const firstRejected = expect(first).rejects.toThrow("The recipient is being deleted.");
  await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
  const second = runCauseEffect(service.messaging.receive({ ...input, idempotencyKey: "second" }));
  const secondRejected = expect(second).rejects.toThrow("The recipient is being deleted.");
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(4));
  await runCauseEffect(service.removeAgentForRecovery(agent.id));
  if (restore) await runCauseEffect(service.restoreLastDeletedAgent());
  release();
  await firstRejected;
  await secondRejected;
  expect(enqueue).toHaveBeenCalledOnce();
  expect(mailbox.listQueue(agent.id).deliveries).toEqual([]);
  enqueue.mockRestore();
  prepare.mockRestore();
});

// Failure modes: restore replays old work, changes unrelated triggers, or loses run-once policy.
it.each(["skip", "run-once"] as const)(
  "applies %s missed policy only to the restored agent before scheduling",
  async (missedPolicy) => {
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox, clientFactory: (provider) => new FakeAgentClient(provider) });
    await runCauseEffect(service.initialize());
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date("2026-08-25T10:00:00.000Z"));
      const routines = new AgentRoutineStore(store.database);
      const active = await runCauseEffect(store.getOrCreate("active"));
      const older = await runCauseEffect(store.getOrCreate("older"));
      const latest = await runCauseEffect(store.getOrCreate("latest"));
      const currentService = service;
      const create = (agentId: string) =>
        currentService.createRoutine({
          agentId,
          name: "Quarter hour",
          instruction: "Check",
          active: true,
          timezone: "UTC",
          missedPolicy,
          schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
        });
      const activeRoutine = create(active.id);
      const olderRoutine = create(older.id);
      const latestRoutine = create(latest.id);
      await runCauseEffect(service.removeAgentForRecovery(older.id));
      await runCauseEffect(service.removeAgentForRecovery(latest.id));
      vi.setSystemTime(new Date("2026-08-25T12:07:00.000Z"));
      await expect(runCauseEffect(service.restoreLastDeletedAgent())).resolves.toMatchObject({ id: latest.id });
      expect(routines.get(active.id, activeRoutine.id)).toEqual(activeRoutine);
      expect(routines.get(older.id, olderRoutine.id)).toEqual(olderRoutine);
      expect(routines.listRuns(active.id, activeRoutine.id, 10, true)).toEqual([]);
      expect(routines.listRuns(older.id, olderRoutine.id, 10, true)).toEqual([]);
      expect(routines.get(latest.id, latestRoutine.id)?.trigger.nextRunAt).toBe(
        missedPolicy === "skip" ? "2026-08-25T12:15:00.000Z" : "2026-08-25T12:00:00.000Z",
      );
      expect(routines.listRuns(latest.id, latestRoutine.id, 10, true)).toEqual([
        expect.objectContaining({
          status: "cancelled",
          missed: {
            count: missedPolicy === "skip" ? 8 : 7,
            until: missedPolicy === "skip" ? "2026-08-25T12:00:00.000Z" : "2026-08-25T11:45:00.000Z",
          },
        }),
      ]);
      expect(service.lastDeletedAgent()?.id).toBe(older.id);
      expect(() => mailbox.prepareDelivery([older.id])).toThrow();
      expect(() => mailbox.prepareDelivery([latest.id])).not.toThrow();
    } finally {
      await runCauseEffect(service.stop());
      vi.useRealTimers();
    }
  },
);

it("keeps the candidate blocked if missed-run reconciliation fails", async () => {
  const { store, mailbox } = stores(root);
  service = createTestService({ store, mailbox, clientFactory: (provider) => new FakeAgentClient(provider) });
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(store.getOrCreate("chief"));
  await runCauseEffect(service.removeAgentForRecovery(agent.id));
  const reconcile = vi.spyOn(RoutineScheduler.prototype, "skipMissedForAgent").mockImplementationOnce(() => {
    throw new Error("injected reconciliation failure");
  });
  try {
    await expect(runCauseEffect(service.restoreLastDeletedAgent())).rejects.toThrow("injected reconciliation failure");
    expect(service.listAgents()).toEqual([]);
    expect(service.lastDeletedAgent()?.id).toBe(agent.id);
    expect(() => mailbox.prepareDelivery([agent.id])).toThrow();
    await expect(runCauseEffect(service.restoreLastDeletedAgent())).resolves.toMatchObject({ id: agent.id });
  } finally {
    reconcile.mockRestore();
  }
});

it("deletes the newest retained agent through the service and keeps the prior candidate recoverable", async () => {
  const { store, mailbox } = stores(root);
  service = createTestService({ store, mailbox, clientFactory: (provider) => new FakeAgentClient(provider) });
  await runCauseEffect(service.initialize());
  const older = await runCauseEffect(store.getOrCreate("older"));
  const latest = await runCauseEffect(store.getOrCreate("latest"));
  await runCauseEffect(service.removeAgentForRecovery(older.id));
  await runCauseEffect(service.removeAgentForRecovery(latest.id));
  await runCauseEffect(service.deleteAgent(latest.id));
  expect(store.retainedAgents()).toEqual([older]);
  expect(service.lastDeletedAgent()?.id).toBe(older.id);
  await expect(runCauseEffect(service.restoreLastDeletedAgent())).resolves.toMatchObject({ id: older.id });
  expect(() => mailbox.prepareDelivery([older.id])).not.toThrow();
});

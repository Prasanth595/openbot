// @vitest-environment node
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createTestService,
  FakeAgentClient,
  inputRecords,
  notification,
  openBotToolPayload,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { runCauseEffect } from "./effect-boundary";
import { type AppServerNotification, getRecord, getString } from "./protocol";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

const REQUEST = "Tell me when the nightly build is green, then ship the release.";
const NOTE = "Wait for the nightly build; ship the release when it is green.";

describe("open waits", () => {
  // Failure modes: a routine run does not wake the wait; the run's input loses the request or the
  // note after the context is gone; close_wait leaves the wait open in the chat list.
  it("opens a wait in a user turn, continues it in the next routine run, and closes it", async () => {
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    const toolResults: ReturnType<typeof openBotToolPayload>[] = [];
    let turns = 0;
    let waitId = "";
    const answer = async (client: FakeAgentClient, threadId: string, turnId: string) => {
      turns += 1;
      await waitFor(() => mailbox.findDeliveriesByTurn(agent.id, turnId).length > 0);
      const { result } =
        turns === 1
          ? await callOpenBotTool(client, threadId, "await_event", { note: NOTE }, turnId)
          : await callOpenBotTool(client, threadId, "close_wait", { waitId }, turnId);
      const payload = openBotToolPayload(result);
      toolResults.push(payload);
      if (turns === 1) waitId = String(payload.waitId);
      client.emit(
        "notification",
        notification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } }),
      );
    };
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider, "Done.", false);
        client.on("notification", (event: AppServerNotification) => {
          const threadId = getString(event.params, "threadId");
          const turnId = getString(getRecord(event.params, "turn"), "id");
          if (event.method === "turn/started" && threadId && turnId) void answer(client, threadId, turnId);
        });
        clients.push(client);
        return client;
      },
    });
    const events: AgentEvent[] = [];
    service.on("event", (event: AgentEvent) => events.push(event));
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(store.getOrCreate("watch"));
    const routine = service.createRoutine({
      agentId: agent.id,
      name: "Nightly build",
      instruction: "Check the nightly build.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const running = service;

    await runCauseEffect(running.sendMessage({ agentId: agent.id, text: REQUEST }));
    await waitFor(() => running.listWaits(agent.id).waits.length === 1);
    const [wait] = running.listWaits(agent.id).waits;
    expect(wait).toMatchObject({ id: waitId, note: NOTE, requestText: REQUEST, routineId: null });
    await waitFor(() => events.some((event) => event.type === "turn-completed" && event.agentId === agent.id));

    await runCauseEffect(running.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor(() => toolResults.length === 2);
    expect(toolResults[1]).toEqual({ closed: waitId });
    expect(running.listWaits(agent.id).waits).toEqual([]);

    const prompt = clients
      .flatMap((client) => client.requests)
      .filter((request) => request.method === "turn/start")
      .map((request) =>
        inputRecords(request.params)
          .map((record) => getString(record, "text") ?? "")
          .join("\n"),
      )
      .at(-1);
    expect(prompt).toContain(`Wait ID: ${waitId}`);
    expect(prompt).toContain(`Your note: ${NOTE}`);
    expect(prompt).toContain(REQUEST);
    expect(
      events.filter((event) => event.type === "waits-changed").map((event) => event.snapshot.waits.length),
    ).toEqual([1, 1, 0]);
  });
});

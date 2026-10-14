// @vitest-environment node

// An agent keeps its workspace and thread when its provider account is removed: it moves to the
// provider's own sign-in, and no agent names an account whose folder is gone.

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderAccountStore } from "./agent/provider-account-store";
import type { AgentService } from "./agent-service";
import {
  CREATE_AGENT_INPUT,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
} from "./agent-service-test-harness";
import { runCauseEffect } from "./effect-boundary";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe("AgentService: provider accounts", () => {
  it("moves the agents of a removed account to the provider's own sign-in", async () => {
    const accounts = new ProviderAccountStore(join(root, "provider-accounts.json"), join(root, "accounts"));
    await runCauseEffect(accounts.load());
    const removed = await runCauseEffect(accounts.create("codex"));
    const kept = await runCauseEffect(accounts.create("codex"));
    if (!removed) throw new Error("The provider has too many accounts.");
    const started = await startService(root, { provider: "codex", providerAccounts: accounts });
    service = started.service;
    const { initialMessage: _initialMessage, ...profile } = CREATE_AGENT_INPUT;
    const created = await runCauseEffect(started.service.createAgentProfile(profile));
    const agent = () => started.service.listAgents().find((candidate) => candidate.id === created.id);

    await runCauseEffect(started.service.updateAgent({ agentId: created.id, providerAccountId: removed.id }));
    expect(agent()?.providerAccountId).toBe(removed.id);

    await runCauseEffect(started.service.removeProviderAccount("codex", removed.id));
    expect(agent()?.providerAccountId).toBeUndefined();
    expect(agent()?.workspacePath).toBe(created.workspacePath);
    expect(accounts.list("codex")).toEqual([kept]);
    expect(started.store.list().find((candidate) => candidate.id === created.id)?.providerAccountId).toBeUndefined();
  });
});

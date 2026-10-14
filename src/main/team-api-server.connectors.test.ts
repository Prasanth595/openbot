// @vitest-environment node

// The orchestrator route of `connectors-v1`. A Slack or Discord request names its workspace; only a
// Telegram request makes the Telegram Orchestrator, which answers every chat.

import { CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamApiFixture, stopTeamApiFixtures, type TeamApiOptions } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const unused = (): never => {
  throw new Error("Not used by this test.");
};

function createConnectors(): NonNullable<TeamApiOptions["connectors"]> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    github: {
      status: unused,
      pages: unused,
      connect: unused,
      cancel: unused,
      disconnect: unused,
      repositories: unused,
    },
    messaging: {
      slackOverview: unused,
      discordOverview: unused,
      telegramOverview: unused,
      connectSlackWorkspace: unused,
      connectDiscordGuild: unused,
      connectTelegramChat: unused,
      completeSlackWorkspace: unused,
      completeDiscordGuild: unused,
      disconnectSlackWorkspace: unused,
      disconnectDiscordGuild: unused,
      disconnectTelegramChat: unused,
      reconnect: unused,
      setEnabled: unused,
      addOrchestrator: (platform, input) =>
        Effect.sync(() => {
          calls.push(`${platform}:${input.workspaceId}`);
          return { agentId: `${platform}-orchestrator`, sectionId: null };
        }),
      addTelegramOrchestrator: () =>
        Effect.sync(() => {
          calls.push("telegram");
          return { agentId: "telegram-orchestrator", sectionId: null };
        }),
    },
  };
}

describe("Team API connectors orchestrator", () => {
  it("makes the Telegram Orchestrator only for Telegram", async () => {
    const connectors = createConnectors();
    const fixture = await createTeamApiFixture("connectors-orchestrator", { configure: true });
    const { base } = await fixture.start({ connectors });
    const headers = {
      Authorization: `Bearer ${await fixture.signIn()}`,
      "OpenBot-Protocol-Version": "7",
      "OpenBot-Capabilities": "connectors-v1",
      "Content-Type": "application/json",
    };
    const add = (body: unknown) =>
      fetch(`${base}${CONNECTORS_ROUTES.messagingOrchestrator}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

    expect((await add({ platform: "slack", workspaceId: null })).status).toBe(400);
    expect((await add({ platform: "discord", workspaceId: null })).status).toBe(400);
    expect(await (await add({ platform: "slack", workspaceId: "T1" })).json()).toEqual({
      agentId: "slack-orchestrator",
      sectionId: null,
    });
    expect((await add({ platform: "telegram", workspaceId: null })).status).toBe(200);
    expect(connectors.calls).toEqual(["slack:T1", "telegram"]);
  });
});

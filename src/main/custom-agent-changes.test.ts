// @vitest-environment node

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { checkAcpAgent } from "../backend/acp-agent-check";
import { runCauseEffect } from "../backend/effect-boundary";
import { createCustomAgentChanges } from "./custom-agent-changes";

const LAUNCH_PATH = "/opt/homebrew/bin:/usr/bin";

function unused(): never {
  throw new Error("The check must not call this.");
}

function changes(checkEnv: Record<string, string>, launchPath: string | null = LAUNCH_PATH) {
  const check = vi.fn<typeof checkAcpAgent>(() =>
    Effect.succeed({ agentName: "Goose", version: null, protocolVersion: 1, capabilities: [] }),
  );
  const instance = createCustomAgentChanges({
    // The check reads neither the service nor the saved list.
    service: { saveCustomAgent: unused, removeCustomAgent: unused, reloadCustomAgents: unused },
    customAgents: { list: unused, save: unused, remove: unused, assertWritable: unused, checkEnv: () => checkEnv },
    resolve: () => Effect.succeed("/bin/goose"),
    check,
    launchPath: () => Effect.succeed(launchPath),
  });
  return { check, instance };
}

describe("CustomAgentChanges.check", () => {
  it("starts the agent with the PATH that its command was looked up in", async () => {
    const { check, instance } = changes({ TOKEN: "abcd" });
    await runCauseEffect(instance.check({ command: "goose", args: [], env: [] }));
    expect(check).toHaveBeenCalledExactlyOnceWith({
      executable: "/bin/goose",
      args: [],
      env: { PATH: LAUNCH_PATH, TOKEN: "abcd" },
    });
  });

  it("lets a PATH that the user saved on the agent win", async () => {
    const { check, instance } = changes({ PATH: "/mine" });
    await runCauseEffect(instance.check({ command: "goose", args: [], env: [] }));
    expect(check.mock.calls[0]?.[0].env).toEqual({ PATH: "/mine" });
  });

  it("adds no PATH where there is none to add", async () => {
    const { check, instance } = changes({}, null);
    await runCauseEffect(instance.check({ command: "goose", args: [], env: [] }));
    expect(check.mock.calls[0]?.[0].env).toEqual({});
  });
});

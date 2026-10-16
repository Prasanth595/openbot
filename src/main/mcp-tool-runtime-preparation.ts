import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { type McpToolRuntimes, needsManagedRuntime } from "../backend/mcp-provider-shapes";
import type { ProviderRuntimeManager } from "./provider-runtime-manager";

/** How long a connection test waits for the managed runtimes before probing without them. */
export const TOOL_RUNTIME_TEST_WAIT_MS = 60_000;

/**
 * The managed tool runtimes as the MCP writers reach them. The IPC handlers and the host's Team
 * API routes share this shape: the routes call `AgentService` directly and would otherwise bypass
 * every preparation below, leaving a host with no Node unable to save or test its first server.
 */
export interface McpToolRuntimePreparation {
  startToolRuntimes: () => void;
  ensureToolRuntimesReady: OmitThisParameter<ProviderRuntimeManager["ensureToolRuntimesReady"]>;
  toolRuntimes: () => McpToolRuntimes;
}

/**
 * What a connection test waits for: nothing for http and installed commands, the bounded
 * download for a command nothing names. Shared by the local Test button and the host route that
 * answers a remote Test.
 */
export const prepareToolRuntimeForTest = Effect.fn("Mcp.prepareToolRuntimeForTest")(function* (
  config: McpServerConfig,
  preparation: McpToolRuntimePreparation,
) {
  if (yield* needsManagedRuntime(config, preparation.toolRuntimes())) {
    yield* preparation.ensureToolRuntimesReady().pipe(
      Effect.timeout(TOOL_RUNTIME_TEST_WAIT_MS),
      Effect.catch(() => Effect.void),
    );
  }
});

import { createServer } from "node:http";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { loopbackCallback } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { agentPrintedLink, PRINTED_LINK_AGE_MS, SIGN_IN_RELAY_TTL_MS, SignInRelayHost } from "./sign-in-relay-host";
import { HttpError } from "./team-api/http-error";

const PAGE = "https://auth.example.com/authorize?state=state-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A28417%2Fmcp-auth";

function config(): McpServerConfig {
  return {
    id: "",
    name: "Signed in",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.example.com/mcp",
    headers: [],
  };
}

function setup() {
  let now = 1_000;
  const cancel = vi.fn();
  const receiveMcpGrant = vi.fn((_state: string, _code: string) => true);
  const host = new SignInRelayHost({
    mcp: { startRelay: () => Effect.void, relayStatus: () => ({ pageUrl: PAGE, result: null }), cancel },
    providers: {
      startRelay: () => Effect.void,
      relayStatus: () => ({ pageUrl: null, result: null }),
      cancel: () => Effect.void,
    },
    receiveMcpGrant,
    printedLink: () => false,
    now: () => now,
  });
  const start = (memberId = "admin") => Effect.runPromise(host.startMcp(memberId, { config: config() }));
  return { host, cancel, receiveMcpGrant, start, advance: (ms: number) => (now += ms) };
}

async function refusal(run: () => Effect.Effect<unknown, { readonly cause: unknown }>): Promise<number> {
  try {
    await runCauseEffect(run());
  } catch (error) {
    if (error instanceof HttpError) return error.status;
    throw error;
  }
  throw new Error("The call was not refused.");
}

describe("SignInRelayHost", () => {
  it("delivers a callback once, and masks its code in every later log line", async () => {
    const { host, receiveMcpGrant, start } = setup();
    const { flowId } = await start();

    await Effect.runPromise(host.complete("admin", flowId, "code=grant-code-123456&state=state-1"));

    expect(receiveMcpGrant).toHaveBeenCalledWith("state-1", "grant-code-123456");
    expect(redactText("code grant-code-123456")).not.toContain("grant-code-123456");
    expect(await refusal(() => host.complete("admin", flowId, "code=grant-code-123456&state=state-1"))).toBe(409);
  });

  it("answers another member as it answers an unknown flow", async () => {
    const { host, receiveMcpGrant, start } = setup();
    const { flowId } = await start("admin");

    expect(await refusal(() => Effect.sync(() => host.status("other", flowId)))).toBe(404);
    expect(await refusal(() => host.complete("other", flowId, "code=c&state=state-1"))).toBe(404);
    expect(await refusal(() => Effect.sync(() => host.status("admin", "unknown")))).toBe(404);
    expect(receiveMcpGrant).not.toHaveBeenCalled();
  });

  it("refuses a callback for another sign-in", async () => {
    const { host, receiveMcpGrant, start } = setup();
    const { flowId } = await start();

    expect(await refusal(() => host.complete("admin", flowId, "code=c&state=state-2"))).toBe(400);
    expect(receiveMcpGrant).not.toHaveBeenCalled();
  });

  it("ends an expired flow and stops its sign-in", async () => {
    const { host, cancel, start, advance } = setup();
    const { flowId } = await start();

    advance(SIGN_IN_RELAY_TTL_MS);

    expect(await refusal(() => host.complete("admin", flowId, "code=c&state=state-1"))).toBe(404);
    expect(cancel).toHaveBeenCalledWith("https://mcp.example.com/mcp");
  });

  it("ends the sign-in when the user refused on the page, with no delivery", async () => {
    const { host, cancel, receiveMcpGrant, start } = setup();
    const { flowId } = await start();

    await Effect.runPromise(host.complete("admin", flowId, "error=access_denied&state=state-1"));

    expect(cancel).toHaveBeenCalled();
    expect(receiveMcpGrant).not.toHaveBeenCalled();
  });
});

describe("SignInRelayHost.startReplay", () => {
  it("sends the callback only to the listener that its own page or its agent's message names", async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(request.url ?? "");
      response.writeHead(302, { location: "https://example.com/done" }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const page = `https://auth.example.com/authorize?state=s1&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/callback`)}`;
    const host = new SignInRelayHost({
      mcp: { startRelay: () => Effect.void, relayStatus: () => ({ pageUrl: null, result: null }), cancel: vi.fn() },
      providers: {
        startRelay: () => Effect.void,
        relayStatus: () => ({ pageUrl: null, result: null }),
        cancel: () => Effect.void,
      },
      receiveMcpGrant: () => false,
      printedLink: (agentId, url) => agentId === "agent-1" && url === page,
    });
    try {
      const { flowId } = host.startReplay("admin", {
        key: "provider\ncodex",
        status: () => ({ pageUrl: page, result: null }),
        cancel: vi.fn(),
      });

      await Effect.runPromise(host.complete("admin", flowId, "code=grant-code-123456&state=s1"));

      expect(received).toEqual(["/callback?code=grant-code-123456&state=s1"]);

      expect(() => host.startLink("admin", "agent-2", page)).toThrow(HttpError);
      const link = host.startLink("admin", "agent-1", page);
      await Effect.runPromise(host.complete("admin", link.flowId, "code=link-code-123456&state=s1"));
      expect(host.status("admin", link.flowId).result).toEqual({ toolCount: 0, error: null });
      const refused = host.startLink("admin", "agent-1", page);
      await Effect.runPromise(host.complete("admin", refused.flowId, "error=access_denied&state=s1"));
      expect(host.status("admin", refused.flowId).result?.error).not.toBeNull();
      expect(received).toEqual([
        "/callback?code=grant-code-123456&state=s1",
        "/callback?code=link-code-123456&state=s1",
        "/callback?error=access_denied&state=s1",
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("agentPrintedLink", () => {
  it("accepts only a whole link from a recent agent message", () => {
    const now = Date.parse("2026-10-12T12:00:00.000Z");
    const link = "https://auth.example.com/authorize?state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcb";
    const message = (text: string, author: "agent" | "user" = "agent", age = 0) => ({
      id: "m",
      author,
      text,
      createdAt: new Date(now - age).toISOString(),
      status: "completed" as const,
    });

    expect(agentPrintedLink([message(`Open [the page](${link}).`)], link, now)).toBe(true);
    expect(agentPrintedLink([message(`Open ${link}&scope=all`)], link, now)).toBe(false);
    expect(agentPrintedLink([message(link, "user")], link, now)).toBe(false);
    expect(agentPrintedLink([message(link, "agent", PRINTED_LINK_AGE_MS + 1)], link, now)).toBe(false);
  });
});

describe("loopbackCallback", () => {
  it("names only a loopback callback, so a client cannot choose another address", () => {
    expect(loopbackCallback(PAGE)).toEqual({ port: 28417, path: "/mcp-auth", state: "state-1" });
    expect(
      loopbackCallback("https://auth.example.com/authorize?redirect_uri=http%3A%2F%2F10.0.0.2%3A80%2Fcb"),
    ).toBeNull();
    expect(loopbackCallback("https://auth.example.com/authorize?redirect_uri=openbot%3A%2F%2Fmcp-auth")).toBeNull();
  });
});

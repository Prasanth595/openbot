import { createServer } from "node:net";
import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { SignInRelayClient, type SignInRelayRemote } from "./sign-in-relay-client";
import { SignInRelayHost } from "./sign-in-relay-host";

const STATE = "state-1";
const CODE = "grant-code-123456";

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

/** Binds `port` (0: any free port) on loopback, closes it, and answers the port. */
function freePort(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** A real host and a real client, joined by direct calls in place of the encrypted Team channel. */
function setup(
  port: number,
  options: {
    ownListener?: boolean;
    state?: string | null;
    browser: (client: SignInRelayClient) => Promise<void>;
  },
) {
  const granted: string[] = [];
  const opened: string[] = [];
  let result: McpTestResult | null = null;
  const state = options.state === undefined ? STATE : options.state;
  const page = `https://auth.example.com/authorize?${state ? `state=${state}&` : ""}redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/cb`)}`;
  const host = new SignInRelayHost({
    mcp: {
      startRelay: () => Effect.void,
      relayStatus: () => ({ pageUrl: result ? null : page, result }),
      cancel: () => {
        result = { toolCount: 0, error: "stopped" };
      },
    },
    providers: {
      startRelay: () => Effect.void,
      relayStatus: () => ({ pageUrl: null, result: null }),
      cancel: () => Effect.void,
    },
    printedLink: () => false,
    receiveMcpGrant: (_state, code) => {
      granted.push(code);
      result = { toolCount: 3, error: null };
      return true;
    },
  });
  const remote: SignInRelayRemote<unknown> = {
    start: host.startMcp("admin", { config: config() }),
    status: (flowId) => Effect.try(() => host.status("admin", flowId)),
    complete: (flowId, query) => host.complete("admin", flowId, query),
    cancel: (flowId) => Effect.try(() => host.cancel("admin", flowId)),
  };
  const client: SignInRelayClient = new SignInRelayClient({
    openExternal: (url) => {
      opened.push(url);
      return options.browser(client);
    },
    language: { locale: "en", translate: translateFor("en") },
    ownListener: () => (options.ownListener ? { port, path: "/cb" } : null),
  });
  return {
    granted,
    opened,
    client,
    page,
    run: (chosenPage: string | null = null) =>
      Effect.runPromise(
        client.run("key", remote, chosenPage === null ? null : { page: chosenPage, onWaiting: () => undefined }),
      ),
    /** The user reads the page's host name in the dialog, then asks to open it. */
    runAndOpen: async () => {
      const done = Effect.runPromise(client.run("key", remote));
      await vi.waitFor(() => expect(client.page("key")?.authorizeHost).toBe("auth.example.com"));
      expect(opened).toEqual([]);
      await client.open("key");
      return done;
    },
  };
}

describe("SignInRelayClient", () => {
  it("takes the callback on the host's port, refuses another sign-in's, and frees the port", async () => {
    const port = await freePort();
    const statuses: number[] = [];
    const { granted, runAndOpen } = setup(port, {
      browser: async () => {
        for (const state of ["other", STATE]) {
          const response = await fetch(`http://127.0.0.1:${port}/cb?code=${CODE}&state=${state}`);
          statuses.push(response.status);
        }
      },
    });

    expect(await runAndOpen()).toEqual({ toolCount: 3, error: null });
    expect(statuses).toEqual([400, 200]);
    expect(granted).toEqual([CODE]);
    await expect(freePort(port)).resolves.toBe(port);
  });

  it("sends a pasted address when its own listener has the port", async () => {
    const port = await freePort();
    const { granted, runAndOpen } = setup(port, {
      ownListener: true,
      browser: async (client) => {
        expect(() => client.paste("key", "https://example.com/?code=x&state=other")).toThrow();
        client.paste("key", `http://127.0.0.1:${port}/cb?code=${CODE}&state=${STATE}`);
      },
    });

    expect(await runAndOpen()).toEqual({ toolCount: 3, error: null });
    expect(granted).toEqual([CODE]);
  });

  it("opens a page that the user chose only when the host names that page", async () => {
    const port = await freePort();
    const refused = setup(port, { browser: async () => undefined });

    expect(await refused.run("https://auth.example.com/authorize?state=other")).toEqual({
      toolCount: 0,
      error: sourceText("error.team.signInRelayLinkUnknown"),
    });
    expect(refused.opened).toEqual([]);

    const chosen = setup(port, {
      browser: async () => {
        await fetch(`http://127.0.0.1:${port}/cb?code=${CODE}&state=${STATE}`);
      },
    });
    expect(await chosen.run(chosen.page)).toEqual({ toolCount: 3, error: null });
    expect(chosen.opened).toEqual([new URL(chosen.page).toString()]);
  });

  it("refuses a page with no state, so its listener cannot hand on another sign-in's callback", async () => {
    const port = await freePort();
    const { granted, opened, run } = setup(port, { state: null, browser: async () => undefined });

    expect(await run()).toEqual({ toolCount: 0, error: sourceText("error.mcp.relayNoState") });
    expect(opened).toEqual([]);
    expect(granted).toEqual([]);
  });
});

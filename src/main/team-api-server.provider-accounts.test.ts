// @vitest-environment node

// The accounts after the first are on `provider-accounts-v1` only. A released client reads one usage
// limit for each provider, so the released usage route and `usage-changed` keep the provider's own
// sign-in. The new routes manage sign-ins and credentials of this host: `requireAdmin` is their gate.

import { EventEmitter } from "node:events";
import type { AccountUsage } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { optionalRouteCodec } from "@openbot/contracts/team-protocol/optional-routes";
import { PROVIDER_ACCOUNTS_ROUTES } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgents,
  createTeamApiFixture,
  jsonRequest,
  nextJsonEvent,
  stopTeamApiFixtures,
  type TeamApiOptions,
} from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const EXTRA = "a0123456789abcdef";
const WINDOW = { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_786_563_600 };
const USAGE: AccountUsage = {
  limits: [
    { id: "codex", primary: WINDOW, secondary: null },
    { id: "codex", accountId: EXTRA, primary: { ...WINDOW, usedPercent: 90 }, secondary: null },
  ],
};

function createAccounts(): NonNullable<TeamApiOptions["providerAccounts"]> & { calls: string[] } {
  const calls: string[] = [];
  const record = (call: string) => Effect.sync(() => void calls.push(call));
  return {
    calls,
    list: () => ({
      providers: [
        {
          provider: "codex",
          accounts: [
            { id: "default", label: null, email: "me@example.com", state: "connected", message: null },
            { id: EXTRA, label: "Work", email: "work@example.com", state: "connected", message: null },
          ],
        },
      ],
      agents: [{ agentId: "agent-1", accountId: EXTRA }],
    }),
    usage: () => Effect.succeed({ limits: USAGE.limits.filter((limit) => limit.accountId !== undefined) }),
    startSignIn: (provider, accountId) => record(`start:${provider}:${accountId}`),
    signInStatus: () => ({ tabId: null, result: null }),
    cancelSignIn: (provider) => record(`cancel:${provider}`),
    rename: (provider, accountId) => record(`rename:${provider}:${accountId}`),
    remove: (provider, accountId) => record(`remove:${provider}:${accountId}`),
    setAgentAccount: (agentId, accountId) => record(`agent:${agentId}:${accountId}`),
  };
}

const REMOVE_BODY = { provider: "codex", accountId: EXTRA };
/** A valid body for each route, so that only the member check can refuse it. */
const REQUESTS = [
  [PROVIDER_ACCOUNTS_ROUTES.list, {}],
  [PROVIDER_ACCOUNTS_ROUTES.usage, {}],
  [PROVIDER_ACCOUNTS_ROUTES.signInStart, { provider: "codex", accountId: null }],
  [PROVIDER_ACCOUNTS_ROUTES.signInStatus, { provider: "codex" }],
  [PROVIDER_ACCOUNTS_ROUTES.signInCancel, { provider: "codex" }],
  [PROVIDER_ACCOUNTS_ROUTES.rename, { provider: "codex", accountId: EXTRA, label: "Work" }],
  [PROVIDER_ACCOUNTS_ROUTES.remove, REMOVE_BODY],
  [PROVIDER_ACCOUNTS_ROUTES.agent, { agentId: "agent-1", accountId: null }],
] as const;

describe("Team API provider-accounts-v1", () => {
  it("answers only an admin that negotiated the capability", async () => {
    const accounts = createAccounts();
    const fixture = await createTeamApiFixture("provider-accounts", { configure: true });
    const { base } = await fixture.start({ providerAccounts: accounts });
    const token = await fixture.signIn();
    const post = (route: string, body: unknown, extra: Record<string, string> = {}) =>
      fetch(`${base}${route}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "OpenBot-Protocol-Version": "7",
          "OpenBot-Capabilities": "provider-accounts-v1",
          "Content-Type": "application/json",
          ...extra,
        },
        body: JSON.stringify(body),
      });

    expect((await post(PROVIDER_ACCOUNTS_ROUTES.list, {}, { "OpenBot-Capabilities": "" })).status).toBe(400);

    const invite = await Effect.runPromise(fixture.store.createInvite("member"));
    const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "member", "member password"));
    for (const [route, body] of REQUESTS)
      expect((await post(route, body, { Authorization: `Bearer ${member.sessionToken}` })).status).toBe(403);
    expect(accounts.calls).toEqual([]);

    const list = await post(PROVIDER_ACCOUNTS_ROUTES.list, {});
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(optionalRouteCodec(PROVIDER_ACCOUNTS_ROUTES.list)?.response(200, body)).toEqual(accounts.list());

    // An account id is a folder name on this host: one that is not an id never reaches the host.
    expect((await post(PROVIDER_ACCOUNTS_ROUTES.remove, { provider: "codex", accountId: "../codex" })).status).toBe(
      400,
    );
    expect((await post(PROVIDER_ACCOUNTS_ROUTES.remove, REMOVE_BODY)).status).toBe(200);
    expect(accounts.calls).toEqual([`remove:codex:${EXTRA}`]);

    const compatibility = await (
      await fetch(`${base}/v1/compatibility`, { headers: { "OpenBot-Protocol-Version": "7" } })
    ).json();
    expect(compatibility.capabilities).toContain("provider-accounts-v1");
  });

  it("sends a released client the provider's own usage only, on the route and in usage-changed", async () => {
    const events = new EventEmitter();
    const fixture = await createTeamApiFixture("provider-accounts-usage", { configure: true });
    const { base, port } = await fixture.start({
      agents: createAgents({ getUsage: () => Effect.succeed(USAGE) }, events),
    });
    const token = await fixture.signIn();

    const usage = await jsonRequest<AccountUsage>(base, TEAM_API_ROUTES.agents.usage, { token });
    expect(usage.limits).toEqual([USAGE.limits[0]]);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, ["openbot-team-v1", `openbot-token.${token}`]);
    const presence = nextJsonEvent(socket);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
    await presence;
    socket.send(JSON.stringify({ type: "agent-event-scope", includeConversations: true, capabilities: [] }));
    // The scope message has no reply; a known event shows that the scope applied.
    const routines = nextJsonEvent(socket);
    events.emit("event", { type: "routines-changed", agentId: "agent-1" });
    await routines;
    const changed = new Promise<unknown>((resolve) =>
      socket.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), { once: true }),
    );
    events.emit("event", { type: "usage-changed", usage: USAGE });
    await expect(changed).resolves.toEqual({ type: "usage-changed", usage: { limits: [USAGE.limits[0]] } });
    socket.close();
  });
});

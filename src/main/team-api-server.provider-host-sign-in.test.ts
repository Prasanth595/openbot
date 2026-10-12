// @vitest-environment node

// Who may make this host sign in a provider on a page in its own browser, and what leaves the host.
// A started sign-in opens a private tab that the administrator drives through the live view, so
// `requireAdmin` is the whole gate. The page's link stays on the host: a reply carries the tab only.

import { PROVIDER_HOST_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamApiFixture, stopTeamApiFixtures, type TeamApiOptions } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

function createSignIns(): NonNullable<TeamApiOptions["providerHostSignIns"]> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: (provider) => Effect.sync(() => void calls.push(`start:${provider}`)),
    status: () => ({ tabId: "tab-1", result: null }),
    cancel: (provider) => Effect.sync(() => void calls.push(`cancel:${provider}`)),
  };
}

describe("Team API provider host sign-in", () => {
  it("answers only an admin that negotiated the capability, and sends no link", async () => {
    const signIns = createSignIns();
    const fixture = await createTeamApiFixture("provider-host-sign-in", { configure: true });
    const { base } = await fixture.start({ providerHostSignIns: signIns });
    const token = await fixture.signIn();
    const headers = {
      Authorization: `Bearer ${token}`,
      "OpenBot-Protocol-Version": "7",
      "OpenBot-Capabilities": "provider-host-sign-in-v1",
      "Content-Type": "application/json",
    };
    const post = (route: string, body: unknown, extra: Record<string, string> = {}) =>
      fetch(`${base}${route}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });

    expect(
      (await post(PROVIDER_HOST_SIGN_IN_ROUTES.start, { provider: "antigravity" }, { "OpenBot-Capabilities": "" }))
        .status,
    ).toBe(400);

    const invite = await Effect.runPromise(fixture.store.createInvite("member"));
    const member = await Effect.runPromise(fixture.store.acceptInvite(invite.token, "member", "member password"));
    const asMember = { Authorization: `Bearer ${member.sessionToken}` };
    for (const route of Object.values(PROVIDER_HOST_SIGN_IN_ROUTES))
      expect((await post(route, { provider: "antigravity" }, asMember)).status).toBe(403);
    expect(signIns.calls).toEqual([]);

    // Only the providers that the capability names: the others sign in with a code.
    expect((await post(PROVIDER_HOST_SIGN_IN_ROUTES.start, { provider: "codex" })).status).toBe(400);

    expect((await post(PROVIDER_HOST_SIGN_IN_ROUTES.start, { provider: "antigravity" })).status).toBe(200);
    const status = await post(PROVIDER_HOST_SIGN_IN_ROUTES.status, { provider: "antigravity" });
    expect(await status.json()).toEqual({ tabId: "tab-1", result: null });
    expect((await post(PROVIDER_HOST_SIGN_IN_ROUTES.cancel, { provider: "antigravity" })).status).toBe(200);
    expect(signIns.calls).toEqual(["start:antigravity", "cancel:antigravity"]);

    const compatibility = await (
      await fetch(`${base}/v1/compatibility`, { headers: { "OpenBot-Protocol-Version": "7" } })
    ).json();
    expect(compatibility.capabilities).toContain("provider-host-sign-in-v1");
  });
});

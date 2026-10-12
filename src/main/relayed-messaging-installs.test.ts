import { CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type RelayedInstallsRemote, RelayedMessagingInstalls } from "./relayed-messaging-installs";

// Failure modes: an `openbot://` link that this computer did not start sends a grant to a server; a
// Slack grant goes to a Discord install; one grant goes to the server twice.
describe("RelayedMessagingInstalls", () => {
  it("sends a grant only to the server whose install this computer opened, once", async () => {
    const sent: unknown[] = [];
    const remote: RelayedInstallsRemote = {
      request: (serverId, path, decoder, init) => {
        sent.push({ serverId, path, body: init?.body });
        return Effect.sync(() => decoder({ accepted: true }));
      },
    };
    const installs = new RelayedMessagingInstalls(remote);

    await expect(installs.forward("slack", "unknown", "grant")).resolves.toBe(false);
    installs.remember("discord", "nonce-1", "server-1");
    await expect(installs.forward("slack", "nonce-1", "grant")).resolves.toBe(false);
    expect(sent).toEqual([]);

    await expect(installs.forward("discord", "nonce-1", "grant")).resolves.toBe(true);
    await expect(installs.forward("discord", "nonce-1", "grant")).resolves.toBe(false);
    expect(sent).toEqual([
      {
        serverId: "server-1",
        path: CONNECTORS_ROUTES.messagingComplete,
        body: { platform: "discord", nonce: "nonce-1", grant: "grant" },
      },
    ]);
  });
});

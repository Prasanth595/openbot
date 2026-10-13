import type { ServerSummary } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { type ProviderConnectPlace, providerConnectRoute } from "./provider-connect-route";

function server(capabilities: string[]): ServerSummary {
  return {
    id: "host",
    name: "Host",
    kind: "remote",
    state: "online",
    role: "admin",
    active: true,
    apiUrl: null,
    remoteDesktopAvailable: false,
    logoUrl: null,
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    compatibility: {
      localAppVersion: "1.0.0",
      hostAppVersion: "1.0.0",
      localProtocol: { minimum: 1, maximum: 6 },
      hostProtocol: { minimum: 1, maximum: 6 },
      negotiatedProtocol: 6,
      capabilities,
    },
  };
}

const CURRENT = ["providers-v1", "providers-v3", "providers-v4", "sign-in-relay-v1"];
const app = (capabilities: string[]): ProviderConnectPlace => ({ kind: "app-server", server: server(capabilities) });
const web = (capabilities: string[]): ProviderConnectPlace => ({ kind: "web-server", server: server(capabilities) });

// A wrong route sends the sign-in to a computer that cannot finish it, or offers the same way twice.
describe("providerConnectRoute", () => {
  it("connects through the relay from the app, and offers the host's code in the menu", () => {
    expect(providerConnectRoute("codex", app(CURRENT))).toEqual({ connect: "relay", alternative: "code" });
    expect(providerConnectRoute("claude", app(CURRENT))).toEqual({ connect: "relay", alternative: "code" });
    expect(providerConnectRoute("grok", app(CURRENT))).toEqual({ connect: "code", alternative: null });
  });

  it("gives an older server only the code its descriptor allows", () => {
    expect(providerConnectRoute("codex", app(["providers-v1"]))).toEqual({ connect: "code", alternative: null });
    expect(providerConnectRoute("claude", app(["providers-v1"]))).toEqual({ connect: null, alternative: null });
    expect(providerConnectRoute("grok", app(["providers-v1"]))).toEqual({ connect: null, alternative: null });
  });

  it("uses the code in a browser tab, and the app when the host cannot take a pasted code", () => {
    expect(providerConnectRoute("claude", web(CURRENT))).toEqual({ connect: "code", alternative: "relay" });
    expect(providerConnectRoute("codex", web(CURRENT))).toEqual({ connect: "code", alternative: "relay" });
    const noPaste = CURRENT.filter((capability) => capability !== "providers-v3");
    expect(providerConnectRoute("claude", web(noPaste))).toEqual({ connect: "use-app", alternative: "relay" });
  });

  it("relays a device page in a browser tab, and shows the host's page before sending the user to the app", () => {
    expect(providerConnectRoute("muse", web(CURRENT))).toEqual({ connect: "relay", alternative: null });
    const hostPage = [...CURRENT, "provider-host-sign-in-v1", "browser-view"];
    expect(providerConnectRoute("antigravity", web(hostPage))).toEqual({ connect: "host-page", alternative: "relay" });
    expect(providerConnectRoute("antigravity", web(CURRENT))).toEqual({ connect: "use-app", alternative: "relay" });
  });

  it("signs in on this computer in its browser, with Claude's pasted code on Linux only", () => {
    expect(providerConnectRoute("codex", { kind: "computer", platform: "darwin" })).toEqual({
      connect: "browser",
      alternative: "code",
    });
    expect(providerConnectRoute("claude", { kind: "computer", platform: "darwin" })).toEqual({
      connect: "browser",
      alternative: null,
    });
    expect(providerConnectRoute("claude", { kind: "computer", platform: "linux" })).toEqual({
      connect: "browser",
      alternative: "code",
    });
  });
});

import type { ServerSummary } from "@openbot/contracts/ipc";
import { CONNECTOR_IDS } from "@openbot/ui/features/connectors/connectors";
import { describe, expect, it } from "vitest";
import { connectorAccess } from "./connector-access";

const remote: ServerSummary = {
  id: "host",
  name: "Host",
  kind: "remote",
  state: "online",
  role: "member",
  active: true,
  apiUrl: null,
  remoteDesktopAvailable: false,
  logoUrl: null,
  notificationsMuted: false,
  notificationsMutedUntil: null,
  notificationLevel: "all",
};

function host(role: ServerSummary["role"], capabilities: string[]): ServerSummary {
  return {
    ...remote,
    role,
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

const access = (server: ServerSummary | undefined) =>
  Object.fromEntries(CONNECTOR_IDS.map((id) => [id, connectorAccess(id, server)]));

describe("connector access", () => {
  it("shows each connector only where it can work", () => {
    expect(access({ ...remote, kind: "local", role: "owner" })).toEqual({
      slack: "available",
      discord: "available",
      telegram: "available",
      github: "available",
      onepassword: "available",
      bitwarden: "available",
    });
    expect(access(host("admin", ["connectors-v1"]))).toEqual({
      slack: "available",
      discord: "available",
      telegram: "available",
      github: "available",
      onepassword: "local-only",
      bitwarden: "local-only",
    });
    const none = {
      slack: "hidden",
      discord: "hidden",
      telegram: "hidden",
      github: "hidden",
      onepassword: "local-only",
      bitwarden: "local-only",
    };
    expect(access(host("owner", []))).toEqual(none);
    expect(access(host("member", ["connectors-v1"]))).toEqual(none);
    expect(Object.values(access(undefined))).toEqual(CONNECTOR_IDS.map(() => "hidden"));
  });
});

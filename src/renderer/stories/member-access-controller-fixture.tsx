import {
  isTeamPresenceSnapshot,
  type ServerSummary,
  type TeamPresenceSnapshot,
  type UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { createSignal, flush, onSettled } from "solid-js";
import { ServerSettingsProvider, useServerSettings } from "../src/features/servers/server-settings";
import { ServersProvider, useServers } from "../src/features/servers/servers-context";
import { createWebServerSettings } from "../src/features/web-client/web-server-settings";
import { STORY_HOST_STATUS, STORY_SERVERS } from "../src/preview/fixtures";
import { createMockOpenBot } from "./mock-openbot";

function localServerFixture(): ServerSummary {
  const server = STORY_SERVERS.find((candidate) => candidate.kind === "local");
  if (!server) throw new Error("The controller fixture needs the local server fixture.");
  return server;
}

const server = localServerFixture();

/** Used only by member-access-e2e.ts. All membership writes reach the real loopback Team API. */
export function MemberAccessControllerFixture() {
  const origin = new URLSearchParams(window.location.search).get("fixtureOrigin");
  if (!origin) return <p>This service fixture needs the member access E2E runner.</p>;
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/") {
    throw new Error("The member access fixture must use its local loopback server.");
  }
  const mock = createMockOpenBot({ servers: [server], hostStatus: STORY_HOST_STATUS });
  const previous = window.openbot;
  window.openbot = mock.api;
  onSettled(() => () => {
    mock.dispose();
    window.openbot = previous;
  });
  async function request(path: string, body?: UpdateTeamMemberInput | { fail: boolean }): Promise<Response> {
    const response = await fetch(`${url.origin}${path}`, {
      ...(body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
    });
    if (!response.ok) throw new Error("The fixture roster read or membership change was refused.");
    return response;
  }
  async function presence(path: string, body?: UpdateTeamMemberInput): Promise<TeamPresenceSnapshot> {
    const value = await (await request(path, body)).json();
    if (!isTeamPresenceSnapshot(value)) throw new Error("The fixture returned invalid member data.");
    return value;
  }
  mock.api.host.getPresence = () => presence("/fixture/presence");
  mock.api.host.listMembers = async () => (await presence("/fixture/members")).members;
  mock.api.host.listInvites = async () => [];
  mock.api.host.updateMember = async (input) => {
    const snapshot = await presence("/fixture/member", input);
    const saved = snapshot.members.find((member) => member.id === input.memberId);
    if (!saved) throw new Error("The saved fixture member is missing.");
    return saved;
  };
  return (
    <ServersProvider>
      <ServerSettingsProvider>
        <ControllerCommands request={request} />
      </ServerSettingsProvider>
    </ServersProvider>
  );
}

function ControllerCommands(props: { request: (path: string, body?: { fail: boolean }) => Promise<Response> }) {
  const servers = useServers();
  const desktop = useServerSettings();
  const web = createWebServerSettings({
    server: () => server,
    admin: () => ({
      team: window.openbot.host,
      request: () => {
        throw new Error("The fixture must use only member requests.");
      },
    }),
    presence: () => null,
    refreshHosts: async () => undefined,
    relaySupported: () => false,
  });
  const [receipt, setReceipt] = createSignal("idle");
  const [busy, setBusy] = createSignal(false);

  async function run(
    surface: "desktop" | "web",
    operation: "disable" | "restore" | "retry" | "refused",
  ): Promise<void> {
    if (busy()) return;
    setBusy(true);
    setReceipt("pending");
    try {
      await servers.initialServersReady;
      if (operation !== "retry") {
        if (surface === "desktop") {
          desktop.openServerSettings(server.id, null, "members");
          flush();
          await desktop.refreshServerSettings(server.id);
        } else await web.refresh();
      }
      const readMembers = () => (surface === "desktop" ? desktop.serverSettingsMembers() : web.state.members);
      const before = readMembers().find((member) => member.role === "admin");
      if (!before) throw new Error("The controller target is missing.");
      let refused = false;
      if (operation === "retry") {
        if (surface === "desktop") await desktop.refreshServerSettings(server.id);
        else await web.refresh();
      } else {
        await props.request("/fixture/read-failure", { fail: operation !== "refused" });
        try {
          const input = { memberId: before.id, disabled: operation === "disable" };
          if (surface === "desktop") await desktop.updateServerMember(input);
          else await web.updateMember(input);
        } catch (error) {
          if (operation !== "refused") throw error;
          refused = true;
        }
      }
      flush();
      const after = readMembers().find((member) => member.id === before.id);
      const error = surface === "desktop" ? desktop.serverSettingsError() : web.state.error;
      setReceipt(
        JSON.stringify({
          surface,
          operation,
          memberId: after?.id,
          disabled: after?.disabled,
          loadError: error !== null,
          refused,
        }),
      );
    } catch (error) {
      setReceipt(JSON.stringify({ failure: error instanceof Error ? error.message : "Controller fixture failed." }));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button disabled={busy()} onClick={() => void run("desktop", "disable")}>
        Desktop disable
      </Button>
      <Button disabled={busy()} onClick={() => void run("desktop", "restore")}>
        Desktop restore
      </Button>
      <Button disabled={busy()} onClick={() => void run("desktop", "retry")}>
        Desktop read retry
      </Button>
      <Button disabled={busy()} onClick={() => void run("desktop", "refused")}>
        Desktop refused restore
      </Button>
      <Button disabled={busy()} onClick={() => void run("web", "disable")}>
        Web disable
      </Button>
      <Button disabled={busy()} onClick={() => void run("web", "restore")}>
        Web restore
      </Button>
      <Button disabled={busy()} onClick={() => void run("web", "retry")}>
        Web read retry
      </Button>
      <Button disabled={busy()} onClick={() => void run("web", "refused")}>
        Web refused restore
      </Button>
      <output aria-label="Member access controller receipt">{receipt()}</output>
    </>
  );
}

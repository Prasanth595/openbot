import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentMcpGrants, AgentMcpTool, AgentMcpSettings as Settings } from "@openbot/contracts/ipc";
import { Button, Text } from "@openbot/ui";
import { SettingsPanel, SettingsPanelContent } from "@openbot/ui/components/SettingsPanel";
import { AgentMcpSettings, type AgentMcpSettingsApi } from "@openbot/ui/features/conversation/AgentMcpSettings";
import { createStore } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

function api(grants: AgentMcpGrants, servers?: Settings["servers"]): AgentMcpSettingsApi {
  let snapshot: Settings = {
    agentId: "example",
    grants,
    servers: servers ?? [
      { id: "mail", name: "Mail", enabled: true },
      { id: "calendar", name: "Calendar", enabled: false },
    ],
  };
  return {
    read: async () => structuredClone(snapshot),
    set: async (input) => {
      snapshot = { ...snapshot, grants: structuredClone(input.grants) };
      return structuredClone(snapshot);
    },
    tools: async ({ query = "" }) =>
      [
        { name: "read_inbox", description: "Read inbox messages." },
        { name: "send_mail", description: "Send a message." },
      ].filter((tool) => tool.name.toLowerCase().includes(query.toLowerCase())),
  };
}
const meta = {
  title: "Settings/Agent MCP",
  component: AgentMcpSettings,
  args: { agentId: "example", api: api(null) },
  render: (args) => (
    <main class="agent-memories-story-stage">
      <SettingsPanel
        id="agent-mcp-story"
        label="MCP permissions"
        width={296}
        maxWidth={() => 640}
        onResize={() => {}}
        onResizeEnd={() => {}}
      >
        <SettingsPanelContent>
          <AgentMcpSettings {...args} />
        </SettingsPanelContent>
      </SettingsPanel>
    </main>
  ),
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AgentMcpSettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FollowServerSettings: Story = {};
export const ReadOnlyTools: Story = { args: { api: api([{ mcpServerId: "mail", tools: ["read_inbox"] }]) } };
export const NoMcpServers: Story = { args: { api: api([]) } };
export const UnavailableSavedTool: Story = { args: { api: api([{ mcpServerId: "mail", tools: ["old_mail_tool"] }]) } };
export const LongNames: Story = {
  args: {
    api: api(
      [{ mcpServerId: "mail", tools: ["t".repeat(256)] }],
      [{ id: "mail", name: "m".repeat(INPUT_LIMITS.mcpServerName), enabled: true }],
    ),
  },
};

function SlowDiscoveryRegistry() {
  const [state, setState] = createStore({ reads: 0 });
  let snapshot: Settings = {
    agentId: "example",
    grants: [{ mcpServerId: "mail", tools: ["read_inbox"] }],
    servers: [{ id: "mail", name: "Mail", enabled: true }],
  };
  const listeners = new Set<() => void>();
  let finish: (() => void) | undefined;
  let fail: (() => void) | undefined;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const slowApi: AgentMcpSettingsApi = {
    read: async () => {
      setState((s) => {
        s.reads++;
      });
      return structuredClone(snapshot);
    },
    set: async (input) => {
      snapshot = { ...snapshot, grants: structuredClone(input.grants) };
      notify();
      return structuredClone(snapshot);
    },
    tools: ({ query = "" }) =>
      new Promise<AgentMcpTool[]>((resolve, reject) => {
        finish = () => {
          finish = undefined;
          fail = undefined;
          resolve(
            [
              { name: "read_inbox", description: "Read inbox messages." },
              { name: "send_mail", description: "Send a message." },
            ].filter((tool) => tool.name.toLowerCase().includes(query.toLowerCase())),
          );
        };
        fail = () => {
          finish = undefined;
          fail = undefined;
          reject(new Error("Synthetic discovery failure."));
        };
      }),
    subscribe: (_agentId, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const replaceServer = (id: string, server?: Settings["servers"][number]) => {
    snapshot = { ...snapshot, servers: snapshot.servers.filter((item) => item.id !== id) };
    if (server) snapshot.servers.push(server);
    notify();
  };
  return (
    <main class="agent-memories-story-stage">
      <SettingsPanel
        id="agent-mcp-slow-story"
        label="MCP permissions"
        width={296}
        maxWidth={() => 640}
        onResize={() => {}}
        onResizeEnd={() => {}}
      >
        <SettingsPanelContent>
          <Text>Settings reads: {state.reads}</Text>
          <Button variant="ghost" onClick={() => replaceServer("mail")}>
            Remove Mail
          </Button>
          <Button variant="ghost" onClick={() => replaceServer("wiki", { id: "wiki", name: "Wiki", enabled: true })}>
            Add Wiki
          </Button>
          <Button variant="ghost" onClick={() => replaceServer("mail", { id: "mail", name: "Mail", enabled: true })}>
            Restore Mail
          </Button>
          <Button variant="ghost" onClick={() => finish?.()}>
            Finish discovery
          </Button>
          <Button variant="ghost" onClick={() => fail?.()}>
            Fail discovery
          </Button>
          <AgentMcpSettings agentId="example" api={slowApi} />
        </SettingsPanelContent>
      </SettingsPanel>
    </main>
  );
}
export const RegistryChangesDuringDiscovery: Story = { render: () => <SlowDiscoveryRegistry /> };

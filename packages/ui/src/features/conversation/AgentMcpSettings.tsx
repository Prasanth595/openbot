import {
  AGENT_MCP_LIMITS,
  type AgentMcpGrants,
  type AgentMcpTool,
  type ListAgentMcpToolsInput,
  type SetAgentMcpGrantsInput,
  type AgentMcpSettings as Settings,
} from "@openbot/contracts/ipc";
import { Button, Input, Switch, Text } from "@openbot/ui";
import { SettingsField, SettingsLinkGroup } from "@openbot/ui/components/SettingsPanel";
import { createEffect, createStore, For, Show, untrack } from "solid-js";
import { useText } from "../../text";

export interface AgentMcpSettingsApi {
  read(agentId: string): Promise<Settings>;
  set(input: SetAgentMcpGrantsInput): Promise<Settings>;
  tools(input: ListAgentMcpToolsInput): Promise<AgentMcpTool[]>;
  subscribe?(agentId: string, listener: () => void): () => void;
}

/** The host owns grants. Each write returns the saved set, so another agent's setup cannot overwrite it. */
export function AgentMcpSettings(props: { agentId: string; api: AgentMcpSettingsApi }) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    data: Settings | null;
    busy: boolean;
    error: string | null;
    tools: Record<string, AgentMcpTool[]>;
    search: Record<string, string>;
  }>({ data: null, busy: false, error: null, tools: {}, search: {} });
  let generation = 0;
  let sequence = 0;
  let reload: (() => void) | undefined;
  let reloadPending = false;
  createEffect(
    () => {
      const api = props.api;
      return { agentId: props.agentId, readSettings: api.read.bind(api), subscribe: api.subscribe?.bind(api) };
    },
    ({ agentId, readSettings, subscribe }) => {
      const current = ++generation;
      reloadPending = false;
      setState(() => ({ data: null, busy: false, error: null, tools: {}, search: {} }));
      const read = async () => {
        const latest = ++sequence;
        try {
          const data = await readSettings(agentId);
          if (generation === current && sequence === latest)
            setState((s) => {
              s.data = data;
              s.error = null;
            });
        } catch (error) {
          if (generation === current && sequence === latest)
            setState((s) => {
              s.error = errorMessage(error, t("agentSettings.mcp.readFailed"));
            });
        }
      };
      const requestRead = () => {
        if (generation !== current) return;
        if (untrack(() => state.busy)) {
          reloadPending = true;
          return;
        }
        reloadPending = false;
        void read();
      };
      reload = () => {
        if (generation === current) void read();
      };
      void read();
      const stop = subscribe?.(agentId, requestRead);
      return () => {
        generation++;
        reload = undefined;
        reloadPending = false;
        stop?.();
      };
    },
  );

  function finishOperation(current: number) {
    if (generation !== current) return;
    setState((s) => {
      s.busy = false;
    });
    if (reloadPending) {
      reloadPending = false;
      // Solid batches the busy write. This operation is finished, so flush the queued read
      // directly instead of sampling the still-committed busy value in the notification gate.
      reload?.();
    }
  }

  async function save(grants: AgentMcpGrants) {
    if (state.busy) return;
    const current = generation;
    ++sequence;
    setState((s) => {
      s.busy = true;
      s.error = null;
    });
    try {
      const data = await props.api.set({ agentId: props.agentId, grants });
      if (generation === current)
        setState((s) => {
          s.data = data;
        });
    } catch (error) {
      if (generation === current)
        setState((s) => {
          s.error = errorMessage(error, t("agentSettings.saveFailed"));
        });
    } finally {
      finishOperation(current);
    }
  }
  async function loadTools(mcpServerId: string) {
    if (state.busy) return;
    const current = generation;
    setState((s) => {
      s.busy = true;
      s.error = null;
    });
    try {
      const tools = await props.api.tools({
        agentId: props.agentId,
        mcpServerId,
        query: state.search[mcpServerId] ?? "",
      });
      if (generation === current)
        setState((s) => {
          s.tools[mcpServerId] = tools;
        });
    } catch (error) {
      if (generation === current)
        setState((s) => {
          s.error = errorMessage(error, t("agentSettings.mcp.toolsFailed"));
        });
    } finally {
      finishOperation(current);
    }
  }
  const grantFor = (id: string) => state.data?.grants?.find((grant) => grant.mcpServerId === id);
  const setServer = (id: string, enabled: boolean) => {
    const grants = state.data?.grants;
    if (!grants) return;
    void save(
      enabled ? [...grants, { mcpServerId: id, tools: null }] : grants.filter((grant) => grant.mcpServerId !== id),
    );
  };
  const setTools = (id: string, tools: string[] | null) => {
    const grants = state.data?.grants;
    if (!grants) return;
    void save(grants.map((grant) => (grant.mcpServerId === id ? { ...grant, tools } : grant)));
  };
  const names = (id: string) =>
    [...new Set([...(state.tools[id]?.map((tool) => tool.name) ?? []), ...(grantFor(id)?.tools ?? [])])].filter(
      (name) => name.toLowerCase().includes((state.search[id] ?? "").toLowerCase()),
    );
  return (
    <SettingsLinkGroup title={t("agentSettings.mcp.title")}>
      <Show when={state.error}>
        {(message) => (
          <>
            <Text role="alert">{message()}</Text>
            <Button variant="ghost" disabled={state.busy} onClick={() => reload?.()}>
              {t("common.retry")}
            </Button>
          </>
        )}
      </Show>
      <Show when={state.data}>
        {(data) => (
          <>
            <SettingsField label={t("agentSettings.mcp.inherit")}>
              <Switch
                checked={data().grants === null}
                disabled={state.busy}
                aria-label={t("agentSettings.mcp.inherit")}
                onChange={(inherit) =>
                  void save(
                    inherit
                      ? null
                      : data()
                          .servers.filter((server) => server.enabled)
                          .map((server) => ({ mcpServerId: server.id, tools: null })),
                  )
                }
              />
            </SettingsField>
            <Text tone="muted">{t("agentSettings.mcp.inheritDescription")}</Text>
            <Text tone="muted">{t("agentSettings.mcp.scopeDescription")}</Text>
            <Show when={data().grants !== null}>
              <Text tone="muted">{t("agentSettings.mcp.restrictedNote")}</Text>
            </Show>
            <For each={data().servers}>
              {(server) => (
                <div>
                  <SettingsField
                    label={
                      <Text tone="secondary" style={{ "overflow-wrap": "anywhere" }}>
                        {server.name}
                      </Text>
                    }
                  >
                    <Switch
                      checked={data().grants === null || grantFor(server.id) !== undefined}
                      disabled={state.busy || data().grants === null}
                      aria-label={server.name}
                      onChange={(enabled) => setServer(server.id, enabled)}
                    />
                  </SettingsField>
                  <Show when={!server.enabled}>
                    <Text tone="muted">{t("agentSettings.mcp.hostDisabled")}</Text>
                  </Show>
                  <Show when={data().grants !== null && grantFor(server.id)}>
                    <SettingsField label={t("agentSettings.mcp.allTools")}>
                      <Switch
                        checked={grantFor(server.id)?.tools === null}
                        disabled={state.busy}
                        aria-label={t("agentSettings.mcp.allTools")}
                        onChange={(all) => setTools(server.id, all ? null : [])}
                      />
                    </SettingsField>
                    <Show when={grantFor(server.id)?.tools !== null}>
                      <Button
                        variant="ghost"
                        disabled={state.busy || !server.enabled}
                        onClick={() => void loadTools(server.id)}
                      >
                        {t("agentSettings.mcp.loadTools")}
                      </Button>
                      <Input
                        value={state.search[server.id] ?? ""}
                        placeholder={t("agentSettings.mcp.searchTools")}
                        maxlength={AGENT_MCP_LIMITS.queryChars}
                        aria-label={t("agentSettings.mcp.searchTools")}
                        onInput={(event) =>
                          setState((s) => {
                            s.search[server.id] = event.currentTarget.value;
                          })
                        }
                      />
                      <Show when={names(server.id).length > 100}>
                        <Text tone="muted">{t("agentSettings.mcp.searchMore")}</Text>
                      </Show>
                      <For each={names(server.id).slice(0, 100)}>
                        {(name) => (
                          <div>
                            <SettingsField
                              label={
                                <Text tone="secondary" style={{ "overflow-wrap": "anywhere" }}>
                                  {name}
                                </Text>
                              }
                            >
                              <Switch
                                checked={grantFor(server.id)?.tools?.includes(name) ?? false}
                                disabled={state.busy}
                                aria-label={name}
                                onChange={(enabled) => {
                                  const tools = grantFor(server.id)?.tools ?? [];
                                  setTools(
                                    server.id,
                                    enabled ? [...tools, name] : tools.filter((tool) => tool !== name),
                                  );
                                }}
                              />
                            </SettingsField>
                            <Text tone="muted">
                              {state.tools[server.id]?.find((tool) => tool.name === name)?.description}
                            </Text>
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </>
        )}
      </Show>
    </SettingsLinkGroup>
  );
}

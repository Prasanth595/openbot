import type { ServerSummary } from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { resolveCreationModel } from "../agents/agent-creation-model";
import { useAgents } from "../agents/agents-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useSetup } from "../onboarding/onboarding-context";
import { remoteAdminServer } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSidebar } from "../sidebar/sidebar-context";
import {
  type ConnectorRegistry,
  createConnectorRegistry,
  createConnectorSet,
  LOCAL_CONNECTOR_TRANSPORTS,
} from "./connector-registry";
import { githubConnectorPort, hostGitHubConnectorPort } from "./github-connector-port";
import { hostMessagingApi } from "./host-messaging-port";
import { localMessagingApi, type MessagingConnectorOptions } from "./messaging-connector";

const context = createSimpleContext({
  name: "ConnectorsProvider",
  init: () => {
    const { activeServer } = useServers();
    const { serverSettingsTarget } = useServerSettings();
    const { agentList, agentStatus, modelOptions, serverSetupChoice } = useAgents();
    const { setupState } = useSetup();
    const endpoints = useCustomProviders();
    const localAgents = useCustomAgents();
    const { collapseSidebarSection } = useSidebar();
    // The Slack, Discord and Telegram Orchestrators of this computer run here, so their pickers list
    // this computer's models: none while a joined server is on screen, and then they start on a new
    // agent's default.
    const models = () => {
      const options = modelOptions();
      if (activeServer()?.kind !== "local" || options.length === 0) return undefined;
      return {
        modelOptions: options,
        agentStatus: agentStatus(),
        initial: resolveCreationModel(serverSetupChoice() ?? setupState(), options),
        customProviders: endpoints.customProviders(),
        customAgents: localAgents.customAgents(),
      };
    };
    const computer = createConnectorSet(
      { github: githubConnectorPort, ...LOCAL_CONNECTOR_TRANSPORTS, messaging: localMessagingApi() },
      {
        agents: agentList,
        models,
        // The Integrations section starts collapsed: the orchestrator is not an agent people chat
        // with every day. The collapse belongs to the local server, the one on screen when it connects.
        onOrchestratorSection: (sectionId) => {
          if (activeServer()?.kind === "local") collapseSidebarSection(sectionId);
        },
      },
    );
    /**
     * The connectors of the joined server that `server` names, which an owner or admin manages from
     * here. Their pages open in this computer's browser; main sends the result on to the host. The
     * host's orchestrators start on its default provider and model.
     */
    const registry = (server: () => ServerSummary | undefined): ConnectorRegistry => {
      const target = createMemo(() => remoteAdminServer(server(), "connectors-v1"));
      const options: MessagingConnectorOptions = {
        agents: agentList,
        hostName: () => target()?.name,
        serverId: () => target()?.id,
      };
      const github = hostGitHubConnectorPort(() => target()?.id);
      const host = createConnectorSet(
        { github: () => github, messaging: hostMessagingApi(() => target()?.id) },
        options,
      );
      return createConnectorRegistry(server, { computer, server: host });
    };
    return {
      /** The connectors of the server on screen: the Marketplace and the chat cards. */
      active: registry(activeServer),
      /** The connectors of the server whose settings are open, which can be another one. */
      settings: registry(serverSettingsTarget),
    };
  },
});
export const ConnectorsProvider = context.provider;
export const useConnectors = context.use;

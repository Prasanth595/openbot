import { foreignProvider, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentModelId,
  type AgentProviderRef,
  type AgentReasoningEffort,
  providerDisplayName,
} from "@openbot/contracts/ipc";
import { isAgentTaskActive } from "@openbot/team-client/agent-tasks";
import { reasoningLabel } from "@openbot/ui/components/ProviderModelPicker";
import { ConversationHeader as SharedConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { useConversationViewScope } from "./conversation-scope";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { useText } from "@openbot/ui/text";

/** @internal Stable HMR boundary for conversation header. */
export function ConversationHeader() {
  const { t } = useText();
  const {
    actingBrowserControl,
    agentActivity,
    browserControlAgent,
    changeFastMode,
    channel,
    fastMode,
    props,
    runningTurnRuntime,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    setActiveRightPanel,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    sidePanelOpen,
    toggleSidePanel,
  } = useConversationViewScope();
  const runningTasks = () => props.tasks?.snapshot?.tasks.filter(isAgentTaskActive).length ?? 0;
  const working = () => agentActivity() === "Working";
  const providerName = (provider: AgentProviderRef) =>
    isKnownAgentProvider(provider) ? providerDisplayName(provider) : String(provider);
  /** The effort shows only where it differs. A provider change names the provider too. */
  const runtimeLabel = (
    provider: AgentProviderRef,
    model: AgentModelId,
    effort: AgentReasoningEffort,
    otherProvider: AgentProviderRef,
    otherEffort: AgentReasoningEffort,
  ) => {
    const name =
      props.modelOptions.find((option) => option.provider === provider && option.id === model)?.name ?? model;
    const modelPart = effort === otherEffort ? name : `${name} · ${reasoningLabel(effort, t)}`;
    return provider === otherProvider ? modelPart : `${providerName(provider)} · ${modelPart}`;
  };
  const pendingModel = () => {
    const agent = props.agent;
    if (!agent) return undefined;
    const queued = agent.pendingRuntime;
    if (queued) {
      return {
        running: runtimeLabel(
          agent.provider,
          agent.model,
          agent.reasoningEffort,
          queued.provider,
          queued.reasoningEffort,
        ),
        next: runtimeLabel(
          queued.provider,
          queued.model,
          queued.reasoningEffort,
          agent.provider,
          agent.reasoningEffort,
        ),
      };
    }
    const running = runningTurnRuntime();
    if (!working() || !running) return undefined;
    const model = settingsModel();
    const effort = settingsReasoning();
    const provider = settingsProvider();
    if (provider === running.provider && model === running.model && effort === running.reasoningEffort)
      return undefined;
    return {
      running: runtimeLabel(running.provider, running.model, running.reasoningEffort, provider, effort),
      next: runtimeLabel(provider, model, effort, running.provider, running.reasoningEffort),
    };
  };
  return (
    <SharedConversationHeader
      agent={props.agent}
      title={channel ? <channel.HeaderTitle onOpenSettings={() => setActiveRightPanel("settings")} /> : undefined}
      onSettingsIntent={() => void loadAgentSettingsPanel()}
      onOpenSettings={() => setActiveRightPanel("settings")}
      pendingModel={pendingModel()}
      modelPicker={{
        provider: settingsProvider(),
        foreignProvider: props.agent ? foreignProvider(props.agent.provider) : undefined,
        value: settingsModel(),
        reasoningEffort: settingsReasoning(),
        modelOptions: props.modelOptions,
        agentStatus: props.agentStatus,
        runtimeStatuses: props.providerRuntimeStatuses,
        customProviders: props.customProviders,
        customAgents: props.customAgents,
        onDownloadProvider: props.onDownloadProvider,
        onCancelProviderDownload: props.onCancelProviderDownload,
        onConnectProvider: props.onConnectProvider,
        canConnectProvider: props.canConnectProvider,
        onManageProviders: props.onManageProviders,
        // A model, effort, provider or account chosen during a turn applies from the next turn.
        disabledReason: t("conversation.header.modelsUnavailable"),
        accountChoice: true,
        providerAccountId: props.agent?.pendingRuntime?.providerAccountId ?? props.agent?.providerAccountId,
        onChange: (model, provider, accountId) => void selectAndConfirmModel(model, provider, accountId),
        onReasoningEffortChange: (effort) => void selectAndConfirmReasoning(effort),
        // Codex only for now, and only on this computer: the Team API does not carry fast mode.
        fastMode: fastMode(),
        onFastModeChange:
          settingsProvider() === "codex" && props.server?.kind === "local"
            ? (next) => void changeFastMode(next)
            : undefined,
      }}
      remoteControl={
        props.remoteDesktopEnabled !== false && props.server?.kind === "remote"
          ? {
              enabled: Boolean(props.remoteDesktopSessionActive || props.server.state === "online"),
              active: Boolean(props.remoteDesktopSessionActive),
              visible: Boolean(props.remoteDesktopVisible),
              onOpen: (trigger) => {
                if (props.server) void props.onOpenRemoteDesktop(props.server.id, trigger);
              },
            }
          : undefined
      }
      sidePanel={
        channel?.readOnly()
          ? undefined
          : {
              open: sidePanelOpen(),
              actingAgentName: actingBrowserControl()
                ? (browserControlAgent()?.name ?? t("conversation.header.agentFallback"))
                : undefined,
              running: runningTasks(),
              onToggle: toggleSidePanel,
            }
      }
    />
  );
}

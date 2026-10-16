import { classifyFailure } from "@openbot/telemetry";
import { isAgentTaskActive } from "@openbot/ui/features/conversation/AgentTasks";
import { ConversationHeader as SharedConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { useConversationViewScope } from "./conversation-scope";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { actionToast } from "../../action-toast";

/** @internal Stable HMR boundary for conversation header. */
export function ConversationHeader() {
  const { t, errorMessage } = useText();
  const {
    actingBrowserControl,
    agentActivity,
    browserControlAgent,
    props,
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
  const changeAutoApprove = createMemo(() => {
    const save = props.onSetAgentAutoApprove;
    const name = props.agent?.name ?? t("conversation.header.thisAgent");
    if (!save) return undefined;
    return (next: boolean) => {
      void save(next).catch((error) => {
        actionToast.error(
          next
            ? errorMessage(error, t("conversation.header.grantFailed", { name }))
            : t("settings.autoApprove.revokeFailed", { name }),
          { report: { operation: "turn", source: "action", cause_code: classifyFailure(error) } },
        );
      });
    };
  });
  return (
    <SharedConversationHeader
      agent={props.agent}
      onSettingsIntent={() => void loadAgentSettingsPanel()}
      onOpenSettings={() => setActiveRightPanel("settings")}
      modelPicker={{
        provider: settingsProvider(),
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
        modelChangesDisabled: agentActivity() === "Working",
        disabledReason:
          agentActivity() === "Working"
            ? t("conversation.header.modelsBusy")
            : t("conversation.header.modelsUnavailable"),
        accountChoice: true,
        providerAccountId: props.agent?.providerAccountId,
        onChange: (model, provider, accountId) => void selectAndConfirmModel(model, provider, accountId),
        onReasoningEffortChange: (effort) => void selectAndConfirmReasoning(effort),
        autoApprove: props.agentAutoApproves,
        agentName: props.agent?.name,
        autoApproveLocked: props.agentAutoApproveLocked,
        onAutoApproveChange: changeAutoApprove(),
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
      sidePanel={{
        open: sidePanelOpen(),
        actingAgentName: actingBrowserControl()
          ? (browserControlAgent()?.name ?? t("conversation.header.agentFallback"))
          : undefined,
        running: runningTasks(),
        onToggle: toggleSidePanel,
      }}
    />
  );
}

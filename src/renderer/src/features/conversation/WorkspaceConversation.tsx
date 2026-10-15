import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import {
  type AgentModelChoice,
  type CentralAuthUser,
  sameAgentModelChoice,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { Button, hasVisibleToasts } from "@openbot/ui";
import { AgentConversationsDialog } from "@openbot/ui/features/conversation/AgentConversationsDialog";
import {
  type BackupModelSource,
  rememberedBackupModels,
  type UsageLimitAskCardProps,
  usageLimitAskOptions,
} from "@openbot/ui/features/conversation/BackupModels";
import { unloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, Show } from "solid-js";
import { ProviderSignInDialogs } from "../../components/ProviderSignInDialogs";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { createScopeGuard } from "../../scope-lifetime";
import { useTurns } from "../../turns";
import { turnsPort } from "../../turns-port";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { withHostAccountUsage } from "../agents/host-provider-accounts";
import { createRemoteAgentAdmin, updateRemoteAgent } from "../agents/remote-agent-admin";
import { useBrowserTabs } from "../browser/browser-context";
import { useConnectors } from "../connectors/connectors-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServerScope } from "../servers/server-scope";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
import { useUsage } from "../usage/usage-context";
import { agentConversationRuntime } from "./agent-conversation-runtime";
import { createAgentConversationsController } from "./agent-conversations-controller";
import { agentConversationsPort } from "./agent-conversations-port";
import { Conversation } from "./Conversation";
import { useConversation } from "./conversation-context";
import { useConversationController } from "./conversation-controller-context";
import { desktopConversationRuntime } from "./conversation-runtime";
import type { ConversationProps, ConversationTarget } from "./conversation-types";

/**
 * The transcript of the active Agent, with everything the composer needs to send
 * to it. The widest pane by props because `Conversation` is where the browser,
 * the queue, prompts, approvals and search all surface, and each of those is a
 * domain of its own.
 *
 * Everything here is a projection of the active Agent, so the whole component
 * reads `activeAgent()` and hands `Conversation` the slice for that id. It stays
 * mounted across an Agent change on purpose - `Conversation` owns the scroll and
 * composer state that survives one - which is why the id is read per prop
 * rather than captured once.
 */

export function WorkspaceConversation(props: { account: () => CentralAuthUser }) {
  const scopeIsCurrent = createScopeGuard();
  const serverScope = useServerScope();
  const platform = usePlatform();
  const connectors = useConnectors();
  const { activeServer, activeServerSupportsCapability, joinServerOpen } = useServers();
  const { serverSettingsOpen, openServerSettings } = useServerSettings();
  const {
    appSettingsOpen,
    skillsMarketplaceOpen,
    setSkillsMarketplaceOpen,
    setPendingPluginSlug,
    setPendingPluginConnect,
    setAgentAutoApprove,
    agentAutoApproves,
    generalSettings,
  } = useSettings();
  const {
    providerRuntimeStatuses,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
    providerAdminServerId,
    connection,
  } = useProviders();
  /**
   * The composer's sign-ins: Connect, and the code from the ⋯ menu. The dialog shows here only while
   * this surface started it: Settings shows its own for the sign-ins it starts.
   */
  const connectFromComposer = (provider: AgentProviderId) => connection.connect(provider, "composer");
  const signInWithCode = (provider: AgentProviderId) => connection.alternative(provider, "composer");
  // Not gated on the server: the picker needs these IDs to label a model it is already showing, and
  // a remote server's OpenCode has its own catalogue. Only the write paths are local-only.
  const { customProviders } = useCustomProviders();
  const { customAgents } = useCustomAgents();
  const {
    agentStatus,
    hostAccountLimits,
    agentList,
    agentListConnecting,
    activeAgent,
    modelOptions,
    settingsRequest,
    updateAgent,
    setAgentAvatar,
  } = useAgents();
  const {
    contextStates,
    activeQueue,
    activeWaits,
    activeRoutineIds,
    activeRoutines,
    pendingPrompts,
    pendingApprovals,
    activeTurns,
    turnProgress,
    answerPrompt,
    respondToApproval,
    respondToApprovalRequest,
    respondToBrowserTakeover,
    cancelQueuedMessage,
    cancelWait,
    steerQueuedMessage,
    updateQueuedMessage,
    reorderQueue,
    stopActiveTurn,
    usageLimits,
    usageLimitedModels,
    waitedUsageLimits,
    setWaitedUsageLimits,
    queues,
  } = useTurns();
  const {
    activeMessages,
    conversations,
    sendMessage,
    markAgentMessagesRead,
    loadOlderAgentMessages,
    loadLatestAgentMessages,
    searchAgentMessages,
    setTeamTyping,
    presentPromptResolution,
  } = useConversation();
  const {
    browserTabs,
    activeBrowserTabId,
    browserVisibilitySuspended,
    browserControlState,
    activateBrowserTab,
    closeBrowserTab,
  } = useBrowserTabs();
  const { activeRemoteDesktopSession, remoteDesktopWorkspaceVisible, openRemoteDesktopWorkspace } = useRemoteDesktop();
  const usage = useUsage();
  // The composer never asks for usage itself. It reads the dock's reading, which is scoped to the
  // active agent's provider and model and cleared on a switch, because a second request would hit
  // the provider's rate-limit endpoint for a card the user may never see.
  const auth = useAuth();
  const { teamPresence, currentTeamMember } = usePresence();
  const { selectAgent, openAgentMessage, messageFocusRequest, globalSearchOpen } = useNavigation();

  const { t } = useText();
  const localSubjects = createAgentConversationsController(agentConversationsPort(), () =>
    activeServer()?.kind === "local" ? (activeAgent()?.id ?? null) : null,
  );
  createEffect(
    () => agentList().map((agent) => agent.id),
    (ids) => {
      if (activeServer()?.kind === "local") localSubjects.reconcileAgents(ids);
    },
  );
  createEffect(
    () => ({ id: activeServer()?.kind === "local" ? activeAgent()?.id : undefined }),
    ({ id }) => {
      if (id) void localSubjects.list(id);
    },
  );
  const addedSubject = () => (activeServer()?.kind === "local" ? localSubjects.addedTarget() : null);
  const composerController = useConversationController();
  createEffect(
    () => ({ agentId: activeAgent()?.id, serverId: activeServer()?.id, threadId: addedSubject()?.threadId }),
    (target) => {
      if (target.agentId && target.serverId)
        composerController.setAgentConversationSelection({
          agentId: target.agentId,
          serverId: target.serverId,
          ...(target.threadId ? { threadId: target.threadId } : {}),
        });
    },
  );
  const subjectView = () => (addedSubject() ? localSubjects.view() : undefined);
  const subjectAction = (action: Parameters<typeof localSubjects.run>[0]) =>
    localSubjects.run(action).catch(() => false);
  const subjectRuntime = (target: ConversationTarget) =>
    target.threadId && target.serverId === "local"
      ? agentConversationRuntime(desktopConversationRuntime(), agentConversationsPort(), localSubjects, {
          agentId: target.agentId,
          threadId: target.threadId,
        })
      : desktopConversationRuntime();
  const conversationSelector = () =>
    activeServer()?.kind === "local" ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("conversation.conversations.open")}
        title={localSubjects.currentSummary()?.label ?? t("conversation.conversations.main")}
        class="conversation-subject-trigger"
        onClick={() => localSubjects.setDialog(true)}
      >
        {localSubjects.currentSummary()?.label ?? t("conversation.conversations.main")}
      </Button>
    ) : undefined;

  const activePrompt = createMemo(() => {
    const agent = activeAgent();
    const event = agent ? pendingPrompts()[agent.id] : undefined;
    return event?.type === "prompt" && event.threadId === agent?.threadId ? event : undefined;
  });

  const activeApproval = createMemo(() => {
    const agent = activeAgent();
    const approval = agent ? pendingApprovals()[agent.id] : undefined;
    return approval?.threadId === agent?.threadId ? approval : undefined;
  });

  const activeBrowserTakeover = createMemo(() => {
    const agent = activeAgent();
    const event = agent ? pendingPrompts()[agent.id] : undefined;
    return event?.type === "browser-takeover-requested" && event.request.threadId === agent?.threadId
      ? event.request
      : undefined;
  });

  /**
   * Access and auto-approve of a joined server's agent, read from its host. Null for this
   * computer's agents, for a member, and for a host without `agent-admin-v1`.
   */
  const remoteAgentAdmin = createRemoteAgentAdmin(() => {
    const server = activeServer();
    const agent = activeAgent();
    return server && agent ? { server, agentId: agent.id, updatedAt: agent.updatedAt ?? null } : null;
  });
  const remoteAgentSettings = remoteAgentAdmin.settings;

  /**
   * Who may grant an agent standing approval: this computer for its own agents, and an owner or
   * admin of a joined server whose host has answered. The policy belongs to the computer that runs
   * the agent, so a remote grant is written on that host.
   */
  const autoApproveEditable = () => activeServer()?.kind === "local" || remoteAgentSettings() !== null;

  async function writeAgentAutoApprove(agentId: string, autoApprove: boolean): Promise<void> {
    if (activeServer()?.kind === "local") return setAgentAutoApprove(agentId, autoApprove);
    await remoteAgentAdmin.update({ agentId, autoApprove });
  }

  /** "Always allow", where the grant is the user's to give. */
  const alwaysAllowApproval = createMemo(() => {
    const agent = activeAgent();
    const approval = activeApproval();
    if (!agent || !approval || !autoApproveEditable()) return undefined;
    return async () => {
      await writeAgentAutoApprove(agent.id, true);
      if (!scopeIsCurrent()) return false;
      return respondToApprovalRequest(agent.id, approval.requestId, "accept");
    };
  });

  /**
   * The same grant as the approval card's, offered before an approval rather than during one, so an
   * agent can be trusted without waiting for it to ask.
   */
  const setAgentAutoApproveForActiveAgent = createMemo(() => {
    const agent = activeAgent();
    if (!agent || !autoApproveEditable()) return undefined;
    return (autoApprove: boolean) => writeAgentAutoApprove(agent.id, autoApprove);
  });

  /** A new chat with the active agent, on this computer or on a host that serves `context-reset-v1`. */
  const clearActiveAgentContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || !server || !serverSupportsCapability(server, "context-reset-v1")) return undefined;
    return () => turnsPort().agent.clearContext(agent.id, server.id);
  });

  /** The Team API agent summary has no access, so a joined server's agent shows the host's answer. */
  const conversationAgent = createMemo(() => {
    const agent = activeAgent();
    const settings = remoteAgentSettings();
    const subject = addedSubject();
    const automation = remoteAgentAdmin.automation();
    return agent
      ? {
          ...agent,
          ...(subject ? { threadId: subject.threadId } : {}),
          ...(settings ? { access: settings.access } : {}),
          ...(activeServer()?.kind === "remote" && automation !== undefined ? { allowAutomation: automation } : {}),
        }
      : agent;
  });
  /** Whether this window runs the sign-in of the agent's provider: on this computer, or on a server it administers. */
  const composerSignIn = () => {
    const provider = conversationAgent()?.provider;
    return provider !== undefined && connection.connectKind(provider) !== null;
  };
  /** Whether the composer offers the code sign-in for the agent's provider, when its Connect is slow or fails. */
  const composerCodeSignIn = () => {
    const provider = conversationAgent()?.provider;
    return composerSignIn() && provider !== undefined && connection.alternativeKind(provider) === "code";
  };

  /** Access of a joined server's agent goes to its host; every other field keeps the Team API route. */
  async function updateConversationAgent(agentId: string, updates: Omit<UpdateAgentInput, "agentId">): Promise<void> {
    if (activeServer()?.kind === "local") return updateAgent(agentId, updates);
    await updateRemoteAgent(remoteAgentAdmin, { agentId, ...updates }, ({ agentId: id, ...rest }) =>
      updateAgent(id, rest),
    );
  }

  /**
   * Provider downloads run on the computer the agents run on: this one, or a host the account
   * administers over `providers-v1`.
   */
  const providerDownloads = createMemo(
    () =>
      (activeServer()?.kind === "local" || providerAdminServerId() !== undefined) &&
      providerRuntimeDownloadsAvailable(),
  );
  /** Custom endpoints are added in the Providers section that this computer, or an administered host, shows. */
  const manageProviders = createMemo(() => activeServer()?.kind === "local" || providerAdminServerId() !== undefined);
  const openProviderSettings = (trigger: HTMLElement) => {
    const server = activeServer();
    if (server) openServerSettings(server.id, trigger, "providers");
  };
  /** The browser sign-in opens on this computer, so it stays local. */
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );

  /** Whether a usage limit holds this model and account now. */
  const usageLimited = (choice: AgentModelChoice) =>
    usageLimitedModels().some((limited) => sameAgentModelChoice(limited, choice));

  /**
   * A usage limit holds the active agent's queued message on this computer. The chat asks where to
   * send it, unless the agent switches by itself to a saved backup model that is ready.
   */
  const usageLimitAsk = createMemo((): UsageLimitAskCardProps | undefined => {
    const agent = activeAgent();
    if (!agent || activeServer()?.kind !== "local") return undefined;
    const limits = usageLimits();
    if (!(agent.id in limits)) return undefined;
    const resetsAt = limits[agent.id] ?? null;
    if (waitedUsageLimits()[agent.id] === resetsAt && agent.id in waitedUsageLimits()) return undefined;
    if (!queues()[agent.id]?.deliveries.some((delivery) => delivery.status === "queued")) return undefined;
    const source: BackupModelSource = {
      modelOptions: modelOptions(),
      providers: agentStatus().providers,
      limited: usageLimited,
    };
    const options = usageLimitAskOptions(agent, agent.backupModels, source);
    if (options.length === 0) return undefined;
    const backupModels = agent.backupModels;
    if (
      backupModels?.automatic &&
      backupModels.order.some((choice) => options.some((option) => sameAgentModelChoice(option.choice, choice)))
    )
      return undefined;
    const agentId = agent.id;
    const reasoningEffort = agent.reasoningEffort;
    return {
      provider: agent.provider,
      resetsAt,
      options,
      onSend: (option, remember) => {
        // The agent keeps its reasoning effort where the other model has it.
        const model = modelOptions().find(
          (candidate) => candidate.provider === option.choice.provider && candidate.id === option.choice.model,
        );
        return updateAgent(agentId, {
          provider: option.choice.provider,
          model: option.choice.model,
          providerAccountId: option.choice.providerAccountId ?? null,
          reasoningEffort:
            model && !model.supportedReasoningEfforts.includes(reasoningEffort)
              ? model.defaultReasoningEffort
              : reasoningEffort,
          leaveUsageLimit: true,
          ...(remember ? { backupModels: rememberedBackupModels(option.choice, backupModels) } : {}),
        });
      },
      onWait: () => setWaitedUsageLimits((current) => ({ ...current, [agentId]: resetsAt })),
    };
  });

  const conversationActions = createMemo(() => {
    const target = addedSubject();
    const agentId = activeAgent()?.id;
    const serverId = activeServer()?.id;
    const prompt = target ? localSubjects.prompt() : undefined;
    const approval = target ? localSubjects.approval() : undefined;
    const takeover = target ? localSubjects.takeover() : undefined;
    const turnId = target ? subjectView()?.activeTurnId : null;
    const throughMessageId = target ? (subjectView()?.messages.at(-1)?.id ?? null) : undefined;
    const legacyCurrent = () => activeAgent()?.id === agentId && activeServer()?.id === serverId && !addedSubject();
    const actions: Pick<
      ConversationProps,
      | "onMarkRead"
      | "onLoadOlder"
      | "onLoadLatest"
      | "onSearchMessages"
      | "onOpenSearchMessage"
      | "onAnswerPrompt"
      | "onRespondToApproval"
      | "onRespondToBrowserTakeover"
      | "onCancelQueuedMessage"
      | "onSteerQueuedMessage"
      | "onReorderQueue"
      | "onStop"
      | "onDismissConversationError"
      | "onRetryConversationError"
    > = {
      onMarkRead: () =>
        target
          ? localSubjects
              .run({ ...target, action: "mark-read", throughMessageId: throughMessageId ?? null })
              .then(() => localSubjects.load(target))
          : agentId && serverId && legacyCurrent()
            ? markAgentMessagesRead(agentId, undefined, serverId)
            : Promise.resolve(),
      onLoadOlder: () => {
        if (target) void localSubjects.loadOlder(target);
        else if (agentId && legacyCurrent()) void loadOlderAgentMessages(agentId);
      },
      onLoadLatest: () =>
        target
          ? localSubjects.load(target)
          : agentId && legacyCurrent()
            ? loadLatestAgentMessages(agentId)
            : Promise.resolve(),
      onSearchMessages: (query) =>
        target
          ? localSubjects.search(target, query)
          : agentId && legacyCurrent()
            ? searchAgentMessages(agentId, query)
            : Promise.resolve({ messageIds: [], total: 0 }),
      onOpenSearchMessage: (messageId) =>
        target
          ? localSubjects.load(target, { type: "around", messageId })
          : agentId && legacyCurrent()
            ? openAgentMessage(agentId, messageId)
            : Promise.resolve(),
      onAnswerPrompt: (answers) =>
        target
          ? prompt
            ? subjectAction({
                ...target,
                action: "prompt",
                turnId: prompt.turnId,
                requestId: prompt.requestId,
                answers,
              }).then((result) => result !== false)
            : Promise.resolve(false)
          : legacyCurrent()
            ? answerPrompt(answers)
            : Promise.resolve(false),
      onRespondToApproval: (decision) =>
        target
          ? approval?.turnId
            ? subjectAction({
                ...target,
                action: "approval",
                turnId: approval.turnId,
                requestId: approval.requestId,
                decision,
              }).then((result) => result !== false)
            : Promise.resolve(false)
          : legacyCurrent()
            ? respondToApproval(decision)
            : Promise.resolve(false),
      onRespondToBrowserTakeover: (decision) =>
        target
          ? takeover?.turnId
            ? subjectAction({
                ...target,
                action: "takeover",
                turnId: takeover.turnId,
                requestId: takeover.requestId,
                decision,
              }).then((result) => result !== false)
            : Promise.resolve(false)
          : legacyCurrent()
            ? respondToBrowserTakeover(decision)
            : Promise.resolve(false),
      onCancelQueuedMessage: (deliveryId) => {
        if (target) void subjectAction({ ...target, action: "cancel", deliveryId });
        else if (legacyCurrent()) cancelQueuedMessage(deliveryId);
      },
      onSteerQueuedMessage: (deliveryId) => {
        if (target && turnId) void subjectAction({ ...target, action: "steer", deliveryId, expectedTurnId: turnId });
        else if (!target && legacyCurrent()) steerQueuedMessage(deliveryId);
      },
      onReorderQueue: (deliveryIds) => {
        if (target) void subjectAction({ ...target, action: "reorder", deliveryIds });
        else if (legacyCurrent()) reorderQueue(deliveryIds);
      },
      onStop: () => {
        if (target && turnId) void subjectAction({ ...target, action: "stop", turnId });
        else if (!target && legacyCurrent()) stopActiveTurn();
      },
      onDismissConversationError: target ? () => localSubjects.clearError(target) : undefined,
      onRetryConversationError: target ? () => localSubjects.load(target) : undefined,
    };
    return actions;
  });

  return (
    <>
      <Conversation
        conversationThreadId={addedSubject()?.threadId}
        conversationArchived={Boolean(addedSubject() && localSubjects.currentSummary()?.archivedAt)}
        conversationError={subjectView()?.error}
        onDismissConversationError={conversationActions().onDismissConversationError}
        onRetryConversationError={conversationActions().onRetryConversationError}
        conversationSelector={conversationSelector()}
        runtimeForTarget={subjectRuntime}
        notice={
          addedSubject() ? (
            <p class="agent-conversation-notice" role="note">
              {t(
                localSubjects.currentSummary()?.archivedAt
                  ? "conversation.conversations.archivedNotice"
                  : "conversation.conversations.serialNotice",
              )}
            </p>
          ) : undefined
        }
        contextState={contextStates()[activeAgent()?.id ?? ""]}
        platform={platform.appInfo()?.platform}
        onOpenMarketplace={() => setSkillsMarketplaceOpen(true)}
        connectors={connectors.active}
        onOpenMarketplaceApp={(request) => {
          setPendingPluginConnect(request.connect);
          setPendingPluginSlug(request.appId);
          setSkillsMarketplaceOpen(true);
        }}
        onOpenUsage={(trigger) => usage.openUsage(activeServer()?.id ?? "local", trigger, activeAgent()?.id)}
        agentStatus={
          activeServer()?.kind === "remote" &&
          (!serverScope.loaded() || !conversations[activeAgent()?.id ?? ""]?.loaded)
            ? { ...agentStatus(), phase: "starting" }
            : agentStatus()
        }
        agentsConnecting={agentListConnecting()}
        accountUsage={withHostAccountUsage(auth.accountUsage(), hostAccountLimits())}
        providerRuntimeStatuses={providerDownloads() ? providerRuntimeStatuses() : undefined}
        customProviders={customProviders()}
        // The custom agents are this computer's. A joined host's picker counts its own from its models.
        customAgents={activeServer()?.kind === "local" ? customAgents() : undefined}
        onDownloadProvider={providerDownloads() ? downloadProviderRuntime : undefined}
        onCancelProviderDownload={providerDownloads() ? cancelProviderRuntimeDownload : undefined}
        onConnectProvider={localProviderDownloads() || providerAdminServerId() ? connectFromComposer : undefined}
        canConnectProvider={(provider) => connection.connectKind(provider) !== null}
        onSignInProvider={composerSignIn() ? connectFromComposer : undefined}
        onSignInWithCodeProvider={composerCodeSignIn() ? signInWithCode : undefined}
        onManageProviders={manageProviders() ? openProviderSettings : undefined}
        agent={conversationAgent()}
        agents={agentList()}
        availableRoutineIds={activeRoutineIds()}
        routines={activeRoutines()}
        modelOptions={modelOptions()}
        messages={addedSubject() ? localSubjects.messages() : activeMessages()}
        messageReferences={
          addedSubject()
            ? localSubjects.references()
            : activeAgent()
              ? (conversations[activeAgent()?.id ?? ""]?.references ?? {})
              : {}
        }
        unreadCount={
          addedSubject()
            ? (subjectView()?.page?.readState?.unreadCount ?? 0)
            : activeAgent()
              ? (conversations[activeAgent()?.id ?? ""]?.read?.unreadCount ?? 0)
              : 0
        }
        firstUnreadMessageId={
          addedSubject()
            ? (subjectView()?.page?.readState?.firstUnreadMessageId ?? null)
            : activeAgent()
              ? (conversations[activeAgent()?.id ?? ""]?.read?.firstUnreadMessageId ?? null)
              : null
        }
        loaded={
          addedSubject()
            ? subjectView()?.loaded === true
            : activeAgent()
              ? conversations[activeAgent()?.id ?? ""]?.loaded === true
              : false
        }
        hasOlder={
          addedSubject()
            ? (subjectView()?.page?.pageInfo.hasOlder ?? false)
            : activeServerSupportsCapability("conversation-pagination") && activeAgent()
              ? (conversations[activeAgent()?.id ?? ""]?.page?.hasOlder ?? false)
              : false
        }
        unloadedHistory={
          addedSubject()
            ? unloadedHistory(subjectView()?.page?.pageInfo)
            : activeAgent()
              ? unloadedHistory(conversations[activeAgent()?.id ?? ""]?.page)
              : undefined
        }
        discontinuous={
          addedSubject()
            ? subjectView()?.mode === "around"
            : activeAgent()
              ? conversations[activeAgent()?.id ?? ""]?.windowMode === "around"
              : false
        }
        loadingOlder={
          addedSubject()
            ? subjectView()?.olderLoading === true
            : activeAgent()
              ? conversations[activeAgent()?.id ?? ""]?.olderLoading === true
              : false
        }
        olderError={
          addedSubject()
            ? (subjectView()?.olderError ?? null)
            : activeAgent()
              ? (conversations[activeAgent()?.id ?? ""]?.olderError ?? null)
              : null
        }
        queue={addedSubject() ? subjectView()?.queue : activeQueue()}
        browserTabs={browserTabs()}
        activeBrowserTabId={activeBrowserTabId()}
        browserVisibilitySuspended={browserVisibilitySuspended()}
        workspaceCovered={usage.state.serverId !== null}
        browserControlState={browserControlState()}
        server={activeServer()}
        presence={teamPresence()}
        currentUserEmail={props.account().email}
        isOwnSender={(senderId) => {
          const state = auth.centralAuth();
          return isReaderAuthor(senderId, {
            memberId: currentTeamMember()?.id ?? null,
            accountUserId: state.status === "signed_in" ? state.user.id : null,
            onOwnComputer: activeServer()?.kind === "local",
          });
        }}
        browserEnabled={!platform.landingPreview && activeServerSupportsCapability("browser-control")}
        remoteDesktopSessionActive={Boolean(activeRemoteDesktopSession())}
        remoteDesktopVisible={remoteDesktopWorkspaceVisible()}
        remoteDesktopEnabled={!platform.landingPreview && activeServerSupportsCapability("remote-desktop")}
        prompt={addedSubject() ? localSubjects.prompt() : activePrompt()}
        approval={addedSubject() ? localSubjects.approval() : activeApproval()}
        usageLimitAsk={usageLimitAsk()}
        usageLimited={activeServer()?.kind === "local" ? usageLimited : undefined}
        browserTakeover={addedSubject() ? localSubjects.takeover() : activeBrowserTakeover()}
        activeTurnId={
          addedSubject() ? subjectView()?.activeTurnId : activeAgent() ? activeTurns()[activeAgent()?.id ?? ""] : null
        }
        activityDetail={
          addedSubject()
            ? subjectView()?.detail
            : activeAgent()
              ? turnProgress()[activeAgent()?.id ?? ""]?.detail
              : undefined
        }
        skillsMarketplaceOpen={skillsMarketplaceOpen()}
        mcpSettingsOpen={serverSettingsOpen() || skillsMarketplaceOpen()}
        globalOverlayOpen={
          globalSearchOpen() ||
          joinServerOpen() ||
          serverSettingsOpen() ||
          appSettingsOpen() ||
          skillsMarketplaceOpen() ||
          localSubjects.state.dialog.open ||
          hasVisibleToasts()
        }
        settingsRequest={settingsRequest()}
        messageFocusRequest={messageFocusRequest()}
        onSelectAgent={selectAgent}
        onUpdateAgent={updateConversationAgent}
        onSetAgentAvatar={setAgentAvatar}
        onSendMessage={(body, drafts, reply, target, clientMessageId) =>
          target?.threadId
            ? localSubjects.send(body, drafts, reply, target, clientMessageId)
            : sendMessage(body, drafts, reply, target, clientMessageId)
        }
        onMarkRead={conversationActions().onMarkRead}
        onLoadOlder={conversationActions().onLoadOlder}
        onLoadLatest={conversationActions().onLoadLatest}
        onSearchMessages={conversationActions().onSearchMessages}
        onOpenSearchMessage={conversationActions().onOpenSearchMessage}
        onTypingChange={(agentId, typing) => {
          if (!typing || !addedSubject()) setTeamTyping(agentId, typing);
        }}
        onAnswerPrompt={conversationActions().onAnswerPrompt}
        onPromptResolutionPresented={presentPromptResolution}
        onRespondToApproval={conversationActions().onRespondToApproval}
        onAlwaysAllowApproval={addedSubject() ? undefined : alwaysAllowApproval()}
        agentAutoApproves={
          activeServer()?.kind === "local"
            ? agentAutoApproves(activeAgent()?.id ?? "")
            : (remoteAgentSettings()?.autoApprove ?? false)
        }
        agentAutoApproveLocked={
          activeServer()?.kind === "local"
            ? generalSettings().turboMode
            : (remoteAgentSettings()?.autoApproveLocked ?? false)
        }
        onSetAgentAutoApprove={setAgentAutoApproveForActiveAgent()}
        defaultBusyMessageMode={generalSettings().busyMessageMode}
        agentMemoryLimit={generalSettings().agentMemoryLimit}
        onClearAgentContext={addedSubject() ? undefined : clearActiveAgentContext()}
        onRespondToBrowserTakeover={conversationActions().onRespondToBrowserTakeover}
        onCancelQueuedMessage={conversationActions().onCancelQueuedMessage}
        waits={activeWaits()}
        onCancelWait={cancelWait}
        onSteerQueuedMessage={conversationActions().onSteerQueuedMessage}
        onUpdateQueuedMessage={(deliveryId, text, keep, drafts, target) =>
          target?.threadId ? Promise.resolve(false) : updateQueuedMessage(deliveryId, text, keep, drafts, target)
        }
        onReorderQueue={conversationActions().onReorderQueue}
        onActivateBrowserTab={activateBrowserTab}
        onCloseBrowserTab={closeBrowserTab}
        onOpenRemoteDesktop={openRemoteDesktopWorkspace}
        onStop={conversationActions().onStop}
      />
      <Show when={activeServer()?.kind === "local" && activeAgent()?.id}>
        {(id) => (
          <AgentConversationsDialog
            open={localSubjects.state.dialog.open}
            onOpenChange={localSubjects.setDialog}
            conversations={localSubjects.state.lists[id()]?.conversations ?? []}
            selectedThreadId={localSubjects.selected()}
            query={localSubjects.state.dialog.query}
            archived={localSubjects.state.dialog.archived}
            loading={localSubjects.state.lists[id()]?.loading ?? false}
            pending={localSubjects.state.dialog.pending}
            error={localSubjects.state.dialog.error ?? localSubjects.state.lists[id()]?.error ?? null}
            hasMore={Boolean(localSubjects.state.lists[id()]?.cursor)}
            onQueryChange={localSubjects.setQuery}
            onArchivedChange={localSubjects.setArchived}
            onSelect={(threadId) => localSubjects.select({ agentId: id(), threadId })}
            onCreate={(label) => localSubjects.create(id(), label)}
            onRename={(threadId, label) => localSubjects.rename({ agentId: id(), threadId }, label)}
            onArchive={(threadId, archived) => localSubjects.archive({ agentId: id(), threadId }, archived)}
            onLoadMore={localSubjects.loadMore}
          />
        )}
      </Show>
      <ProviderSignInDialogs api={connection} opener="composer" />
    </>
  );
}

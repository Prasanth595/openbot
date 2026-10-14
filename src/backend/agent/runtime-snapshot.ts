import { CHAT_VISUAL_ITEM_TYPE_PREFIX } from "@openbot/contracts/chat-visual";
import { AGENT_ROSTER_BYTES_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_RUNTIME_PERMISSION_PATHS_LIMIT,
  AGENT_RUNTIME_QUESTION_DESCRIPTION_LIMIT,
  AGENT_RUNTIME_QUESTION_HEADER_LIMIT,
  AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT,
  AGENT_RUNTIME_TEXT_LIMIT,
  type AgentApproval,
  type AgentPromptQuestion,
  type AgentRuntimeSnapshot,
  type AgentSummary,
  CONVERSATION_PLAN_ITEM_TYPE,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import type { MailboxStore } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import type { AttentionRegistry } from "./attention-registry";
import type { ConversationRuntime } from "./conversation-runtime";
import { AgentRosterBudgetExceeded, compactRuntimeRosterEntry } from "./roster-admission";
import type { TurnLifecycle } from "./turn-lifecycle";
import type { UsageLimitGate } from "./usage-limit-gate";

export function compactRuntimeQuestion(
  question: AgentPromptQuestion,
): AgentRuntimeSnapshot["pendingPrompts"][number]["questions"][number] {
  return {
    id: question.id,
    header: question.header.slice(0, AGENT_RUNTIME_QUESTION_HEADER_LIMIT),
    question: question.question.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
    isSecret: question.isSecret,
    options:
      question.options?.map((option) => ({
        label: option.label,
        description: option.description.slice(0, AGENT_RUNTIME_QUESTION_DESCRIPTION_LIMIT),
      })) ?? null,
  };
}

export function compactRuntimeApproval(approval: AgentApproval): AgentRuntimeSnapshot["pendingApprovals"][number] {
  const pathTruncated = (path: string) => path.length > AGENT_RUNTIME_TEXT_LIMIT;
  return {
    ...approval,
    truncated:
      [approval.command, approval.cwd, approval.reason, approval.grantRoot].some(
        (value) => value !== null && value.length > AGENT_RUNTIME_TEXT_LIMIT,
      ) ||
      Boolean(
        approval.permissions &&
          (approval.permissions.fileSystem.read.length > AGENT_RUNTIME_PERMISSION_PATHS_LIMIT ||
            approval.permissions.fileSystem.write.length > AGENT_RUNTIME_PERMISSION_PATHS_LIMIT ||
            approval.permissions.fileSystem.read.some(pathTruncated) ||
            approval.permissions.fileSystem.write.some(pathTruncated)),
      ),
    command: approval.command?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    cwd: approval.cwd?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    reason: approval.reason?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    grantRoot: approval.grantRoot?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    permissions: approval.permissions
      ? {
          fileSystem: {
            read: approval.permissions.fileSystem.read
              .slice(0, AGENT_RUNTIME_PERMISSION_PATHS_LIMIT)
              .map((path) => path.slice(0, AGENT_RUNTIME_TEXT_LIMIT)),
            write: approval.permissions.fileSystem.write
              .slice(0, AGENT_RUNTIME_PERMISSION_PATHS_LIMIT)
              .map((path) => path.slice(0, AGENT_RUNTIME_TEXT_LIMIT)),
          },
          network: approval.permissions.network,
        }
      : null,
  };
}

function fitRuntimeSnapshot(snapshot: AgentRuntimeSnapshot): AgentRuntimeSnapshot {
  const budget =
    snapshot.agents.length > INPUT_LIMITS.agents ? AGENT_ROSTER_BYTES_LIMIT : AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT;
  if (runtimeSnapshotBytes(snapshot) <= budget) return snapshot;

  // Local-only context goes first, so it never costs Team clients a field they had before.
  if (snapshot.contextStates?.length) {
    snapshot.contextStates = [];
    if (runtimeSnapshotBytes(snapshot) <= budget) return snapshot;
  }

  snapshot.agents = snapshot.agents.map((agent) => ({ ...agent, preview: "", avatarUrl: null }));
  if (runtimeSnapshotBytes(snapshot) <= budget) return snapshot;

  snapshot.work = [];
  if (runtimeSnapshotBytes(snapshot) <= budget) return snapshot;

  snapshot.latestMessages = snapshot.latestMessages.map((message) => ({ ...message, text: "" }));
  if (runtimeSnapshotBytes(snapshot) <= budget) return snapshot;

  snapshot.pendingPrompts = snapshot.pendingPrompts.map((prompt) => ({
    ...prompt,
    questions: prompt.questions.map((question) => ({
      ...question,
      header: question.header.slice(0, 40),
      question: question.question.slice(0, 80),
      options: question.options?.map((option) => ({ label: option.label, description: "" })) ?? null,
    })),
  }));
  snapshot.pendingApprovals = snapshot.pendingApprovals.map((approval) => ({
    ...approval,
    truncated: true,
    command: approval.command?.slice(0, 80) ?? null,
    cwd: approval.cwd?.slice(0, 80) ?? null,
    reason: approval.reason?.slice(0, 80) ?? null,
    grantRoot: approval.grantRoot?.slice(0, 80) ?? null,
    permissions: approval.permissions
      ? { fileSystem: { read: [], write: [] }, network: approval.permissions.network }
      : null,
  }));
  if (runtimeSnapshotBytes(snapshot) <= budget) return snapshot;

  while (
    runtimeSnapshotBytes(snapshot) > budget &&
    snapshot.pendingPrompts.length + snapshot.pendingApprovals.length + snapshot.pendingBrowserTakeovers.length > 0
  ) {
    snapshot.attentionComplete = false;
    if (snapshot.pendingBrowserTakeovers.length > 0) snapshot.pendingBrowserTakeovers.pop();
    else if (snapshot.pendingApprovals.length > 0) snapshot.pendingApprovals.pop();
    else snapshot.pendingPrompts.pop();
  }
  if (runtimeSnapshotBytes(snapshot) <= budget) return snapshot;

  snapshot.agents = snapshot.agents.map(compactRuntimeRosterEntry);
  if (snapshot.agents.length > INPUT_LIMITS.agents && runtimeSnapshotBytes(snapshot) > budget) {
    // These are reply previews and model hints, not the conversation or the usage gate's state.
    // The roster, active turns, failed turns and per-agent holds must remain complete.
    snapshot.latestMessages = [];
    snapshot.usageLimitedModels = [];
    if (runtimeSnapshotBytes(snapshot) > budget) throw new AgentRosterBudgetExceeded();
  }
  return snapshot;
}

function runtimeSnapshotBytes(snapshot: AgentRuntimeSnapshot): number {
  const type = snapshot.agents.length > INPUT_LIMITS.agents ? "large-runtime-snapshot" : "runtime-snapshot";
  return Buffer.byteLength(JSON.stringify({ type, snapshot }));
}

export interface RuntimeSnapshotSources {
  contextStates?: AgentRuntimeSnapshot["contextStates"];
  agents: AgentSummary[];
  conversation: Pick<ConversationRuntime, "loadedSnapshot">;
  database: Pick<OpenBotDatabase, "readConversationRuntime">;
  mailbox: Pick<MailboxStore, "listRuntimeWork">;
  turn: Pick<TurnLifecycle, "failedTurns">;
  attention: Pick<AttentionRegistry, "runtimeAttention">;
  usageLimits: Pick<UsageLimitGate, "limitedAgents" | "limitedModels">;
}

/** The runtime view of every agent: active turns, queued work, latest messages and attention. */
export function buildRuntimeSnapshot({
  contextStates,
  agents,
  conversation,
  database,
  mailbox,
  turn,
  attention,
  usageLimits,
}: RuntimeSnapshotSources): AgentRuntimeSnapshot {
  const runtimeAgents: AgentRuntimeSnapshot["agents"] = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    notifications: agent.notifications,
    preview: agent.preview.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
    updatedAt: agent.updatedAt,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarUrl: agent.avatarUrl,
  }));
  const activeTurns: AgentRuntimeSnapshot["activeTurns"] = [];
  const latestMessages: AgentRuntimeSnapshot["latestMessages"] = [];
  for (const agent of agents) {
    const live = conversation.loadedSnapshot(agent.id);
    const liveLatest = [...(live?.messages ?? [])].reverse().find(
      (message) =>
        (message.author === "assistant" || message.author === "agent") &&
        // A message that another agent sent to this one is not a reply to the user.
        !message.senderAgentId &&
        message.itemType !== "commentary" &&
        message.itemType !== "question_prompt" &&
        message.itemType !== "agent_attachment" &&
        !message.itemType?.startsWith(CHAT_VISUAL_ITEM_TYPE_PREFIX) &&
        message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
        message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE,
    );
    const persisted =
      !live || !liveLatest
        ? database.readConversationRuntime(agent.id, agent.threadId)
        : { activeTurnId: null, latestMessage: null };
    const activeTurnId = live ? live.activeTurnId : persisted.activeTurnId;
    if (activeTurnId && agent.threadId) {
      activeTurns.push({ agentId: agent.id, threadId: agent.threadId, turnId: activeTurnId });
    }
    const latest = liveLatest ?? persisted.latestMessage;
    if (latest) {
      latestMessages.push({
        agentId: agent.id,
        id: latest.id,
        text: latest.text.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
        createdAt: latest.createdAt,
      });
    }
  }
  return fitRuntimeSnapshot({
    agents: runtimeAgents,
    activeTurns,
    work: mailbox.listRuntimeWork(
      agents.map((agent) => agent.id),
      turn.failedTurns(),
    ),
    latestMessages,
    ...attention.runtimeAttention(),
    failedTurns: [...turn.failedTurns()].map(([agentId, turnId]) => ({ agentId, turnId })),
    usageLimits: usageLimits.limitedAgents(),
    usageLimitedModels: usageLimits.limitedModels(),
    ...(contextStates ? { contextStates } : {}),
  });
}

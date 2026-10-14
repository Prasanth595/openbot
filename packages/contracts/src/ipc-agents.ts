import { INPUT_LIMITS } from "./input-limits";
import {
  type AgentModelId,
  type AgentReasoningEffort,
  type AvatarHue,
  isAgentModel,
  isAvatarHue,
  isAvatarSeed,
  isReasoningEffort,
} from "./ipc-agent-identity";
import {
  type AgentSessionSettingOverrides,
  isAgentSessionSettingOverrides,
  isAgentSessionSettingResets,
} from "./ipc-agent-session-settings";
import {
  type AgentProviderId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentProvider,
  isProviderAccountId,
} from "./ipc-agent-status";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type BusyMessageMode, isBusyMessageMode } from "./ipc-queue";
import type { SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

/**
 * How far an agent may reach on this computer. `workspace` limits writes to the agent's workspace, the
 * shared folder and the temporary folders; `full` is the unrestricted access every agent had before the setting existed.
 */
export const AGENT_ACCESS_MODES = ["full", "workspace"] as const;
export type AgentAccess = (typeof AGENT_ACCESS_MODES)[number];
export const DEFAULT_AGENT_ACCESS: AgentAccess = "full";

export function isAgentAccess(value: unknown): value is AgentAccess {
  return isOneOf(AGENT_ACCESS_MODES, value);
}

/** Whether the agent may use Computer Use. Absent means on, as for every agent before the setting existed. */
export function agentComputerUseEnabled(agent: Pick<AgentSummary, "computerUse">): boolean {
  return agent.computerUse !== false;
}

export function agentAutomationAllowed(agent: Pick<AgentSummary, "allowAutomation">): boolean {
  return agent.allowAutomation === true;
}

/**
 * Whether this agent runs inside the workspace sandbox now. Every provider enforces it. Codex runs the
 * agent in its `workspace-write` sandbox. Claude runs Bash in its sandbox and asks before a file edit
 * outside the roots. Grok and OpenCode run the agent in a provider process of its own, inside an
 * operating system sandbox (`process-confinement.ts`); on Linux and Windows that process does not start.
 */
export function workspaceAccessEnforced(agent: Pick<AgentSummary, "access">): boolean {
  return agent.access === "workspace";
}

/** A provider, a model and an account that an agent can run on. */
export interface AgentModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
  /** Absent means the provider's own sign-in, `DEFAULT_PROVIDER_ACCOUNT_ID`. */
  providerAccountId?: string;
}

/** The most backup models an agent keeps. */
export const AGENT_BACKUP_MODEL_LIMIT = 8;

/**
 * What an agent does when a usage limit holds a message that has not started. Absent means the
 * agent asks in the chat, with no saved order.
 */
export interface AgentBackupModels {
  /** True: the agent switches at once to the first available model in `order`. False: it asks first. */
  automatic: boolean;
  /** The models to try, first to last. */
  order: AgentModelChoice[];
}

export function isAgentModelChoice(value: unknown): value is AgentModelChoice {
  return (
    isDynamicRecord(value) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId))
  );
}

/** The model an agent left for a usage limit, with the reasoning effort it had there. */
export interface AgentUsageLimitReturn extends AgentModelChoice {
  reasoningEffort: AgentReasoningEffort;
}

export function isAgentUsageLimitReturn(value: unknown): value is AgentUsageLimitReturn {
  return isDynamicRecord(value) && isAgentModelChoice(value) && isReasoningEffort(value.reasoningEffort);
}

export function isAgentBackupModels(value: unknown): value is AgentBackupModels {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.automatic) &&
    Array.isArray(value.order) &&
    value.order.length <= AGENT_BACKUP_MODEL_LIMIT &&
    value.order.every(isAgentModelChoice)
  );
}

/** Whether two choices name the same provider, model and account. */
export function sameAgentModelChoice(left: AgentModelChoice, right: AgentModelChoice): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === (right.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
  );
}

function isMarketplaceSource(value: unknown): value is NonNullable<AgentSummary["marketplaceSource"]> {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.listingId) &&
    isIdentifier(value.versionId) &&
    isNumber(value.version) &&
    Number.isInteger(value.version) &&
    Array.isArray(value.skillIds) &&
    value.skillIds.length <= INPUT_LIMITS.agents &&
    value.skillIds.every(isIdentifier) &&
    Array.isArray(value.routineIds) &&
    value.routineIds.length <= INPUT_LIMITS.agentRoutines &&
    value.routineIds.every(isIdentifier)
  );
}

export interface AgentSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  /** Local saved provider settings; released Team API agent payloads omit this field. */
  sessionSettingOverrides?: AgentSessionSettingOverrides;
  /** Provider sessions that must restart to restore defaults after a reset. Local-only. */
  sessionSettingResets?: string[];
  /**
   * Local-only, like Auto approve: the Team API does not carry it, so an agent read from a remote host
   * has none. Absent means `DEFAULT_AGENT_ACCESS`.
   */
  access?: AgentAccess;
  /**
   * Whether the agent gets the Computer Use tools. Local-only, like `access`. Absent means on; see
   * `agentComputerUseEnabled`.
   */
  computerUse?: boolean;
  /**
   * Whether a local script can run this agent's routines through the automation server. Local-only,
   * like `access`. Absent means off; see `agentAutomationAllowed`.
   */
  allowAutomation?: boolean;
  /**
   * What a message sent while the agent is busy does. Local-only, like `access`. Absent means the
   * app default.
   */
  busyMessageMode?: BusyMessageMode;
  /**
   * The provider account the agent's turns run on. Local-only, like `access`. Absent means the
   * provider's own sign-in, `DEFAULT_PROVIDER_ACCOUNT_ID`.
   */
  providerAccountId?: string;
  /** Local-only, like `access`. Absent means the agent asks before it leaves a usage limit. */
  backupModels?: AgentBackupModels;
  /**
   * The agent's own model while a usage limit has moved it to a backup. Local-only. The agent goes
   * back to it when the limit ends.
   */
  usageLimitReturn?: AgentUsageLimitReturn;
  threadId: string | null;
  workspacePath: string;
  preview: string;
  updatedAt: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  marketplaceSource?: {
    listingId: string;
    versionId: string;
    version: number;
    skillIds: string[];
    routineIds: string[];
  };
}

export function isAgentSummary(value: unknown): value is AgentSummary {
  if (!isDynamicRecord(value)) return false;
  return (
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isBoolean(value.notifications) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.sessionSettingOverrides === undefined || isAgentSessionSettingOverrides(value.sessionSettingOverrides)) &&
    (value.sessionSettingResets === undefined || isAgentSessionSettingResets(value.sessionSettingResets)) &&
    (value.access === undefined || isAgentAccess(value.access)) &&
    (value.computerUse === undefined || isBoolean(value.computerUse)) &&
    (value.allowAutomation === undefined || isBoolean(value.allowAutomation)) &&
    (value.busyMessageMode === undefined || isBusyMessageMode(value.busyMessageMode)) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId)) &&
    (value.backupModels === undefined || isAgentBackupModels(value.backupModels)) &&
    (value.usageLimitReturn === undefined || isAgentUsageLimitReturn(value.usageLimitReturn)) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    isBoundedString(value.workspacePath, INPUT_LIMITS.path) &&
    isBoundedString(value.preview, INPUT_LIMITS.messageText) &&
    (value.updatedAt === null || isBoundedString(value.updatedAt, 160)) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarUrl === null || isBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl)) &&
    (value.marketplaceSource === undefined || isMarketplaceSource(value.marketplaceSource))
  );
}

export interface CreateAgentInput {
  name: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  initialMessage: string;
  /**
   * The provider and model the agent starts on, applied before the initial message is queued.
   * Absent, the backend picks its starting default. A provider change after the first message is
   * queued is rejected while work is active, so naming them here is the only way a chosen pair
   * survives creation.
   */
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
}

export interface UpdateAgentInput {
  agentId: string;
  name?: string;
  title?: string;
  description?: string;
  notifications?: boolean;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  access?: AgentAccess;
  computerUse?: boolean;
  allowAutomation?: boolean;
  /** `null` returns the agent to the app default. */
  busyMessageMode?: BusyMessageMode | null;
  /** `null` returns the agent to the provider's own sign-in. */
  providerAccountId?: string | null;
  /** `null` returns the agent to the default: ask, with no saved order. */
  backupModels?: AgentBackupModels | null;
  /**
   * The provider, model or account change moves held work away from a usage limit. The agent goes
   * back to its current model when that limit ends. Ignored when no limit holds the agent.
   */
  leaveUsageLimit?: boolean;
  avatarSeed?: string;
  avatarHue?: AvatarHue | null;
}

export interface DuplicateAgentResult {
  agent: AgentSummary;
  layout: SidebarLayoutSnapshot;
}

export interface AvatarImageInput {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
}

export interface SetAgentAvatarInput {
  agentId: string;
  image: AvatarImageInput | null;
}

import { ConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS, storyRuntimeSettings } from "./fixtures";

const meta = {
  title: "Conversation/Header",
  component: ConversationHeader,
  args: {
    agent: STORY_AGENT,
    onSettingsIntent: fn(),
    onOpenSettings: fn(),
    modelPicker: {
      provider: storyRuntimeSettings(STORY_AGENT).provider,
      value: STORY_AGENT.model,
      reasoningEffort: STORY_AGENT.reasoningEffort,
      modelOptions: STORY_MODELS,
      agentStatus: STORY_AGENT_STATUS,
      onChange: fn(),
      onReasoningEffortChange: fn(),
    },
    sidePanel: { open: false, running: 0, onToggle: fn() },
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ConversationHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WorkspaceOnly: Story = { args: { agent: { ...STORY_AGENT, access: "workspace" } } };
export const RemoteControl: Story = {
  args: { remoteControl: { enabled: true, active: true, visible: false, onOpen: fn() } },
};
export const OfflineHost: Story = {
  args: {
    remoteControl: { enabled: false, active: false, visible: false, onOpen: fn() },
  },
};
export const AgentUsingBrowser: Story = {
  args: { sidePanel: { open: true, actingAgentName: STORY_AGENT.name, running: 0, onToggle: fn() } },
};
export const TasksRunning: Story = {
  args: { sidePanel: { open: false, running: 2, onToggle: fn() } },
};
/** A model chosen during the turn. The picker names it; the badge says that it starts with the next turn. */
export const ModelAfterThisTurn: Story = {
  args: {
    pendingModel: { running: "GPT-5.6 Luna", next: "GPT-5.6 Terra" },
    modelPicker: {
      provider: STORY_AGENT.provider,
      value: "gpt-5.6-terra",
      reasoningEffort: STORY_AGENT.reasoningEffort,
      modelOptions: STORY_MODELS,
      agentStatus: STORY_AGENT_STATUS,
      providerChangesDisabled: true,
      disabledReason: "Wait for the current work to finish before changing the provider or account.",
      onChange: fn(),
      onReasoningEffortChange: fn(),
    },
  },
};

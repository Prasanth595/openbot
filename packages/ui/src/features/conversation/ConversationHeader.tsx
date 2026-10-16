import { Button, Lock } from "@openbot/ui";
import { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { agentAccessLockLabel } from "@openbot/ui/features/agents/agent-access";
import {
  ChatMenu,
  type ChatMenuBrowser,
  type ChatMenuFiles,
  type ChatMenuRemoteControl,
  type ChatMenuTasks,
} from "@openbot/ui/features/conversation/ChatMenu";
import { useText } from "@openbot/ui/text";
import type { ComponentProps } from "@solidjs/web";
import { Show } from "solid-js";

export interface ConversationHeaderProps {
  agent: AgentProfile | null | undefined;
  modelPicker: ComponentProps<typeof ProviderModelPicker>;
  onSettingsIntent: () => void;
  onOpenSettings: () => void;
  remoteControl?: ChatMenuRemoteControl | undefined;
  /** The Files panel of this chat. Left out when the host cannot list them. */
  files?: ChatMenuFiles | undefined;
  browser?: ChatMenuBrowser | undefined;
  /** The agent's tasks. Left out where the host keeps no tasks. */
  tasks?: ChatMenuTasks | undefined;
}

export function ConversationHeader(props: ConversationHeaderProps) {
  const { t } = useText();
  return (
    <header class="window-drag conversation-header">
      <div class="conversation-heading-group">
        <Show when={props.agent}>
          {(agent) => (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              class="conversation-title no-drag"
              aria-label={t("conversation.header.settings")}
              onPointerEnter={props.onSettingsIntent}
              onFocus={props.onSettingsIntent}
              onClick={props.onOpenSettings}
            >
              <AgentAvatar agent={agent()} />
              <h1>{agent().name}</h1>
            </Button>
          )}
        </Show>
        <Show when={props.agent && agentAccessLockLabel(props.agent, t)}>
          {(label) => (
            <span class="conversation-access-lock" role="img" aria-label={label()} title={label()}>
              <Lock aria-hidden="true" />
            </span>
          )}
        </Show>
      </div>
      <div class="conversation-header-actions no-drag">
        <Show when={props.agent}>
          <ProviderModelPicker {...props.modelPicker} />
        </Show>
        <ChatMenu
          remoteControl={props.remoteControl}
          files={props.files}
          browser={props.browser}
          tasks={props.tasks}
          onOpenSettings={props.onOpenSettings}
        />
      </div>
    </header>
  );
}

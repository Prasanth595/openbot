import type { AgentTask } from "@openbot/contracts/ipc";
import { Button, buttonVariants, ChevronRight, Folder, PanelRight, Plus, Popover, Settings } from "@openbot/ui";
import { AgentTaskMark, agentTaskStatus, isAgentTaskActive } from "@openbot/ui/features/conversation/AgentTasks";
import { ComputerIcon, RemoteDesktopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";

export interface ChatMenuRemoteControl {
  enabled: boolean;
  active: boolean;
  visible: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}

export interface ChatMenuFiles {
  open: boolean;
  onToggle: () => void;
}

export interface ChatMenuBrowser {
  acting: boolean;
  agentName?: string;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

/** The tasks of the agent. Left out where the host keeps no tasks. */
export interface ChatMenuTasks {
  /** The open tasks first, then the newest closed ones. */
  tasks: readonly AgentTask[];
  onNew: () => void;
  onOpen: (taskId: string) => void;
}

export interface ChatMenuProps {
  remoteControl?: ChatMenuRemoteControl | undefined;
  files?: ChatMenuFiles | undefined;
  browser?: ChatMenuBrowser | undefined;
  tasks?: ChatMenuTasks | undefined;
  onOpenSettings: () => void;
}

/**
 * The one panel button of the chat header. Its menu opens the side panels and the agent settings,
 * then a new task and the open tasks, and keeps the closed tasks folded. The dots of the panels that
 * it replaced stay on the button.
 */
export function ChatMenu(props: ChatMenuProps) {
  const { t, format } = useText();
  const [open, setOpen] = createSignal(false);
  const [earlierOpen, setEarlierOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const openTasks = () => props.tasks?.tasks.filter((task) => task.state !== "closed") ?? [];
  const closedTasks = () => props.tasks?.tasks.filter((task) => task.state === "closed") ?? [];
  const running = () => openTasks().filter(isAgentTaskActive).length;
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  const browserLabel = (browser: ChatMenuBrowser) =>
    browser.acting
      ? t("conversation.header.browserActing", { name: browser.agentName ?? t("conversation.header.agentFallback") })
      : t(browser.open ? "conversation.header.hideComputer" : "conversation.header.openComputer");
  const closedNote = (task: AgentTask) =>
    format.date(new Date(task.closedAt ?? task.updatedAt), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <Popover.Root open={open()} onOpenChange={setOpen} placement="bottom-end" gutter={6}>
      <Popover.Trigger
        ref={(element: HTMLButtonElement) => {
          trigger = element;
        }}
        as="button"
        type="button"
        class={buttonVariants({
          variant: "ghost",
          class: [
            "header-panel-toggle chat-menu-trigger",
            { "computer-button-agent-active": props.browser?.acting === true },
          ],
        })}
        aria-label={
          running() > 0 ? t("conversation.header.menuRunning", { count: running() }) : t("conversation.header.menu")
        }
      >
        <PanelRight aria-hidden="true" class="size-[14px]" />
        <Show when={props.browser?.acting}>
          <span class="computer-control-dot" aria-hidden="true" />
        </Show>
        <Show when={!props.browser?.acting && props.remoteControl?.active}>
          <span class="remote-desktop-button-dot" aria-hidden="true" />
        </Show>
        <Show when={!props.browser?.acting && !props.remoteControl?.active && running() > 0}>
          <span class="agent-tasks-trigger-dot" aria-hidden="true" />
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface account-popover agent-tasks-popover">
          <Popover.Title class="sr-only">{t("conversation.header.menu")}</Popover.Title>
          <section class="account-menu-group" aria-label={t("conversation.header.panels")}>
            <Show when={props.browser}>
              {(browser) => (
                <Button
                  variant="ghost"
                  type="button"
                  class="account-menu-row"
                  disabled={browser().disabled}
                  aria-pressed={browser().open ? "true" : "false"}
                  onClick={() => choose(browser().onToggle)}
                >
                  <span class="agent-tasks-popover-glyph">
                    <ComputerIcon />
                  </span>
                  <span>{browserLabel(browser())}</span>
                </Button>
              )}
            </Show>
            <Show when={props.remoteControl}>
              {(control) => (
                <Button
                  variant="ghost"
                  type="button"
                  class="account-menu-row"
                  disabled={!control().enabled}
                  onClick={() =>
                    choose(() => {
                      if (trigger) control().onOpen(trigger);
                    })
                  }
                >
                  <span class="agent-tasks-popover-glyph">
                    <RemoteDesktopIcon />
                  </span>
                  <span>
                    {t(control().active ? "conversation.header.resumeRemote" : "conversation.header.openRemote")}
                  </span>
                </Button>
              )}
            </Show>
            <Show when={props.files}>
              {(files) => (
                <Button
                  variant="ghost"
                  type="button"
                  class="account-menu-row"
                  aria-pressed={files().open ? "true" : "false"}
                  onClick={() => choose(files().onToggle)}
                >
                  <Folder class="account-menu-icon" aria-hidden="true" />
                  <span>{t(files().open ? "conversation.header.hideFiles" : "conversation.header.showFiles")}</span>
                </Button>
              )}
            </Show>
            <Button variant="ghost" type="button" class="account-menu-row" onClick={() => choose(props.onOpenSettings)}>
              <Settings class="account-menu-icon" aria-hidden="true" />
              <span>{t("conversation.header.settings")}</span>
            </Button>
          </section>
          <Show when={props.tasks}>
            {(tasks) => (
              <>
                <div class="account-menu-separator" />
                <section class="account-menu-group" aria-labelledby="agent-tasks-menu-label">
                  <h3 id="agent-tasks-menu-label" class="agent-tasks-popover-label">
                    {t("conversation.tasks.title")}
                  </h3>
                  <Button variant="ghost" type="button" class="account-menu-row" onClick={() => choose(tasks().onNew)}>
                    <Plus class="account-menu-icon" aria-hidden="true" />
                    <span>{t("conversation.tasks.new")}</span>
                  </Button>
                  <For each={openTasks()} keyed={(task) => task.id}>
                    {(task) => (
                      <Button
                        variant="ghost"
                        type="button"
                        class="account-menu-row"
                        onClick={() => choose(() => tasks().onOpen(task().id))}
                      >
                        <AgentTaskMark task={task()} decorative />
                        <span class="agent-tasks-menu-title">{task().title}</span>
                        <small>{agentTaskStatus(task(), t)}</small>
                      </Button>
                    )}
                  </For>
                  <Show when={closedTasks().length > 0}>
                    <Button
                      variant="ghost"
                      type="button"
                      class="account-menu-row agent-tasks-disclosure"
                      aria-expanded={earlierOpen() ? "true" : "false"}
                      aria-controls="agent-tasks-earlier"
                      onClick={() => setEarlierOpen((value) => !value)}
                    >
                      <ChevronRight class="account-menu-icon" aria-hidden="true" />
                      <span>{t("conversation.tasks.earlier", { count: closedTasks().length })}</span>
                    </Button>
                  </Show>
                  <Show when={earlierOpen() && closedTasks().length > 0}>
                    <div id="agent-tasks-earlier" class="account-menu-group">
                      <For each={closedTasks()} keyed={(task) => task.id}>
                        {(task) => (
                          <Button
                            variant="ghost"
                            type="button"
                            class="account-menu-row"
                            onClick={() => choose(() => tasks().onOpen(task().id))}
                          >
                            <AgentTaskMark task={task()} />
                            <span class="agent-tasks-menu-title">{task().title}</span>
                            <small>{closedNote(task())}</small>
                          </Button>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </>
            )}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

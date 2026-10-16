import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  DropdownMenu,
  Folder,
  ListChecks,
  Maximize2,
  Minimize2,
  PanelRight,
  Plus,
  Settings,
  X,
} from "@openbot/ui";
import { ComputerIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

/** A pane of the side panel. Each open pane has a tab at the top of the panel. */
export type SidePanelPane = "browser" | "files" | "tasks" | "settings";

const PANE_LABELS: Record<SidePanelPane, AppTextKey> = {
  browser: "conversation.sidePanel.pane.browser",
  files: "conversation.sidePanel.pane.files",
  tasks: "conversation.sidePanel.pane.tasks",
  settings: "conversation.sidePanel.pane.settings",
};

/** The same glyphs as the rest of the app: the browser is the computer. */
function PaneIcon(props: { pane: SidePanelPane }): JSX.Element {
  switch (props.pane) {
    case "browser":
      return <ComputerIcon />;
    case "files":
      return <Folder aria-hidden="true" />;
    case "tasks":
      return <ListChecks aria-hidden="true" />;
    case "settings":
      return <Settings aria-hidden="true" />;
  }
}

export interface SidePanelToggleProps {
  open: boolean;
  /** The name of the agent that controls the browser now. */
  actingAgentName?: string | undefined;
  /** The number of tasks that run now. */
  running: number;
  onToggle: () => void;
}

/** The panel button at the end of the chat header. Its dots show browser control and running tasks. */
export function SidePanelToggle(props: SidePanelToggleProps) {
  const { t } = useText();
  const label = () => {
    if (props.actingAgentName !== undefined)
      return t("conversation.header.browserActing", { name: props.actingAgentName });
    if (props.open) return t("conversation.sidePanel.close");
    return props.running > 0
      ? t("conversation.sidePanel.openRunning", { count: props.running })
      : t("conversation.sidePanel.open");
  };
  return (
    <Button
      variant="ghost"
      type="button"
      class={[
        "header-panel-toggle side-panel-toggle",
        { "computer-button-agent-active": props.actingAgentName !== undefined },
      ]}
      aria-label={label()}
      title={label()}
      aria-pressed={props.open ? "true" : "false"}
      onClick={() => props.onToggle()}
    >
      <PanelRight aria-hidden="true" class="size-[14px]" />
      <Show when={props.actingAgentName !== undefined}>
        <span class="computer-control-dot" aria-hidden="true" />
      </Show>
      <Show when={props.actingAgentName === undefined && props.running > 0}>
        <span class="agent-tasks-trigger-dot" aria-hidden="true" />
      </Show>
    </Button>
  );
}

export interface SidePanelHeaderProps {
  /** The open panes, in tab order. */
  panes: readonly SidePanelPane[];
  selected: SidePanelPane | null;
  /** The panes that this chat can open. */
  available: readonly SidePanelPane[];
  maximized: boolean;
  onSelect: (pane: SidePanelPane) => void;
  onClose: (pane: SidePanelPane) => void;
  onToggleMaximized: () => void;
  onCollapse: () => void;
}

/**
 * The top row of the side panel: a tab for each open pane, then Add and Maximize. The tab icon is
 * also the close button of the tab; hover or focus shows its X. Add lists only the panes that are not
 * open, and goes away when all of them are.
 */
export function SidePanelHeader(props: SidePanelHeaderProps) {
  const { t } = useText();
  const closedPanes = () => props.available.filter((pane) => !props.panes.includes(pane));
  return (
    <div class="window-drag side-panel-header">
      <div class="side-panel-tabs">
        <For each={props.panes}>
          {(pane) => {
            const label = () => t(PANE_LABELS[pane]);
            const selected = () => props.selected === pane;
            return (
              <div class="side-panel-tab no-drag" data-selected={selected() ? "true" : undefined}>
                <Button
                  variant="ghost"
                  type="button"
                  class="side-panel-tab-close"
                  aria-label={t("conversation.sidePanel.closePane", { name: label() })}
                  title={t("conversation.sidePanel.closePane", { name: label() })}
                  onClick={() => props.onClose(pane)}
                >
                  <span class="side-panel-tab-icon">
                    <PaneIcon pane={pane} />
                  </span>
                  <X class="side-panel-tab-x" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  class="side-panel-tab-select"
                  aria-pressed={selected() ? "true" : "false"}
                  title={label()}
                  onClick={() => props.onSelect(pane)}
                >
                  <span class="side-panel-tab-label">{label()}</span>
                </Button>
              </div>
            );
          }}
        </For>
      </div>
      <div class="side-panel-actions no-drag">
        <Show when={props.panes.length > 0 && closedPanes().length > 0}>
          <DropdownMenu.Root placement="bottom-end" gutter={4}>
            <DropdownMenu.Trigger
              class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              aria-label={t("conversation.sidePanel.add")}
              title={t("conversation.sidePanel.add")}
            >
              <Plus aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <For each={closedPanes()}>
                  {(pane) => (
                    <DropdownMenu.Item class="side-panel-menu-item" onSelectAfterClose={() => props.onSelect(pane)}>
                      <PaneIcon pane={pane} />
                      {t(PANE_LABELS[pane])}
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </Show>
        <Show when={props.panes.length > 0}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t(props.maximized ? "conversation.sidePanel.restore" : "conversation.sidePanel.maximize")}
            title={t(props.maximized ? "conversation.sidePanel.restore" : "conversation.sidePanel.maximize")}
            aria-pressed={props.maximized ? "true" : "false"}
            onClick={() => props.onToggleMaximized()}
          >
            <Show when={props.maximized} fallback={<Maximize2 aria-hidden="true" />}>
              <Minimize2 aria-hidden="true" />
            </Show>
          </Button>
        </Show>
        {/* A maximized panel covers the chat header and its panel button, so Collapse takes its place. */}
        <Show when={props.maximized}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("conversation.sidePanel.close")}
            title={t("conversation.sidePanel.close")}
            onClick={() => props.onCollapse()}
          >
            <PanelRight aria-hidden="true" />
          </Button>
        </Show>
      </div>
    </div>
  );
}

/** With no open pane, the side panel lists the panes it can open. */
export function SidePanelLauncher(props: {
  available: readonly SidePanelPane[];
  onOpen: (pane: SidePanelPane) => void;
}) {
  const { t } = useText();
  return (
    <nav class="side-panel-launcher" aria-label={t("conversation.sidePanel.launcher")}>
      <For each={props.available}>
        {(pane) => (
          <Button variant="secondary" class="side-panel-launch" onClick={() => props.onOpen(pane)}>
            <PaneIcon pane={pane} />
            {t("conversation.sidePanel.openPane", { name: t(PANE_LABELS[pane]) })}
          </Button>
        )}
      </For>
    </nav>
  );
}

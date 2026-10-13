import type { GitHubConnectorStatus, MessagingPlatform, OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { Lock } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import {
  BitwardenConnectorPanel,
  type BitwardenConnectorPanelProps,
} from "@openbot/ui/features/settings/BitwardenConnectorPanel";
import { GitHubConnectorPanel } from "@openbot/ui/features/settings/GitHubConnectorPanel";
import {
  GitHubMark,
  type IntegrationStatus,
  OnePasswordMark,
  TelegramMark,
} from "@openbot/ui/features/settings/IntegrationLayout";
import { IntegrationsHub, type IntegrationsHubRow } from "@openbot/ui/features/settings/IntegrationsHub";
import { OnePasswordConnectorPanel } from "@openbot/ui/features/settings/OnePasswordConnectorPanel";
import {
  MessagingMark,
  messagingPlatformText,
  SlackIntegrationPanel,
  slackIntegrationState,
  slackOrchestrator,
  type WorkspacePlatform,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import {
  TelegramIntegrationPanel,
  telegramIntegrationState,
  telegramOrchestrator,
} from "@openbot/ui/features/settings/TelegramIntegrationPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Match, onSettled, Show, Switch } from "solid-js";
import type { DiscordConnectorController } from "./discord-connector";
import { type GitHubConnectorController, githubPanelProps } from "./github-connector";
import { type OnePasswordConnectorController, onePasswordPanelProps } from "./onepassword-connector";
import type { SlackConnectorController } from "./slack-connector";
import type { TelegramConnectorController } from "./telegram-connector";

type View = "hub" | "github" | "onepassword" | "bitwarden" | MessagingPlatform;

const PAGE_TITLE = {
  github: "connector.github.title",
  onepassword: "connector.onePassword.title",
  bitwarden: "connector.bitwarden.title",
  telegram: "connector.telegram.title",
  slack: messagingPlatformText("slack").title,
  discord: messagingPlatformText("discord").title,
} as const satisfies Record<Exclude<View, "hub">, string>;

/** The integration page on screen, so the dialog header reads `Connectors › GitHub`. */
export interface ConnectorsPanelDetail {
  title: string;
  back: () => void;
}

const GITHUB_STATUS = {
  disconnected: { status: "idle", label: "connector.github.statusNotSetUp" },
  pending: { status: "idle", label: "connector.github.statusConnecting" },
  connected: { status: "connected", label: "connector.github.statusConnected" },
  expired: { status: "attention", label: "connector.github.statusExpired" },
} as const satisfies Record<GitHubConnectorStatus["state"], { status: IntegrationStatus; label: string }>;

const ONEPASSWORD_STATUS = {
  disconnected: { status: "idle", label: "connector.onePassword.statusNotSetUp" },
  connecting: { status: "idle", label: "connector.onePassword.statusConnecting" },
  "choose-account": { status: "idle", label: "connector.onePassword.statusConnecting" },
  connected: { status: "connected", label: "connector.onePassword.statusConnected" },
} as const satisfies Record<OnePasswordConnectorStatus["state"], { status: IntegrationStatus; label: string }>;

/**
 * Server settings > Connectors: the list of the server's integrations, and the page of the one the
 * user opens. Each integration is passed only when the server has it. `hostName` names a joined server.
 */
export function ConnectorsPanel(props: {
  github?: GitHubConnectorController | undefined;
  onePassword?: OnePasswordConnectorController | undefined;
  bitwarden?: BitwardenConnectorPanelProps | undefined;
  slack?: SlackConnectorController | undefined;
  discord?: DiscordConnectorController | undefined;
  telegram?: TelegramConnectorController | undefined;
  agents: AgentProfile[];
  hostName?: string | undefined;
  /** Reports the open integration page, so the header shows a breadcrumb instead of a back row. */
  onDetailChange?: (detail: ConnectorsPanelDetail | null) => void;
}) {
  const { t } = useText();
  const [view, setView] = createSignal<View>("hub");
  /** The integration page on screen: the hub shows when the open integration is no longer passed. */
  const page = (): Exclude<View, "hub"> | null => {
    const open = view();
    if (open === "hub") return null;
    const controllers = {
      github: props.github,
      onepassword: props.onePassword,
      bitwarden: props.bitwarden,
      slack: props.slack,
      discord: props.discord,
      telegram: props.telegram,
    };
    return controllers[open] ? open : null;
  };
  // The dialog outlives this panel, so the cleanup clears a header that would name a page that is gone.
  createEffect(
    () => {
      const open = page();
      return open ? t(PAGE_TITLE[open]) : null;
    },
    (title) => {
      if (title === null) return;
      props.onDetailChange?.({ title, back: () => setView("hub") });
      return () => props.onDetailChange?.(null);
    },
  );
  // The Slack, Discord and Telegram states change on their own and main sends no event, so they are
  // read while the section shows.
  onSettled(() => props.slack?.watch());
  onSettled(() => props.discord?.watch());
  onSettled(() => props.telegram?.watch());
  /** The Slack or Discord page on screen, when this computer has that integration. */
  const openMessaging = () => {
    const platform = view();
    if (platform !== "slack" && platform !== "discord") return undefined;
    const controller = platform === "discord" ? props.discord : props.slack;
    return controller ? { platform, controller } : undefined;
  };

  const githubRow = (github: GitHubConnectorController): IntegrationsHubRow => {
    const status = github.status();
    const header = GITHUB_STATUS[status.state];
    const host = github.hostName();
    return {
      id: "github",
      name: t("connector.github.title"),
      logo: <GitHubMark />,
      status: header.status,
      statusLabel: t(header.label),
      summary:
        status.state === "connected"
          ? `@${status.login ?? ""}`
          : status.state === "expired"
            ? t("connector.github.expiredTitle")
            : host
              ? t("connector.github.descriptionHost", { host })
              : t("connector.github.description"),
      onOpen: () => setView("github"),
    };
  };
  const onePasswordRow = (onePassword: OnePasswordConnectorController): IntegrationsHubRow => {
    const status = onePassword.status();
    const header = ONEPASSWORD_STATUS[status.state];
    return {
      id: "onepassword",
      name: t("connector.onePassword.title"),
      logo: <OnePasswordMark />,
      status: header.status,
      statusLabel: t(header.label),
      summary:
        status.state === "connected" && status.loginCount !== null
          ? t("connector.onePassword.loginCount", { count: status.loginCount })
          : t("connector.onePassword.description"),
      onOpen: () => setView("onepassword"),
    };
  };
  const messagingRow = (
    platform: WorkspacePlatform,
    controller: SlackConnectorController | DiscordConnectorController,
  ): IntegrationsHubRow => {
    const text = messagingPlatformText(platform);
    const connections = controller.overview()?.connections ?? [];
    const state = slackIntegrationState(connections, props.agents, platform);
    const [connection] = connections;
    const orchestrator = connection ? slackOrchestrator(connection, props.agents) : null;
    const workspace = connection?.workspaceName;
    return {
      id: platform,
      name: t(text.title),
      logo: <MessagingMark platform={platform} />,
      status: state.status,
      statusLabel: t(state.label),
      summary:
        state.attention > 0
          ? t(text.attentionTitle, { count: state.attention })
          : workspace === undefined
            ? t(text.description)
            : orchestrator
              ? t(text.summaryConnected, { workspace })
              : t(text.summaryNoAgent, { workspace }),
      agents: orchestrator ? [orchestrator] : [],
      onOpen: () => setView(platform),
    };
  };
  const telegramRow = (telegram: TelegramConnectorController): IntegrationsHubRow => {
    const connections = telegram.overview()?.connections ?? [];
    const state = telegramIntegrationState(connections, props.agents);
    const orchestrator = telegramOrchestrator(connections, props.agents);
    const count = connections.length;
    return {
      id: "telegram",
      name: t("connector.telegram.title"),
      logo: <TelegramMark />,
      status: state.status,
      statusLabel: t(state.label),
      summary:
        state.attention > 0
          ? t("connector.telegram.attentionTitle", { count: state.attention })
          : count === 0
            ? t("connector.telegram.description")
            : orchestrator
              ? t("connector.telegram.summaryConnected", { count })
              : t("connector.telegram.summaryNoAgent", { count }),
      agents: orchestrator ? [orchestrator] : [],
      onOpen: () => setView("telegram"),
    };
  };
  const rows = () => {
    const list: IntegrationsHubRow[] = [];
    if (props.slack) list.push(messagingRow("slack", props.slack));
    if (props.discord) list.push(messagingRow("discord", props.discord));
    if (props.telegram) list.push(telegramRow(props.telegram));
    if (props.github) list.push(githubRow(props.github));
    if (props.onePassword) list.push(onePasswordRow(props.onePassword));
    if (props.bitwarden)
      list.push({
        id: "bitwarden",
        name: t("connector.bitwarden.title"),
        logo: <Lock />,
        status: props.bitwarden.status.connected ? "connected" : "idle",
        statusLabel: props.bitwarden.status.connected
          ? t("connector.bitwarden.connected")
          : t("connector.bitwarden.disconnected"),
        summary: t("connector.bitwarden.description"),
        onOpen: () => setView("bitwarden"),
      });
    return list;
  };

  return (
    <Switch fallback={<IntegrationsHub rows={rows()} hostName={props.hostName} />}>
      <Match when={view() === "github" && props.github}>
        {(github) => (
          <div class="integrations-hub">
            <GitHubConnectorPanel {...githubPanelProps(github())} />
          </div>
        )}
      </Match>
      <Match when={view() === "bitwarden" && props.bitwarden}>
        {(panel) => (
          <BitwardenConnectorPanel
            status={panel().status}
            busy={panel().busy}
            onConnect={(key) => panel().onConnect(key)}
            onDisconnect={() => panel().onDisconnect()}
          />
        )}
      </Match>
      <Match when={view() === "onepassword" && props.onePassword}>
        {(onePassword) => (
          <div class="integrations-hub">
            <OnePasswordConnectorPanel {...onePasswordPanelProps(onePassword())} />
          </div>
        )}
      </Match>
      <Match when={openMessaging()}>
        {(open) => (
          <div class="integrations-hub">
            <Show when={open().controller.overview()}>
              {(overview) => (
                <SlackIntegrationPanel
                  platform={open().platform}
                  agents={props.agents}
                  connections={overview().connections}
                  busy={open().controller.busy()}
                  models={open().controller.models()}
                  onConnectWorkspace={open().controller.connectWorkspace}
                  onDisconnectWorkspace={open().controller.disconnectWorkspace}
                  onReconnect={open().controller.reconnect}
                  onSetEnabled={open().controller.setEnabled}
                  onAddOrchestrator={open().controller.addOrchestrator}
                  hostName={props.hostName}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
      <Match when={view() === "telegram" && props.telegram}>
        {(telegram) => (
          <div class="integrations-hub">
            <Show when={telegram().overview()}>
              {(overview) => (
                <TelegramIntegrationPanel
                  agents={props.agents}
                  connections={overview().connections}
                  busy={telegram().busy()}
                  models={telegram().models()}
                  onConnectChat={telegram().connectChat}
                  onDisconnectChat={telegram().disconnectChat}
                  onReconnect={telegram().reconnect}
                  onSetEnabled={telegram().setEnabled}
                  onAddOrchestrator={telegram().addOrchestrator}
                  hostName={props.hostName}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}

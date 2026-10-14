import { Match, Switch } from "solid-js";
import type { TextValue } from "../../text";
import { BitwardenConnectorPanel, type BitwardenConnectorPanelProps } from "../settings/BitwardenConnectorPanel";
import { GITHUB_STATUS, GitHubConnectorPanel, type GitHubConnectorPanelProps } from "../settings/GitHubConnectorPanel";
import type { IntegrationStatus } from "../settings/IntegrationLayout";
import type { IntegrationAgent } from "../settings/IntegrationsHub";
import {
  ONEPASSWORD_STATUS,
  OnePasswordConnectorPanel,
  type OnePasswordConnectorPanelProps,
} from "../settings/OnePasswordConnectorPanel";
import {
  messagingPlatformText,
  SlackIntegrationPanel,
  type SlackIntegrationPanelProps,
  slackIntegrationState,
  slackOrchestrator,
} from "../settings/SlackIntegrationPanel";
import {
  TelegramIntegrationPanel,
  type TelegramIntegrationPanelProps,
  telegramIntegrationState,
  telegramOrchestrator,
} from "../settings/TelegramIntegrationPanel";

/**
 * The page of one connector, with its live state and actions. Server settings › Connectors and the
 * Marketplace app page show the same page. Read the props through getters, so the page follows them.
 */
export type ConnectorDetail =
  | { id: "github"; props: GitHubConnectorPanelProps }
  | { id: "onepassword"; props: OnePasswordConnectorPanelProps }
  | { id: "bitwarden"; props: BitwardenConnectorPanelProps }
  | { id: "slack" | "discord"; props: SlackIntegrationPanelProps }
  | { id: "telegram"; props: TelegramIntegrationPanelProps };

/** What a list of connectors shows for one connector: its status and one line about it. */
export interface ConnectorSummary {
  status: IntegrationStatus;
  statusLabel: string;
  summary: string;
  /** The agents that answer through the connector, when some agents do and the others do not. */
  agents?: IntegrationAgent[] | undefined;
}

export function connectorSummary(detail: ConnectorDetail, t: TextValue["t"]): ConnectorSummary {
  switch (detail.id) {
    case "github": {
      const status = detail.props.status;
      const header = GITHUB_STATUS[status.state];
      const host = detail.props.hostName;
      return {
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
      };
    }
    case "onepassword": {
      const status = detail.props.status;
      const header = ONEPASSWORD_STATUS[status.state];
      return {
        status: header.status,
        statusLabel: t(header.label),
        summary:
          status.state === "connected" && status.loginCount !== null
            ? t("connector.onePassword.loginCount", { count: status.loginCount })
            : t("connector.onePassword.description"),
      };
    }
    case "bitwarden": {
      const connected = detail.props.status.connected;
      return {
        status: connected ? "connected" : "idle",
        statusLabel: connected ? t("connector.bitwarden.connected") : t("connector.bitwarden.disconnected"),
        summary: t("connector.bitwarden.description"),
      };
    }
    case "slack":
    case "discord": {
      const { connections, agents } = detail.props;
      const text = messagingPlatformText(detail.id);
      const state = slackIntegrationState(connections, agents, detail.id);
      const [connection] = connections;
      const orchestrator = connection ? slackOrchestrator(connection, agents) : null;
      const workspace = connection?.workspaceName;
      return {
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
      };
    }
    case "telegram": {
      const { connections, agents } = detail.props;
      const state = telegramIntegrationState(connections, agents);
      const orchestrator = telegramOrchestrator(connections, agents);
      const count = connections.length;
      return {
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
      };
    }
  }
}

/** The page of the connector that `detail` names. */
export function ConnectorDetailPanel(props: { detail: ConnectorDetail }) {
  const github = () => (props.detail.id === "github" ? props.detail : undefined);
  const onePassword = () => (props.detail.id === "onepassword" ? props.detail : undefined);
  const bitwarden = () => (props.detail.id === "bitwarden" ? props.detail : undefined);
  const workspace = () => (props.detail.id === "slack" || props.detail.id === "discord" ? props.detail : undefined);
  const telegram = () => (props.detail.id === "telegram" ? props.detail : undefined);
  return (
    <Switch>
      <Match when={github()}>{(detail) => <GitHubConnectorPanel {...detail().props} />}</Match>
      <Match when={onePassword()}>{(detail) => <OnePasswordConnectorPanel {...detail().props} />}</Match>
      <Match when={bitwarden()}>{(detail) => <BitwardenConnectorPanel {...detail().props} />}</Match>
      <Match when={workspace()}>
        {(detail) => <SlackIntegrationPanel {...detail().props} platform={detail().id} />}
      </Match>
      <Match when={telegram()}>{(detail) => <TelegramIntegrationPanel {...detail().props} />}</Match>
    </Switch>
  );
}

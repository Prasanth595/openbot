import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";

/**
 * Every connector, in the order that Settings › Connectors and Marketplace › Apps show them. A
 * connector id is also its Marketplace app id, so an agent can suggest it in a conversation.
 */
export const CONNECTOR_IDS = ["slack", "discord", "telegram", "github", "onepassword", "bitwarden"] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export interface ConnectorDefinition {
  /**
   * The capability that lets a joined server run the connector for an owner or admin. Null when the
   * connector works only on the computer that runs OpenBot, because its app or browser runs there.
   */
  server: TeamCurrentCapability | null;
}

export const CONNECTORS: Readonly<Record<ConnectorId, ConnectorDefinition>> = {
  slack: { server: CONNECTORS_CAPABILITY },
  discord: { server: CONNECTORS_CAPABILITY },
  telegram: { server: CONNECTORS_CAPABILITY },
  github: { server: CONNECTORS_CAPABILITY },
  onepassword: { server: null },
  bitwarden: { server: null },
};

const CONNECTOR_ID_SET = new Set<string>(CONNECTOR_IDS);

export function isConnectorId(value: string): value is ConnectorId {
  return CONNECTOR_ID_SET.has(value);
}

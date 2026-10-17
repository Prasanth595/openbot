import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import { Button, Input, Lock, SettingsSection, Text } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { DetailHeader, ReadFailedAlert, UNKNOWN_STATUS } from "./IntegrationLayout";

export interface BitwardenConnectorPanelProps {
  status: BitwardenConnectorStatus;
  busy: boolean;
  onConnect: (sessionKey: string) => void;
  onDisconnect: () => void;
  /**
   * Why the last status read failed, when no newer status came. The state is not known: the page
   * shows the reason and Retry, not the session key form of a connection that may be there.
   */
  statusError?: string | null | undefined;
  /** Reads the status again. */
  onRetry?: (() => void) | undefined;
}

/** The status of the connection, as its page header and every list of connectors show it. */
export function bitwardenStatus(props: Pick<BitwardenConnectorPanelProps, "status" | "statusError">) {
  if (props.statusError) return UNKNOWN_STATUS;
  return props.status.connected
    ? ({ status: "connected", label: "connector.bitwarden.connected" } as const)
    : ({ status: "idle", label: "connector.bitwarden.disconnected" } as const);
}

export function BitwardenConnectorPanel(props: BitwardenConnectorPanelProps) {
  const { t } = useText();
  const [key, setKey] = createSignal("");
  const header = () => bitwardenStatus(props);
  return (
    <div class="onepassword-connector">
      <DetailHeader
        logo={<Lock />}
        name={t("connector.bitwarden.title")}
        subtitle={t("connector.bitwarden.description")}
        status={header().status}
        statusLabel={t(header().label)}
      />
      <Show when={props.statusError}>
        {(message) => <ReadFailedAlert message={message()} onRetry={props.onRetry} />}
      </Show>
      <Text variant="body-sm" tone="muted">
        {t("connector.bitwarden.scope")}
      </Text>
      <Text variant="body-sm" tone="muted">
        {t("connector.bitwarden.session")}
      </Text>
      {/* With the state not known, the page offers neither the session key form nor Disconnect. */}
      <Show when={!props.statusError}>
        <Show
          when={!props.status.connected}
          fallback={
            <Button type="button" variant="outline" onClick={() => props.onDisconnect()}>
              {t("connector.bitwarden.disconnect")}
            </Button>
          }
        >
          <SettingsSection title={t("connector.bitwarden.connect")} description={t("connector.bitwarden.setup")}>
            <form
              class="onepassword-connector-token"
              onSubmit={(event) => {
                event.preventDefault();
                const value = key().trim();
                if (!value || props.busy) return;
                setKey("");
                props.onConnect(value);
              }}
            >
              <Input
                type="password"
                autocomplete="off"
                spellcheck={false}
                aria-label={t("connector.bitwarden.sessionKey")}
                value={key()}
                onInput={(event) => setKey(event.currentTarget.value)}
              />
              <Button type="submit" loading={props.busy} disabled={!key().trim()}>
                {t("connector.bitwarden.connect")}
              </Button>
            </form>
            <Show when={props.busy}>
              <Button type="button" variant="ghost" onClick={() => props.onDisconnect()}>
                {t("common.cancel")}
              </Button>
            </Show>
          </SettingsSection>
        </Show>
      </Show>
    </div>
  );
}

import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { type BitwardenConnectorPort, bitwardenConnectorPort } from "./bitwarden-connector-port";
import { type ConnectorController, createConnectorActions, NO_WATCH } from "./connector-controller";

/**
 * The Bitwarden connection of this computer. Reads the status once and then follows main's
 * `changed` event. The page asks for a session key, so a card has no one-click connect.
 */
export function createBitwardenConnector(
  port: () => BitwardenConnectorPort = bitwardenConnectorPort,
): ConnectorController {
  const [status, setStatus] = createSignal<BitwardenConnectorStatus>({ connected: false });
  /** False until the first status read ends. Until then, the page does not show the default status. */
  const [read, setRead] = createSignal(false);
  /** Why the last status read failed, until a newer status comes. While it is set, the state is not known. */
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const actions = createConnectorActions("connector.bitwarden.actionFailed");
  /** Counts the statuses that came, so a failed read does not hide a status that came after it started. */
  let statuses = 0;
  const show = (next: BitwardenConnectorStatus) => {
    statuses += 1;
    setStatus(next);
    setStatusError(null);
  };

  const unsubscribe = port().onChanged((next) => {
    if (!actions.disposed()) show(next);
  });
  const reload = () => {
    const before = statuses;
    void port()
      .status()
      .then((next) => {
        if (!actions.disposed()) show(next);
      })
      .catch((error: unknown) => {
        if (actions.disposed() || before !== statuses) return;
        const { t, errorMessage } = currentText();
        setStatusError(errorMessage(error, t("connector.readFailed")));
      })
      .finally(() => {
        if (!actions.disposed()) setRead(true);
      });
  };
  onSettled(reload);
  onCleanup(unsubscribe);

  const run = (action: () => Promise<BitwardenConnectorStatus>) => actions.run(action, { done: show });

  return {
    id: "bitwarden",
    ready: read,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: NO_WATCH,
    detail: {
      id: "bitwarden",
      props: {
        get status() {
          return status();
        },
        get busy() {
          return actions.busy();
        },
        get statusError() {
          return statusError();
        },
        onRetry: reload,
        onConnect: (key) => run(() => port().connect(key)),
        onDisconnect: () => run(() => port().disconnect()),
      },
    },
  };
}

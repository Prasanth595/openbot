import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
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
  const actions = createConnectorActions("connector.bitwarden.actionFailed");

  const unsubscribe = port().onChanged((next) => {
    if (!actions.disposed()) setStatus(next);
  });
  const reload = () => {
    void port()
      .status()
      .then((next) => {
        if (!actions.disposed()) setStatus(next);
      })
      .catch(() => undefined);
  };
  onSettled(reload);
  onCleanup(unsubscribe);

  const run = (action: () => Promise<BitwardenConnectorStatus>) => actions.run(action, { done: setStatus });

  return {
    id: "bitwarden",
    ready: () => true,
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
        onConnect: (key) => run(() => port().connect(key)),
        onDisconnect: () => run(() => port().disconnect()),
      },
    },
  };
}

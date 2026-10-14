import { DISCONNECTED_ONEPASSWORD_CONNECTOR, type OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { type ConnectorController, createConnectorActions, NO_WATCH } from "./connector-controller";
import { type OnePasswordConnectorPort, onePasswordConnectorPort } from "./onepassword-connector-port";

/**
 * The 1Password connection of this computer. Reads the status once and then follows main's
 * `changed` event: the CLI waits for an approval in the 1Password app, and the login count arrives
 * after the vault is read. Call it inside a component: the subscription ends with that component.
 *
 * Cancel does not wait for another action: Connect waits for the CLI, and Cancel is the way out.
 * The page asks for the setup first, so a card has no one-click connect.
 */
export function createOnePasswordConnector(
  port: () => OnePasswordConnectorPort = onePasswordConnectorPort,
): ConnectorController {
  const [status, setStatus] = createSignal<OnePasswordConnectorStatus>(DISCONNECTED_ONEPASSWORD_CONNECTOR);
  const actions = createConnectorActions("connector.onePassword.actionFailed");

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

  const run = (action: () => Promise<OnePasswordConnectorStatus>, waits = true) =>
    actions.run(action, { waits, done: setStatus });

  // A failed check keeps the last status. The next focus or action checks again.
  const checkSetup = () => {
    void port()
      .checkSetup()
      .then((next) => {
        if (!actions.disposed()) setStatus(next);
      })
      .catch(() => undefined);
  };

  return {
    id: "onepassword",
    ready: () => true,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: NO_WATCH,
    detail: {
      id: "onepassword",
      props: {
        get status() {
          return status();
        },
        get busy() {
          return actions.busy();
        },
        // The user turns on the CLI integration in the 1Password app, outside this window.
        onWatchSetup: () => {
          checkSetup();
          window.addEventListener("focus", checkSetup);
          return () => window.removeEventListener("focus", checkSetup);
        },
        onCheckSetup: checkSetup,
        onInstallCli: () => run(() => port().installCli()),
        onOpenApp: () => {
          void port()
            .openApp()
            .catch(() => undefined);
        },
        onConnect: (accountId) => run(() => port().connect({ accountId })),
        onConnectWithToken: (token) => run(() => port().connectWithToken(token)),
        onCancel: () => run(() => port().cancel(), false),
        onDisconnect: () => run(() => port().disconnect()),
      },
    },
  };
}

import { DISCONNECTED_ONEPASSWORD_CONNECTOR, type OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { type ConnectorController, createConnectorActions, NO_WATCH } from "./connector-controller";
import { type OnePasswordConnectorPort, onePasswordConnectorPort } from "./onepassword-connector-port";

/**
 * The 1Password connection of this computer or of a joined server. Reads the status once and then
 * follows the port's `changed` event: the CLI waits for an approval in the 1Password app, and the
 * login count arrives after the vault is read. Call it inside a component: the subscription ends with
 * that component.
 *
 * Cancel does not wait for another action: Connect waits for the CLI, and Cancel is the way out.
 * The page asks for the setup first, so a card has no one-click connect. A joined server connects
 * with a token only, so its page checks no setup.
 */
export function createOnePasswordConnector(
  port: () => OnePasswordConnectorPort = onePasswordConnectorPort,
  /** The joined server whose connection this is, or undefined for this computer's. */
  hostName?: () => string | undefined,
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
        get hostName() {
          return hostName?.();
        },
        // The user turns on the CLI integration in the 1Password app, outside this window.
        onWatchSetup: () => {
          if (hostName) return () => undefined;
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

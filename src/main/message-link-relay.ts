// Links in a joined server's conversation that an agent printed. A sign-in page of the agent's CLI
// returns to a loopback address on the host, so this computer relays its callback (`sign-in-relay-v1`).

import { decodeSignInRelayFlow, relayableSignInLink } from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { SIGN_IN_RELAY_CAPABILITY, SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Cause, Effect, Fiber } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import type { ResponseDecoder } from "./remote-host-decoding";
import type { RemoteRequestInit } from "./remote-server-client";
import type { RemoteWorkflowError } from "./remote-service-effects";
import { type SignInRelayClient, signInRelayRemote } from "./sign-in-relay-client";

const logger = createOpenBotLogger("message-link-relay");

/** Opens an http or https link in the user's browser. Any other scheme is refused. */
export function openHttpLink(url: string, openExternal: (url: string) => Promise<void>): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(sourceText("error.app.externalLinkProtocol"));
  return openExternal(parsed.toString());
}

export interface MessageLinkRelayDependencies {
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
  relay: Pick<SignInRelayClient, "run">;
  /** Opens a link that is not a relayed sign-in, as `app.openUrl` does. */
  openUrl: (url: string) => Promise<void>;
}

export class MessageLinkRelay {
  readonly #dependencies: MessageLinkRelayDependencies;
  readonly #running = new Map<string, Fiber.Fiber<unknown, unknown>>();

  constructor(dependencies: MessageLinkRelayDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Opens a link of an agent of `serverId`. A sign-in page that the host relays opens once the host
   * accepted it, and its callback goes to the host. The host refuses a page that no message of
   * `agentId` holds; that error goes to the caller, because the page cannot finish on this computer.
   */
  async open(serverId: string, agentId: string, url: string): Promise<void> {
    const { remoteServers, relay, openUrl } = this.#dependencies;
    const page = relayableSignInLink(url);
    if (!page || !remoteServers.supportsCapability(serverId, SIGN_IN_RELAY_CAPABILITY)) return openUrl(url);
    const key = `link\n${serverId}\n${page}`;
    const previous = this.#running.get(key);
    this.#running.delete(key);
    if (previous) await Effect.runPromise(Fiber.interrupt(previous));
    const post = <T>(path: string, decoder: ResponseDecoder<T>, body: unknown) =>
      remoteServers.request(serverId, path, decoder, { method: "POST", body });
    const flow = await runCauseEffect(post(SIGN_IN_RELAY_ROUTES.linkStart, decodeSignInRelayFlow, { agentId, url }));
    const fiber = Effect.runFork(relay.run(key, signInRelayRemote(post, Effect.succeed(flow)), true));
    this.#running.set(key, fiber);
    fiber.addObserver((exit) => {
      if (this.#running.get(key) === fiber) this.#running.delete(key);
      if (exit._tag === "Failure" && !Cause.hasInterruptsOnly(exit.cause))
        logger.warn("A relayed sign-in link did not finish:", toLogValue(Cause.squash(exit.cause)));
    });
  }
}

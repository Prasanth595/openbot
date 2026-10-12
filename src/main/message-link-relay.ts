// Links in a joined server's conversation that an agent printed. A sign-in page of the agent's CLI
// returns to a loopback address on the host, so this computer relays its callback (`sign-in-relay-v1`).

import {
  decodeSignInRelayFlow,
  type McpSignInRelayPage,
  type McpTestResult,
  relayableSignInLink,
} from "@openbot/contracts/ipc";
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
  relay: Pick<SignInRelayClient, "run" | "paste">;
  /** Opens a link that is not a relayed sign-in, as `app.openUrl` does. */
  openUrl: (url: string) => Promise<void>;
}

export class MessageLinkRelay {
  readonly #dependencies: MessageLinkRelayDependencies;
  readonly #running = new Map<string, Fiber.Fiber<McpTestResult, RemoteWorkflowError>>();

  constructor(dependencies: MessageLinkRelayDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Opens a link of an agent of `serverId`. A sign-in page that the host relays opens once the host
   * accepted it, and its callback goes to the host. When this computer cannot take the callback, the
   * answer is the page that the renderer shows with a field for the address from the browser. A host
   * that cannot relay the link, such as for a member who is not an admin, gets the link opened as it is.
   */
  async open(serverId: string, agentId: string, url: string): Promise<McpSignInRelayPage | null> {
    const { remoteServers, relay, openUrl } = this.#dependencies;
    const page = relayableSignInLink(url);
    if (!page || !remoteServers.supportsCapability(serverId, SIGN_IN_RELAY_CAPABILITY)) {
      await openUrl(url);
      return null;
    }
    const key = linkKey(serverId, page);
    await this.#stop(key);
    const post = <T>(path: string, decoder: ResponseDecoder<T>, body: unknown) =>
      remoteServers.request(serverId, path, decoder, { method: "POST", body });
    const flow = await runCauseEffect(
      post(SIGN_IN_RELAY_ROUTES.linkStart, decodeSignInRelayFlow, { agentId, url }),
    ).catch((error: unknown) => {
      logger.warn("The host did not relay a sign-in link, so it opens as it is:", toLogValue(error));
      return null;
    });
    if (!flow) {
      await openUrl(url);
      return null;
    }
    const shown = await new Promise<McpSignInRelayPage | Error | null>((resolve) => {
      const fiber = Effect.runFork(
        relay.run(key, signInRelayRemote(post, Effect.succeed(flow)), { page, onWaiting: resolve }),
      );
      this.#running.set(key, fiber);
      fiber.addObserver((exit) => {
        if (this.#running.get(key) === fiber) this.#running.delete(key);
        if (exit._tag === "Success") return resolve(exit.value.error === null ? null : new Error(exit.value.error));
        if (!Cause.hasInterruptsOnly(exit.cause))
          logger.warn("A relayed sign-in link did not finish:", toLogValue(Cause.squash(exit.cause)));
        resolve(null);
      });
    });
    if (shown instanceof Error) throw shown;
    return shown?.pasteable && !shown.listening ? shown : null;
  }

  /** The address that the user pasted from the browser. Resolves when the sign-in ended well. */
  async paste(serverId: string, url: string, address: string): Promise<void> {
    const page = relayableSignInLink(url);
    const key = page && linkKey(serverId, page);
    const fiber = key ? this.#running.get(key) : undefined;
    if (!key || !fiber) throw new Error(sourceText("error.mcp.relayEnded"));
    this.#dependencies.relay.paste(key, address);
    const result = await runCauseEffect(Fiber.join(fiber));
    if (result.error !== null) throw new Error(result.error);
  }

  /** Ends the relayed sign-in of a link, and cancels it on the host. */
  async cancel(serverId: string, url: string): Promise<void> {
    const page = relayableSignInLink(url);
    if (page) await this.#stop(linkKey(serverId, page));
  }

  async #stop(key: string): Promise<void> {
    const fiber = this.#running.get(key);
    this.#running.delete(key);
    if (fiber) await Effect.runPromise(Fiber.interrupt(fiber));
  }
}

function linkKey(serverId: string, page: string): string {
  return `link\n${serverId}\n${page}`;
}

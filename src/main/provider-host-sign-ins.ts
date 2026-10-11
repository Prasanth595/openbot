// Provider sign-ins that an administrator starts on this host from another computer
// (`provider-host-sign-in-v1`).

import type { AgentProviderId, ProviderHostSignInStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Cause, Duration, Effect, Exit, Fiber, Option, Scope } from "effect";
import { providerLabel } from "../backend/agent/thread-items";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import { runCauseEffect } from "../backend/effect-boundary";

const logger = createOpenBotLogger("provider-host-sign-ins");

/** How long a finished sign-in still answers `status`, so the client that polls it reads the end. */
const RESULT_KEPT_MS = 60_000;
/** The bound of an error on the wire, as `provider-host-sign-in-v1` reads it. */
const ERROR_LIMIT = 2_000;

interface HostSignIn extends ProviderHostSignInStatus {
  /** The sign-in. `#finish` waits for it apart, so a cancel that interrupts it still ends the sign-in. */
  run?: Fiber.Fiber<void, { cause: unknown }>;
}

export interface ProviderHostSignInDependencies {
  service: Pick<AgentService, "signInProviderOnHost" | "cancelProviderSignIn">;
  browser: Pick<BrowserHost, "openPrivate" | "privateTab" | "close">;
}

/**
 * A provider sign-in for an administrator who is not at this computer.
 *
 * The provider's CLI prints a sign-in page, and the grant comes back to the CLI's loopback listener
 * on this host, which only a browser here can reach. So the page opens in a private tab of this
 * host's browser, and the administrator signs in through the live view of that tab. `start` returns
 * at once; the client reads `status` until the sign-in ends. One sign-in runs for each provider, as
 * on this computer: a second start replaces the first.
 */
export class ProviderHostSignIns {
  readonly #dependencies: ProviderHostSignInDependencies;
  readonly #signIns = new Map<AgentProviderId, HostSignIn>();
  readonly #scope = Scope.makeUnsafe();

  constructor(dependencies: ProviderHostSignInDependencies) {
    this.#dependencies = dependencies;
  }

  readonly start = Effect.fn("ProviderHostSignIns.start")(function* (
    this: ProviderHostSignIns,
    provider: AgentProviderId,
  ) {
    const signIn: HostSignIn = { tabId: null, result: null };
    this.#signIns.set(provider, signIn);
    const run = yield* Effect.forkIn(
      this.#dependencies.service.signInProviderOnHost(provider, (url) =>
        runCauseEffect(this.#show(provider, signIn, url)),
      ),
      this.#scope,
    );
    signIn.run = run;
    yield* Effect.forkIn(
      Fiber.await(run).pipe(Effect.flatMap((exit) => this.#finish(provider, signIn, resultOf(provider, exit)))),
      this.#scope,
    );
  }).bind(this);

  status(provider: AgentProviderId): ProviderHostSignInStatus {
    const signIn = this.#signIns.get(provider);
    if (!signIn) return { tabId: null, result: { error: endedText(provider) } };
    // Google can sign in through a popup; the live view follows it and returns when it closes.
    return { tabId: signIn.tabId && this.#dependencies.browser.privateTab(signIn.tabId), result: signIn.result };
  }

  readonly cancel = Effect.fn("ProviderHostSignIns.cancel")(function* (
    this: ProviderHostSignIns,
    provider: AgentProviderId,
  ) {
    // A sign-in that still waits for the provider to start has no CLI to stop yet. The interrupt
    // stops it before it opens a page.
    const run = this.#signIns.get(provider)?.run;
    if (run) yield* Fiber.interrupt(run);
    yield* this.#dependencies.service.cancelProviderSignIn(provider);
  }).bind(this);

  readonly close = Effect.fn("ProviderHostSignIns.close")(function* (this: ProviderHostSignIns) {
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);

  /** The page opens; a sign-in that a later one replaced or that already ended closes it again. */
  readonly #show = Effect.fn("ProviderHostSignIns.show")(function* (
    this: ProviderHostSignIns,
    provider: AgentProviderId,
    signIn: HostSignIn,
    url: string,
  ) {
    const tab = yield* this.#dependencies.browser.openPrivate(url);
    if (this.#signIns.get(provider) === signIn && signIn.result === null) {
      signIn.tabId = tab.id;
      return;
    }
    yield* this.#closeTab(tab.id);
  });

  readonly #finish = Effect.fn("ProviderHostSignIns.finish")(function* (
    this: ProviderHostSignIns,
    provider: AgentProviderId,
    signIn: HostSignIn,
    result: { error: string | null },
  ) {
    signIn.result = result;
    const tabId = signIn.tabId;
    signIn.tabId = null;
    if (tabId) yield* this.#closeTab(tabId);
    yield* Effect.sleep(Duration.millis(RESULT_KEPT_MS));
    if (this.#signIns.get(provider) === signIn) this.#signIns.delete(provider);
  });

  #closeTab(tabId: string) {
    return this.#dependencies.browser
      .close(tabId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("Unable to close a provider sign-in tab", { error: toLogValue(error) })),
        ),
      );
  }
}

function endedText(provider: AgentProviderId): string {
  return sourceText("error.provider.hostSignInEnded", { provider: providerLabel(provider) });
}

/** Every ending gives a result, so the client stops reading `status` and the tab closes. */
function resultOf(provider: AgentProviderId, exit: Exit.Exit<void, { cause: unknown }>): { error: string | null } {
  if (Exit.isSuccess(exit)) return { error: null };
  const failure = Cause.findErrorOption(exit.cause);
  return { error: failureText(provider, Option.isSome(failure) ? failure.value.cause : undefined) };
}

function failureText(provider: AgentProviderId, cause: unknown): string {
  return (cause instanceof Error ? cause.message : endedText(provider)).slice(0, ERROR_LIMIT);
}

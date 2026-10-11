import {
  type AgentProviderId,
  type AgentStatus,
  agentProviderDescriptor,
  type ProviderCodeLoginStart,
  type ProviderHostSignInStatus,
} from "@openbot/contracts/ipc";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, flush, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import type { ProviderCodeLoginApi, ProviderCodeLoginOpener } from "../../components/provider-code-login-api";

/** The computer that runs the providers: it issues the code, and a cancel goes to the same one. */
interface ProviderCodeLoginTarget {
  start: (provider: AgentProviderId) => Promise<ProviderCodeLoginStart>;
  /** Only a target that can start a `paste` sign-in has it. */
  submit?: (provider: AgentProviderId, code: string) => Promise<AgentStatus>;
  cancel: (provider: AgentProviderId) => Promise<AgentStatus>;
  /** A joined server that opens a provider's sign-in page in its own browser, for the providers it names. */
  hostSignIn?: ProviderHostSignInTarget;
}

/** How a joined server signs in a provider on a page in its own browser, and how this window shows it. */
interface ProviderHostSignInTarget {
  providers: readonly AgentProviderId[];
  /** The host, as its server row names it. */
  hostName: string;
  runtime: BrowserViewRuntime;
  clipboard: boolean;
  start: (provider: AgentProviderId) => Promise<void>;
  status: (provider: AgentProviderId) => Promise<ProviderHostSignInStatus>;
  cancel: (provider: AgentProviderId) => Promise<AgentStatus>;
}

/** How often the host is asked whether its sign-in page opened or the sign-in ended. */
const HOST_SIGN_IN_POLL_MS = 1_000;

export interface ProviderCodeLoginOptions {
  /** The status of the computer that runs the providers. It says how a sign-in ends. */
  agentStatus: () => AgentStatus;
  applyStatus: (status: AgentStatus) => void;
  /** Read when a sign-in starts. The cancel of that sign-in goes to the same target. */
  target: () => ProviderCodeLoginTarget;
  /** The providers the target signs in with a code. */
  providers: () => readonly AgentProviderId[];
  openVerificationUrl: (url: string) => void;
  /**
   * A connect attempt, for analytics: begun when a sign-in starts, failed through the function it
   * returns, and dropped when the user cancels.
   */
  connection?: {
    begin: (provider: AgentProviderId) => () => void;
    drop: (provider: AgentProviderId) => void;
  };
}

/**
 * The sign-in the user finishes on another device, for a provider whose descriptor offers one.
 *
 * Everything about how it ends arrives in the agent status, the same way a browser sign-in's
 * does, so this holds only what the status cannot say: which provider the open dialog belongs
 * to, and the code that provider issued. The code is a one-time handle and is meant to be read
 * out; nothing it is later traded for reaches the renderer.
 */
export function createProviderCodeLogin(options: ProviderCodeLoginOptions): ProviderCodeLoginApi {
  /** The provider whose code dialog is open, and the phase that dialog shows. */
  const [codeLoginProvider, setCodeLoginProvider] = createSignal<AgentProviderId | null>(null);
  const [codeLoginState, setCodeLoginState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
  const [codeLoginOpener, setCodeLoginOpener] = createSignal<ProviderCodeLoginOpener | null>(null);
  let codeLoginExpiry: number | undefined;
  /** Whether the provider has been seen working on the open code sign-in. */
  let codeLoginStarted = false;
  let codeLoginGeneration = 0;
  let codeLoginCancellation: Promise<void> = Promise.resolve();
  /** The computer that runs the open code sign-in. */
  let codeLoginTarget: ProviderCodeLoginTarget | undefined;

  async function startProviderCodeLogin(
    provider: AgentProviderId,
    opener: ProviderCodeLoginOpener | null,
  ): Promise<void> {
    const generation = ++codeLoginGeneration;
    clearCodeLoginExpiry();
    codeLoginStarted = false;
    // The code is issued by the computer the providers run on; the admin types it in the browser of
    // this one.
    const target = options.target();
    codeLoginTarget = target;
    setCodeLoginOpener(opener);
    setCodeLoginProvider(provider);
    setCodeLoginState({ phase: "starting" });
    const failConnection = options.connection?.begin(provider);
    try {
      // Cancellation emits a terminal status. Finish it before the next attempt can wait.
      await codeLoginCancellation;
      if (generation !== codeLoginGeneration) return;
      const host = target.hostSignIn;
      if (host?.providers.includes(provider)) {
        setCodeLoginState({ phase: "page", hostName: host.hostName, page: null });
        await host.start(provider);
        // A cancel sent while the start was on its way can reach the host first and find nothing to
        // stop. A newer sign-in of the same provider owns the host's sign-in now, so it stays.
        if (generation !== codeLoginGeneration) {
          if (codeLoginProvider() !== provider) void host.cancel(provider).catch(() => undefined);
          return;
        }
        await followHostSignIn(provider, host, generation);
        return;
      }
      const started = await target.start(provider);
      // A dialog the user closed while the provider was answering: the login was cancelled with
      // it, so there is nobody left to show a code to.
      if (generation !== codeLoginGeneration) return;
      if (started.kind === "connected") {
        const row = options.agentStatus().providers?.find((candidate) => candidate.id === provider);
        endProviderCodeLogin(provider, { kind: "connected", accountLabel: row?.email ?? null });
        return;
      }
      flush(() =>
        setCodeLoginState(
          started.kind === "paste" || started.kind === "link"
            ? { phase: started.kind, verificationUrl: started.verificationUrl, expiresAt: started.expiresAt }
            : {
                phase: "waiting",
                userCode: started.userCode,
                verificationUrl: started.verificationUrl,
                ...(started.verificationUrlComplete === undefined
                  ? {}
                  : { verificationUrlComplete: started.verificationUrlComplete }),
                expiresAt: started.expiresAt,
              },
        ),
      );
      // Main gives up on the same deadline and reports a failure, but the user is looking at a
      // countdown: when it reaches zero the screen has to say so without waiting for a round trip.
      codeLoginExpiry = window.setTimeout(
        () => {
          if (generation !== codeLoginGeneration) return;
          codeLoginExpiry = undefined;
          if (isWaitingPhase(codeLoginState())) endProviderCodeLogin(provider, { kind: "expired" });
        },
        Math.max(0, started.expiresAt - Date.now()),
      );
    } catch (error) {
      if (generation !== codeLoginGeneration) return;
      failConnection?.();
      endProviderCodeLogin(provider, {
        kind: "failed",
        message:
          error instanceof Error && error.message
            ? error.message
            : currentText().t("app.provider.connectFailedRetry", {
                name: agentProviderDescriptor(provider).displayName,
              }),
      });
    }
  }

  /**
   * Shows the host's page once it opens, and ends the dialog with the host's result. One request
   * cannot wait for a person to sign in, so the status is read until the sign-in ends.
   */
  async function followHostSignIn(
    provider: AgentProviderId,
    host: ProviderHostSignInTarget,
    generation: number,
  ): Promise<void> {
    while (generation === codeLoginGeneration) {
      const status = await host.status(provider).catch((error: unknown) => {
        // Nobody watches the page any more, so it must not stay open on the host until the deadline.
        // A newer sign-in of the same provider owns the host's sign-in now.
        if (generation === codeLoginGeneration) void host.cancel(provider).catch(() => undefined);
        throw error;
      });
      if (generation !== codeLoginGeneration) return;
      if (status.result) {
        if (status.result.error) {
          endProviderCodeLogin(provider, { kind: "failed", message: status.result.error });
        } else {
          const row = options.agentStatus().providers?.find((candidate) => candidate.id === provider);
          endProviderCodeLogin(provider, { kind: "connected", accountLabel: row?.email ?? null });
        }
        return;
      }
      const state = codeLoginState();
      const shown = state.phase === "page" ? (state.page?.tabId ?? null) : null;
      if (status.tabId !== shown)
        setCodeLoginState({
          phase: "page",
          hostName: host.hostName,
          page: status.tabId ? { runtime: host.runtime, tabId: status.tabId, clipboard: host.clipboard } : null,
        });
      await new Promise((resolve) => window.setTimeout(resolve, HOST_SIGN_IN_POLL_MS));
    }
  }

  /**
   * Sends the code a `paste` sign-in's page showed. The code is a credential: it goes to the
   * computer that runs the provider, and nothing here keeps it. How the sign-in ends arrives as a
   * status, as for a device code.
   */
  async function submitProviderCodeLogin(code: string): Promise<void> {
    const provider = codeLoginProvider();
    const state = codeLoginState();
    const target = codeLoginTarget;
    if (!provider || state.phase !== "paste" || state.submitting || !target?.submit) return;
    const generation = codeLoginGeneration;
    setCodeLoginState({
      phase: "paste",
      verificationUrl: state.verificationUrl,
      expiresAt: state.expiresAt,
      submitting: true,
    });
    try {
      const status = await target.submit(provider, code);
      if (generation !== codeLoginGeneration) return;
      flush(() => {
        setCodeLoginState({ phase: "verifying" });
        options.applyStatus(status);
      });
    } catch (error) {
      if (generation !== codeLoginGeneration) return;
      const { t, sourceText } = currentText();
      // A refused code keeps the dialog open, so the user can fix what they pasted.
      setCodeLoginState({
        ...state,
        submitting: false,
        error:
          error instanceof Error && error.message
            ? sourceText(error.message)
            : t("app.provider.connectFailedRetry", { name: agentProviderDescriptor(provider).displayName }),
      });
    }
  }

  /** Abandons the code sign-in and closes the dialog. The code stops working before this returns. */
  function cancelProviderCodeLogin(): void {
    const provider = codeLoginProvider();
    const generation = ++codeLoginGeneration;
    codeLoginStarted = false;
    clearCodeLoginExpiry();
    setCodeLoginProvider(null);
    const target = codeLoginTarget;
    if (!provider || !target) return;
    options.connection?.drop(provider);
    const cancel = target.hostSignIn?.providers.includes(provider) ? target.hostSignIn.cancel : target.cancel;
    codeLoginCancellation = cancel(provider)
      .then((status) => {
        if (generation === codeLoginGeneration) flush(() => options.applyStatus(status));
      })
      // The provider has already stopped waiting for the code in every case that fails here: a
      // login that was never started, or one that ended on its own while the dialog was open.
      .catch(() => undefined);
  }

  /**
   * Closes the dialog on an ending and says how it went in a notification.
   *
   * Not a last screen in the dialog: the user finished this sign-in on another device, so they
   * come back to an app that should already be theirs to use, not to a modal to dismiss. The
   * notification carries the retry, because "the code expired" with no way to ask for another
   * one is a dead end.
   */
  function endProviderCodeLogin(
    provider: AgentProviderId,
    outcome:
      | { kind: "connected"; accountLabel: string | null }
      | { kind: "expired" }
      | { kind: "failed"; message: string },
  ): void {
    codeLoginGeneration++;
    clearCodeLoginExpiry();
    codeLoginStarted = false;
    flush(() => setCodeLoginProvider(null));
    const opener = codeLoginOpener();
    const name = agentProviderDescriptor(provider).displayName;
    const { t, sourceText } = currentText();
    if (outcome.kind === "connected") {
      actionToast.success(t("app.provider.connected", { name }), {
        description: outcome.accountLabel
          ? t("app.provider.signedInAs", { account: outcome.accountLabel })
          : t("app.provider.signedInElsewhere"),
      });
      return;
    }
    const retry = { label: t("app.provider.newCode"), onClick: () => void startProviderCodeLogin(provider, opener) };
    if (outcome.kind === "expired") {
      actionToast.warning(t("app.provider.codeExpired", { name }), {
        ...{
          description: t("app.provider.codeExpiredDescription"),
          action: retry,
        },
        report: { operation: "provider", source: "action", cause_code: "unknown" },
      });
      return;
    }
    actionToast.error(t("app.provider.connectFailed", { name }), {
      ...{
        description: sourceText(outcome.message),
        action: { ...retry, label: t("common.tryAgain") },
      },
      report: { operation: "provider", source: "action", cause_code: "unknown" },
    });
  }

  function clearCodeLoginExpiry(): void {
    if (codeLoginExpiry === undefined) return;
    window.clearTimeout(codeLoginExpiry);
    codeLoginExpiry = undefined;
  }

  /**
   * How a code sign-in ends: the provider's own status, which is what a browser sign-in reports
   * too. An account means it worked; anything else that stops the connect means it did not.
   *
   * The row has to be seen working on this login before its end is read out of it. A provider the
   * user is already signed in to is `available` from the start, and taking that for the finish
   * reported success as soon as the code appeared: nobody asking for a second account ever got to
   * type one.
   */
  createEffect(
    () => {
      const provider = codeLoginProvider();
      // The phase belongs in here rather than in the callback: a reactive read in an effect
      // callback is not tracked, so a dialog that reached `waiting` after the status did would
      // never be told about it.
      if (provider === null || !isWaitingPhase(codeLoginState())) return null;
      return options.agentStatus().providers?.find((row) => row.id === provider) ?? null;
    },
    (row) => {
      if (!row) return;
      if (row.connectionState === "connecting") {
        codeLoginStarted = true;
        return;
      }
      if (!codeLoginStarted) return;
      codeLoginStarted = false;
      if (row.state === "available" && !row.message) {
        endProviderCodeLogin(row.id, { kind: "connected", accountLabel: row.email ?? null });
      } else {
        endProviderCodeLogin(row.id, {
          kind: "failed",
          message:
            row.message ??
            currentText().t("app.provider.connectFailedRetry", {
              name: agentProviderDescriptor(row.id).displayName,
            }),
        });
      }
    },
  );

  onCleanup(() => {
    codeLoginGeneration++;
    clearCodeLoginExpiry();
  });

  return {
    providers: options.providers,
    provider: codeLoginProvider,
    state: codeLoginState,
    opener: codeLoginOpener,
    start: (provider, opener) => void startProviderCodeLogin(provider, opener ?? null),
    submit: (code) => void submitProviderCodeLogin(code),
    cancel: cancelProviderCodeLogin,
    openVerificationUrl: options.openVerificationUrl,
  };
}

/** A phase in which the provider can end the sign-in: a code or a page is out, or a code was sent. */
function isWaitingPhase(state: ProviderCodeLoginState): boolean {
  return (
    state.phase === "waiting" ||
    state.phase === "paste" ||
    state.phase === "link" ||
    state.phase === "page" ||
    state.phase === "verifying"
  );
}

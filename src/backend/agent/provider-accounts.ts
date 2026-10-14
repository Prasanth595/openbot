import { spawn } from "node:child_process";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import {
  type AccountUsage,
  type AccountUsageLimit,
  agentProviderDescriptor,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  MAX_PROVIDER_ACCOUNTS,
  type ProviderAccountState,
  type ProviderAccountStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Cause, Effect, Fiber, Schema, type Scope } from "effect";
import type { AgentClient } from "./../agent-client";
import type { AgentCliInfo } from "./../cli";
import type { AccountReadResult } from "./../protocol";
import { ProviderSignInError } from "../provider-client-effects";
import { type ProviderAccountSupport, requireProviderDriver } from "./../provider-drivers";
import { shortenDiagnostic } from "./../stderr-diagnostics";
import { stopProcessTree } from "../windows-process-tree";
import { captureBrowser } from "./browser-capture";
import type { ProviderAccountStore, StoredProviderAccount } from "./provider-account-store";
import { waitForSuccessfulProcess } from "./provider-status";
import { providerLabel } from "./thread-items";

const logger = createOpenBotLogger("provider-accounts");

/**
 * How long an account check or a usage reading stays good. The dock asks for usage every five
 * minutes, and each reading of an account with no running agent starts a short process.
 */
const ACCOUNT_CHECK_TTL_MS = 5 * 60_000;

export class ProviderAccountFailed extends Schema.TaggedError<ProviderAccountFailed>()("ProviderAccountFailed", {
  cause: Schema.Defect(),
}) {}

function accountFailure(text: string): ProviderAccountFailed {
  return new ProviderAccountFailed({ cause: new Error(text) });
}

interface AccountState {
  state: ProviderAccountState;
  email: string | null;
  message: string | null;
  checkedAt: number;
}

/** What the accounts need from the provider runtime. */
export interface ProviderAccountsHost {
  scope(): Scope.Scope;
  /** The CLI of the provider's own sign-in, or undefined when it is not connected. */
  cli(provider: AgentProviderId): AgentCliInfo | undefined;
  defaultEmail(provider: AgentProviderId): string | null;
  /** Starts and checks a client that signs in to the account's folder. The caller stops it. */
  authenticate(
    provider: AgentProviderId,
    cli: AgentCliInfo,
    accountEnvironment: Readonly<Record<string, string>>,
  ): Effect.Effect<{ client: AgentClient; account: NonNullable<AccountReadResult["account"]> }, ProviderAccountFailed>;
  stopClient(client: AgentClient): Effect.Effect<void>;
  /** The running process of an agent on this account, if there is one. */
  agentClient(provider: AgentProviderId, accountId: string): AgentClient | null;
  stopAgentClients(provider: AgentProviderId, accountId: string): Effect.Effect<void>;
  readUsage(client: AgentClient, model?: string): Effect.Effect<AccountUsage, ProviderAccountFailed>;
  changed(): void;
  redact(text: string): string;
}

/**
 * The provider accounts after the first: their sign-in, check, usage and removal. Each one signs in
 * to a folder of its own, with the same CLI as the provider's own sign-in. An agent on one of them
 * runs on its own process; the provider runtime starts that process with `environment`.
 */
export class ProviderAccounts {
  readonly #store: ProviderAccountStore;
  readonly #host: ProviderAccountsHost;
  readonly #states = new Map<string, AccountState>();
  readonly #signIns = new Map<string, Fiber.Fiber<string | null>>();
  /** Accounts whose first sign-in runs. A cancel removes them with their folder. */
  readonly #added = new Set<string>();
  readonly #checks = new Map<string, Fiber.Fiber<void>>();
  readonly #usage = new Map<string, { limit: AccountUsageLimit; at: number }>();

  constructor(store: ProviderAccountStore, host: ProviderAccountsHost) {
    this.#store = store;
    this.#host = host;
  }

  static support(provider: AgentProviderId): ProviderAccountSupport | undefined {
    return provider === "acp" ? undefined : requireProviderDriver(provider).accounts;
  }

  /** The stored account an agent names, or null for the provider's own sign-in or a removed account. */
  account(provider: AgentProviderId, accountId: string | undefined): StoredProviderAccount | null {
    if (!accountId || accountId === DEFAULT_PROVIDER_ACCOUNT_ID || !ProviderAccounts.support(provider)) return null;
    return this.#store.get(provider, accountId);
  }

  /** The variable that points the CLI at the account's folder. */
  environment(account: StoredProviderAccount): Readonly<Record<string, string>> {
    const support = ProviderAccounts.support(account.provider);
    if (!support) throw new Error("Invalid provider account.");
    return { [support.homeVariable]: this.#store.home(account) };
  }

  /** The rows of a connected provider that can hold more than one account; its own sign-in first. */
  rows(provider: AgentProviderId, defaultEmail: string | null): ProviderAccountStatus[] | undefined {
    if (!ProviderAccounts.support(provider)) return undefined;
    return [
      {
        id: DEFAULT_PROVIDER_ACCOUNT_ID,
        label: this.#store.defaultLabel(provider),
        email: defaultEmail,
        state: "connected",
        message: null,
      },
      ...this.#store.list(provider).map((account) => {
        const state = this.#states.get(account.id);
        return {
          id: account.id,
          label: account.label,
          email: state?.email ?? null,
          state: state?.state ?? "checking",
          message: state?.message ?? null,
        };
      }),
    ];
  }

  /**
   * Signs an account in through the browser: a new one when `accountId` is null. Answers when the
   * sign-in starts, with the account and a wait for the sign-in's end: its error, or null. The
   * account row also reports how it ends. A new account that does not finish is removed with its
   * folder.
   */
  readonly connect = Effect.fn("ProviderAccounts.connect")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string | null,
    openExternal: (url: string) => Promise<void>,
    onHost: boolean,
  ) {
    const support = ProviderAccounts.support(provider);
    const name = providerLabel(provider);
    if (!support) return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    const cli = this.#host.cli(provider);
    if (!cli) return yield* accountFailure(sourceText("error.provider.accountNeedsConnection", { provider: name }));
    let account: StoredProviderAccount;
    const added = accountId === null;
    if (added) {
      const created = yield* this.#store
        .create(provider)
        .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
      if (!created)
        return yield* accountFailure(
          sourceText("error.provider.accountLimit", { provider: name, limit: MAX_PROVIDER_ACCOUNTS }),
        );
      account = created;
    } else {
      const stored = this.account(provider, accountId);
      if (!stored) return yield* accountFailure(sourceText("error.provider.accountNotFound", { provider: name }));
      account = stored;
    }
    yield* this.#interrupt(account.id);
    if (added) this.#added.add(account.id);
    this.#setState(account.id, { state: "connecting", message: null });
    const signIn = Effect.scoped(
      Effect.gen({ self: this }, function* () {
        const browser = onHost ? yield* captureBrowser(openExternal) : {};
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(cli.executable, [...support.signIn.argv], {
              cwd: process.cwd(),
              env: { ...process.env, ...support.signIn.env(cli), ...this.environment(account), ...browser },
              stdio: "ignore",
              shell: false,
              windowsHide: process.platform === "win32",
            }),
          ),
          (child) => stopProcessTree(child).pipe(Effect.ignore),
        );
        yield* waitForSuccessfulProcess(child, support.signIn.timeoutMs);
      }),
    ).pipe(
      Effect.andThen(this.#check(account)),
      Effect.onError((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              const message = this.#message(provider, Cause.squash(cause));
              logger.warn("A provider account did not sign in.", { provider, message });
              if (added) {
                // A sign-in that ended before its check failed can have left a credential outside the folder.
                yield* this.#signOut(account).pipe(Effect.ignore);
                yield* this.#store.remove(account).pipe(Effect.ignore);
                this.#forget(account.id);
                this.#host.changed();
                return;
              }
              this.#setState(account.id, { state: "error", message });
            }),
      ),
      Effect.as<string | null>(null),
      Effect.catch((error) => Effect.succeed(this.#message(provider, error))),
      Effect.ensuring(
        Effect.sync(() => {
          this.#signIns.delete(account.id);
          this.#added.delete(account.id);
        }),
      ),
    );
    const fiber = yield* signIn.pipe(Effect.forkIn(this.#host.scope(), { startImmediately: true }));
    // A sign-in that already ended has removed itself; do not hold its fiber.
    if (fiber.pollUnsafe() === undefined) this.#signIns.set(account.id, fiber);
    return { accountId: account.id, ended: Fiber.join(fiber) };
  }).bind(this);

  /**
   * Stops the sign-in of an account. A new account goes with its folder; one that was signed in
   * before is signed out.
   */
  readonly cancel = Effect.fn("ProviderAccounts.cancel")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
  ) {
    const account = this.account(provider, accountId);
    if (!account || !this.#signIns.has(accountId)) return;
    const added = this.#added.has(accountId);
    yield* this.#interrupt(accountId);
    if (!added) {
      this.#setState(accountId, { state: "signed-out", message: null });
      return;
    }
    yield* this.#signOut(account).pipe(Effect.ignore);
    yield* this.#store.remove(account).pipe(Effect.ignore);
    this.#forget(accountId);
    this.#host.changed();
  }).bind(this);

  readonly rename = Effect.fn("ProviderAccounts.rename")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
    label: string | null,
  ) {
    const name = providerLabel(provider);
    if (!ProviderAccounts.support(provider))
      return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    if (accountId !== DEFAULT_PROVIDER_ACCOUNT_ID && !this.account(provider, accountId))
      return yield* accountFailure(sourceText("error.provider.accountNotFound", { provider: name }));
    yield* this.#store
      .rename(provider, accountId, label)
      .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
    this.#host.changed();
  }).bind(this);

  /**
   * Stops the account's processes, signs it out, and removes its folder with the credentials in it.
   * The caller moves its agents to the provider's own sign-in first.
   */
  readonly remove = Effect.fn("ProviderAccounts.remove")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
  ) {
    const name = providerLabel(provider);
    if (accountId === DEFAULT_PROVIDER_ACCOUNT_ID)
      return yield* accountFailure(sourceText("error.provider.accountDefault", { provider: name }));
    const account = this.account(provider, accountId);
    if (!account) return yield* accountFailure(sourceText("error.provider.accountNotFound", { provider: name }));
    yield* this.#interrupt(account.id);
    yield* this.#host.stopAgentClients(provider, account.id);
    yield* this.#signOut(account);
    yield* this.#store
      .remove(account)
      .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
    this.#forget(account.id);
    this.#host.changed();
  }).bind(this);

  /** Checks each account of a provider whose own sign-in just connected, unless a check is recent. */
  checkAll(provider: AgentProviderId): Effect.Effect<void> {
    if (!ProviderAccounts.support(provider)) return Effect.void;
    const now = Date.now();
    return Effect.forEach(
      this.#store
        .list(provider)
        .filter(
          (account) =>
            !this.#signIns.has(account.id) &&
            !this.#checks.has(account.id) &&
            now - (this.#states.get(account.id)?.checkedAt ?? 0) >= ACCOUNT_CHECK_TTL_MS,
        ),
      (account) =>
        Effect.gen({ self: this }, function* () {
          const check = this.#check(account).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                const error = Cause.squash(cause);
                const signedOut = error instanceof ProviderSignInError || isSignInError(error);
                this.#setState(account.id, {
                  state: signedOut ? "signed-out" : "error",
                  message: signedOut
                    ? sourceText("error.provider.accountSignedOut", { provider: providerLabel(provider) })
                    : this.#message(provider, error),
                });
              }),
            ),
            Effect.ensuring(Effect.sync(() => this.#checks.delete(account.id))),
          );
          const fiber = yield* check.pipe(Effect.forkIn(this.#host.scope(), { startImmediately: true }));
          if (fiber.pollUnsafe() === undefined) this.#checks.set(account.id, fiber);
        }),
      { discard: true },
    );
  }

  /**
   * The usage of each connected account of a provider that reports usage. A kept reading answers
   * until it is five minutes old or a window resets; then an agent's process or a short check reads it.
   */
  readonly usage = Effect.fn("ProviderAccounts.usage")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    model: string | undefined,
  ) {
    const now = Date.now();
    const limits: AccountUsageLimit[] = [];
    for (const account of this.#store.list(provider)) {
      if (this.#states.get(account.id)?.state !== "connected") continue;
      const kept = this.#usage.get(account.id);
      if (kept && now - kept.at < ACCOUNT_CHECK_TTL_MS && !windowHasReset(kept.limit)) {
        limits.push(kept.limit);
        continue;
      }
      const limit = yield* this.#readUsage(account, model).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logger.warn("Could not read provider account usage.", {
              provider,
              message: this.#message(provider, error),
            });
            return kept?.limit ?? null;
          }),
        ),
      );
      if (limit) limits.push(limit);
    }
    return limits;
  }).bind(this);

  /** The reading of one account for the usage limit check: its agent's process, or the kept one. */
  readonly usageFor = Effect.fn("ProviderAccounts.usageFor")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
    model: string,
  ) {
    const client = this.#host.agentClient(provider, accountId);
    if (client) return yield* this.#host.readUsage(client, model);
    const kept = this.#usage.get(accountId);
    return { limits: kept ? [kept.limit] : [] } satisfies AccountUsage;
  }).bind(this);

  /** Starts a client in the account's folder, reads who it is and its usage, and stops it. */
  readonly #check = Effect.fn("ProviderAccounts.check")(function* (
    this: ProviderAccounts,
    account: StoredProviderAccount,
  ) {
    const provider = account.provider;
    const cli = this.#host.cli(provider);
    if (!cli)
      return yield* accountFailure(
        sourceText("error.provider.accountNeedsConnection", { provider: providerLabel(provider) }),
      );
    if (this.#states.get(account.id)?.state !== "connecting")
      this.#setState(account.id, { state: "checking", message: null });
    yield* Effect.acquireUseRelease(
      this.#host.authenticate(provider, cli, this.environment(account)),
      ({ client, account: signedIn }) =>
        Effect.gen({ self: this }, function* () {
          const email = signedIn.email ?? null;
          if (email && this.#emailTaken(provider, account.id, email))
            return yield* accountFailure(
              sourceText("error.provider.accountAlreadyAdded", { provider: providerLabel(provider) }),
            );
          this.#setState(account.id, { state: "connected", email, message: null });
          if (agentProviderDescriptor(provider).reportsUsage)
            yield* this.#storeUsage(account, yield* this.#host.readUsage(client, defaultUsageModel(provider))).pipe(
              Effect.ignore,
            );
        }),
      ({ client }) => this.#host.stopClient(client),
    );
  });

  readonly #readUsage = Effect.fn("ProviderAccounts.readUsage")(function* (
    this: ProviderAccounts,
    account: StoredProviderAccount,
    model: string | undefined,
  ) {
    const running = this.#host.agentClient(account.provider, account.id);
    if (running) return yield* this.#storeUsage(account, yield* this.#host.readUsage(running, model));
    const cli = this.#host.cli(account.provider);
    if (!cli) return null;
    return yield* Effect.acquireUseRelease(
      this.#host.authenticate(account.provider, cli, this.environment(account)),
      ({ client }) =>
        Effect.gen({ self: this }, function* () {
          return yield* this.#storeUsage(account, yield* this.#host.readUsage(client, model));
        }),
      ({ client }) => this.#host.stopClient(client),
    );
  });

  #storeUsage(account: StoredProviderAccount, usage: AccountUsage): Effect.Effect<AccountUsageLimit | null> {
    return Effect.sync(() => {
      const first = usage.limits[0];
      if (!first || (!first.primary && !first.secondary)) return null;
      const limit = { ...first, id: account.provider, accountId: account.id };
      this.#usage.set(account.id, { limit, at: Date.now() });
      return limit;
    });
  }

  /** Runs the CLI's sign-out in the account's folder, for a CLI that keeps a credential outside it. */
  readonly #signOut = Effect.fn("ProviderAccounts.signOut")(function* (
    this: ProviderAccounts,
    account: StoredProviderAccount,
  ) {
    const command = ProviderAccounts.support(account.provider)?.signOut;
    const cli = this.#host.cli(account.provider);
    if (!command || !cli) return;
    yield* Effect.scoped(
      Effect.gen({ self: this }, function* () {
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(cli.executable, [...command.argv], {
              cwd: process.cwd(),
              env: { ...process.env, ...command.env(cli), ...this.environment(account) },
              stdio: "ignore",
              shell: false,
              windowsHide: process.platform === "win32",
            }),
          ),
          (child) => stopProcessTree(child).pipe(Effect.ignore),
        );
        yield* waitForSuccessfulProcess(child, command.timeoutMs, "Provider sign-out");
      }),
    ).pipe(
      // The folder goes in any case; a credential the CLI kept elsewhere is the CLI's to clear.
      Effect.catch((error) =>
        Effect.sync(() =>
          logger.warn("A provider account did not sign out.", {
            provider: account.provider,
            message: this.#message(account.provider, error),
          }),
        ),
      ),
    );
  });

  #emailTaken(provider: AgentProviderId, accountId: string, email: string): boolean {
    const normalized = email.toLowerCase();
    if (this.#host.defaultEmail(provider)?.toLowerCase() === normalized) return true;
    return this.#store
      .list(provider)
      .some((other) => other.id !== accountId && this.#states.get(other.id)?.email?.toLowerCase() === normalized);
  }

  #interrupt(accountId: string): Effect.Effect<void> {
    const fibers = [this.#signIns.get(accountId), this.#checks.get(accountId)].filter((fiber) => fiber !== undefined);
    this.#signIns.delete(accountId);
    this.#checks.delete(accountId);
    return Fiber.interruptAll(fibers);
  }

  #forget(accountId: string): void {
    this.#states.delete(accountId);
    this.#usage.delete(accountId);
  }

  #setState(accountId: string, patch: Partial<Omit<AccountState, "checkedAt">>): void {
    const current = this.#states.get(accountId);
    this.#states.set(accountId, {
      state: patch.state ?? current?.state ?? "checking",
      email: patch.email !== undefined ? patch.email : (current?.email ?? null),
      message: patch.message !== undefined ? patch.message : (current?.message ?? null),
      checkedAt: patch.state === "connected" || patch.state === "signed-out" ? Date.now() : (current?.checkedAt ?? 0),
    });
    this.#host.changed();
  }

  /** A failure as the account row shows it: the CLI's own words, with every secret taken out. */
  #message(provider: AgentProviderId, error: unknown): string {
    const cause = error instanceof ProviderAccountFailed ? error.cause : error;
    const text = cause instanceof Error ? cause.message : String(cause);
    return shortenDiagnostic(this.#host.redact(text)) || providerLabel(provider);
  }
}

function isSignInError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    (error.cause instanceof ProviderSignInError || isSignInError(error.cause))
  );
}

export function defaultUsageModel(provider: AgentProviderId): string | undefined {
  return provider === "codex" ? undefined : agentProviderDescriptor(provider).defaultModel || undefined;
}

function windowHasReset(limit: AccountUsageLimit): boolean {
  const now = Date.now() / 1_000;
  return [limit.primary, limit.secondary].some((window) => window?.resetsAt != null && window.resetsAt <= now);
}

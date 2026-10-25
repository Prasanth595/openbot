import type { AgentModelOption } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentClient, AgentProvider } from "../agent-client";
import type { ProfileClients } from "./profile-clients";
import {
  type GenerationObserver,
  generateTextWithoutTools,
  makeToollessDirectory,
  ProfileGenerationFailed,
  removeToollessDirectory,
  startToolless,
  stopToolless,
  toollessTurn,
} from "./profile-generation";

/** How long a warm client waits for the next generation before it stops. */
const WARM_IDLE_MS = 5 * 60_000;

interface WarmClient {
  /** The provider's main client when this one started. A new main client means new settings. */
  readonly owner: AgentClient;
  readonly client: AgentClient;
  readonly cwd: string;
  busy: boolean;
  /** Stop after the current generation: the main client changed while this one was busy. */
  stale: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface WarmGenerationsOptions {
  /** The provider's main client, or null when the provider has none. */
  readonly ownerFor: (provider: AgentProvider) => AgentClient | null;
  readonly createClient: (provider: AgentProvider) => AgentClient;
  readonly profileClients: ProfileClients;
}

/**
 * Owns one started client without tools per provider, kept for `WARM_IDLE_MS` after a generation,
 * so that consecutive workflow model steps do not each start a provider process. Each generation
 * still starts a new ephemeral thread, so no step sees the text of another.
 *
 * A generation runs inside `ProfileClients`, so the busy limit and the OpenCode endpoint stop apply
 * to it. When the warm client is busy, a generation uses a one-time client instead.
 *
 * It never imports the agent service facade.
 */
export class WarmGenerations {
  readonly #options: WarmGenerationsOptions;
  readonly #warm = new Map<AgentProvider, WarmClient>();

  constructor(options: WarmGenerationsOptions) {
    this.#options = options;
  }

  readonly generate = Effect.fn("WarmGenerations.generate")(function* (
    this: WarmGenerations,
    provider: AgentProvider,
    model: AgentModelOption,
    prompt: string,
    observe?: GenerationObserver,
  ) {
    const owner = this.#options.ownerFor(provider);
    let warm = this.#warm.get(provider);
    if (warm && !warm.busy && (warm.owner !== owner || !warm.client.running)) {
      yield* this.#drop(provider, warm);
      warm = undefined;
    }
    if (!owner || warm?.busy) {
      const client = this.#options.createClient(provider);
      return yield* this.#options.profileClients.run(client, (cancelled) =>
        generateTextWithoutTools(client, model, prompt, cancelled, observe),
      );
    }
    const started = warm !== undefined;
    if (!warm) {
      const client = this.#options.createClient(provider);
      const cwd = yield* makeToollessDirectory();
      warm = { owner, client, cwd, busy: false, stale: false, timer: null };
      this.#warm.set(provider, warm);
    }
    const entry = warm;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.busy = true;
    const { text, threadId } = yield* this.#options.profileClients
      .run(entry.client, (cancelled) =>
        toollessTurn(
          entry.client,
          entry.cwd,
          model,
          prompt,
          started
            ? Effect.void
            : // Read before the process is spawned: an endpoint change finds no process to stop then.
              Effect.suspend(() =>
                cancelled()
                  ? Effect.fail(
                      new ProfileGenerationFailed({
                        cause: new Error(sourceText("error.agent.profileEndpointsChanged")),
                      }),
                    )
                  : startToolless(entry.client),
              ),
          observe,
        ),
      )
      // A failed or interrupted turn can leave the provider mid-turn. Start the next one clean.
      .pipe(Effect.onError(() => this.#drop(provider, entry)));
    entry.busy = false;
    if (entry.client.releaseThread) yield* entry.client.releaseThread(threadId).pipe(Effect.ignore);
    // Two first generations can each start a client; only the one in the map stays.
    if (entry.stale || !entry.client.running || this.#warm.get(provider) !== entry) yield* this.#drop(provider, entry);
    else this.#arm(provider, entry);
    return text;
  });

  /** Stops each warm client that started under `owner`, now or after its current generation. */
  readonly ownerStopped = Effect.fn("WarmGenerations.ownerStopped")(function* (
    this: WarmGenerations,
    owner: AgentClient,
  ) {
    for (const [provider, warm] of this.#warm) {
      if (warm.owner !== owner) continue;
      if (warm.busy) warm.stale = true;
      else yield* this.#drop(provider, warm);
    }
  });

  /** Stops the idle warm client of `provider`. A busy one is stopped through `ProfileClients`. */
  readonly stopIdle = Effect.fn("WarmGenerations.stopIdle")(function* (this: WarmGenerations, provider: AgentProvider) {
    const warm = this.#warm.get(provider);
    if (warm && !warm.busy) yield* this.#drop(provider, warm);
    else if (warm) warm.stale = true;
  });

  /** Stops every warm client and removes its directory, at shutdown. */
  readonly dispose = Effect.fn("WarmGenerations.dispose")(function* (this: WarmGenerations) {
    yield* Effect.forEach([...this.#warm], ([provider, warm]) => this.#drop(provider, warm), {
      concurrency: "unbounded",
      discard: true,
    });
  });

  #arm(provider: AgentProvider, warm: WarmClient): void {
    warm.timer = setTimeout(() => {
      warm.timer = null;
      if (this.#warm.get(provider) === warm && !warm.busy) Effect.runFork(this.#drop(provider, warm));
    }, WARM_IDLE_MS);
    warm.timer.unref?.();
  }

  #drop(provider: AgentProvider, warm: WarmClient): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#warm.get(provider) === warm) this.#warm.delete(provider);
      if (warm.timer) clearTimeout(warm.timer);
      warm.timer = null;
      return stopToolless(warm.client).pipe(
        Effect.ignore,
        Effect.andThen(removeToollessDirectory(warm.cwd).pipe(Effect.ignore)),
      );
    });
  }
}

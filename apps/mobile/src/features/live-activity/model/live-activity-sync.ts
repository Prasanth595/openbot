export interface LiveActivityInstance<Props> {
  /**
   * When iOS started the activity, in milliseconds, or `null` when the app does not know, as for one
   * that an older version started. iOS stops its updates 8 hours later.
   */
  readonly startedAt: number | null;
  update(props: Props, staleDate?: Date): Promise<void>;
  end(dismissalPolicy: "default" | "immediate"): Promise<void>;
  /** Calls `receive` with the push token of this activity, now and each time iOS changes it. */
  watchPushToken(receive: (token: string) => void): () => void;
}

export interface LiveActivityStarter<Props> {
  start(props: Props, staleDate?: Date): LiveActivityInstance<Props> | Promise<LiveActivityInstance<Props>>;
  getInstances(): LiveActivityInstance<Props>[];
}

/**
 * Keeps one Live Activity equal to the latest island state. ActivityKit calls run one at a time and
 * skip a state the activity already shows, because iOS limits how often an app can update it.
 */
export class LiveActivitySync<Props> {
  readonly #starter: LiveActivityStarter<Props>;
  readonly #onPushToken: (token: string | null, startedAt: number | null) => void;
  readonly #onChange: (change: "started" | "ended") => void;
  #activity: LiveActivityInstance<Props> | null = null;
  #stopWatch: (() => void) | null = null;
  /** The state the activity shows, or `null` when it is not known. */
  #shown: string | null;
  #running: Promise<void> | null = null;
  #pending: { props: Props | null; staleDate: Date | undefined; key: string; generation: number } | null = null;
  #generation = 0;
  #reset = false;

  /**
   * `onPushToken` receives the token the host updates the activity with and the start of the activity,
   * or `null` when there is no activity. `onChange` receives each start and end that the app makes.
   */
  constructor(
    starter: LiveActivityStarter<Props>,
    onPushToken: (token: string | null, startedAt: number | null) => void = () => undefined,
    onChange: (change: "started" | "ended") => void = () => undefined,
  ) {
    this.#starter = starter;
    this.#onPushToken = onPushToken;
    this.#onChange = onChange;
    // An activity from an earlier launch shows old state. Keep one to update and end the others.
    const [current = null, ...extra] = starter.getInstances();
    this.#setActivity(current);
    this.#shown = current ? null : stateKey(null, undefined);
    for (const activity of extra) void activity.end("immediate").catch(() => undefined);
  }

  /**
   * Shows `props`, or ends the activity when they are `null`. A `staleDate` tells iOS when to mark
   * the content out of date, because the app cannot update it while it is suspended.
   */
  show(props: Props | null, staleDate?: Date): Promise<void> {
    const key = stateKey(props, staleDate);
    if (
      (this.#running && this.#pending?.key === key) ||
      (!this.#running && !this.#pending && key === this.#shown && !this.#reset)
    ) {
      return this.#running ?? Promise.resolve();
    }
    if (props === null) {
      this.#generation += 1;
      this.#reset = true;
      // Stop old token callbacks before an update or an asynchronous start can finish.
      this.#stopWatch?.();
      this.#stopWatch = null;
      this.#onPushToken(null, null);
    }
    this.#pending = { props, staleDate, key, generation: this.#generation };
    return this.#running ?? this.#run();
  }

  /** The host updated or ended the activity while the app was away. */
  forget(): void {
    this.#shown = null;
  }

  #run(): Promise<void> {
    this.#running = this.#drain().then((complete) => {
      this.#running = null;
      // A caller can add work between the last await and this completion callback.
      // After a failed end, retain the instance and retry only on a new call.
      if (complete && (this.#pending || this.#reset)) return this.#run();
    });
    return this.#running;
  }

  async #drain(): Promise<boolean> {
    while (this.#pending || this.#reset) {
      try {
        if (this.#reset) {
          this.#reset = false;
          const activity = this.#activity;
          this.#shown = null;
          if (activity) {
            try {
              await activity.end("immediate");
            } catch {
              // An end can fail. Keep the instance so the next call can retry safely.
              this.#reset = true;
              return false;
            }
          }
          this.#setActivity(null);
          if (activity) this.#onChange("ended");
          continue;
        }
        const pending = this.#pending;
        this.#pending = null;
        if (!pending) continue;
        const { props, staleDate, key, generation } = pending;
        if (props === null) {
          this.#shown = key;
          continue;
        }
        if (key === this.#shown) continue;
        const activity = this.#activity;
        if (activity) {
          try {
            await activity.update(props, staleDate);
            if (generation === this.#generation) this.#shown = key;
            continue;
          } catch {
            // The user or the host can end the activity. Start again only for current work.
            this.#setActivity(null);
          }
        }
        if (generation !== this.#generation || this.#pending) continue;
        const created = await this.#starter.start(props, staleDate);
        if (generation !== this.#generation) {
          // Keep even a late instance until its end succeeds. It must not publish a token.
          this.#activity = created;
          this.#reset = true;
          continue;
        }
        this.#setActivity(created);
        this.#shown = key;
        this.#onChange("started");
      } catch {
        // iOS can refuse an update. Retry with the next state, without replaying old states.
        this.#shown = null;
      }
    }
    return true;
  }

  #setActivity(activity: LiveActivityInstance<Props> | null): void {
    this.#stopWatch?.();
    this.#stopWatch = null;
    this.#activity = activity;
    this.#onPushToken(null, null);
    if (activity) {
      this.#stopWatch = activity.watchPushToken((token) => {
        if (this.#activity === activity && !this.#reset) this.#onPushToken(token, activity.startedAt);
      });
    }
  }
}

function stateKey(props: unknown, staleDate: Date | undefined): string {
  return JSON.stringify([props, staleDate?.getTime() ?? null]);
}

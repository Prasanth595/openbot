export const LOCAL_AGENTS_PREFERENCE_KEY = "openbot.mobile.local-agents.v1";

export interface LocalAgentsPreferenceStorage {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
}

interface LocalAgentsPreferenceState {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly saving: boolean;
  readonly loadFailed: boolean;
}

export class LocalAgentsDisabledError extends Error {}

/** A device preference. It does not change a host, an agent or a saved conversation. */
export class LocalAgentsPreference {
  private state: LocalAgentsPreferenceState = { enabled: false, ready: false, saving: false, loadFailed: false };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;

  constructor(private readonly storage: LocalAgentsPreferenceStorage) {}

  snapshot = (): LocalAgentsPreferenceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  load(): Promise<void> {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.publish({ ...this.state, loadFailed: false });
    this.loading = this.storage
      .get(LOCAL_AGENTS_PREFERENCE_KEY)
      .then((stored) => {
        this.publish({ enabled: stored === null || stored === "true", ready: true, saving: false, loadFailed: false });
      })
      .catch((error: unknown) => {
        this.publish({ enabled: false, ready: false, saving: false, loadFailed: true });
        throw error;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  async save(enabled: boolean): Promise<void> {
    if (!this.state.ready || this.state.saving) throw new Error("The local agents setting is not ready to save.");
    const previous = this.state.enabled;
    // Disable before the write starts. Re-enable only after storage accepts the choice.
    this.publish({ enabled: previous && enabled, ready: true, saving: true, loadFailed: false });
    try {
      await this.storage.set(LOCAL_AGENTS_PREFERENCE_KEY, String(enabled));
      this.publish({ enabled, ready: true, saving: false, loadFailed: false });
    } catch (error) {
      this.publish({ enabled: previous, ready: true, saving: false, loadFailed: false });
      throw error;
    }
  }

  allowsServer(
    serverId: string,
    pairedHostId: string | undefined,
    preference: LocalAgentsPreferenceState = this.state,
  ): boolean {
    // Local is the paired computer, not an agent runtime on this phone. A read failure keeps it disabled.
    return serverId !== pairedHostId || (preference.ready && preference.enabled);
  }

  project<Server extends { id: string }, Agent extends { serverId: string }>(
    servers: readonly Server[],
    agents: readonly Agent[],
    selectedServerId: string | null,
    pairedHostId: string | undefined,
    preference: LocalAgentsPreferenceState = this.state,
  ): { servers: Server[]; agents: Agent[]; activeServerId: string | null } {
    const available = servers.filter((server) => this.allowsServer(server.id, pairedHostId, preference));
    const ids = new Set(available.map((server) => server.id));
    return {
      servers: available,
      agents: agents.filter((agent) => ids.has(agent.serverId)),
      activeServerId: selectedServerId && ids.has(selectedServerId) ? selectedServerId : (available[0]?.id ?? null),
    };
  }

  async request<T>(
    serverId: string,
    pairedHostId: string | undefined,
    send: () => Promise<T>,
    disabledMessage: string,
  ): Promise<T> {
    if (!this.allowsServer(serverId, pairedHostId)) throw new LocalAgentsDisabledError(disabledMessage);
    return send();
  }

  private publish(state: LocalAgentsPreferenceState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

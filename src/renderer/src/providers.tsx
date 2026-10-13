import {
  type AgentProviderId,
  type AgentStatus,
  agentProviderDescriptor,
  LOCAL_SERVER_ID,
} from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import { useAgents } from "./features/agents/agents-context";
import { conversationPort } from "./features/conversation/conversation-port";
import { hostCustomProvidersApi } from "./features/custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "./features/custom-providers/stores/custom-providers-store";
import { createProviderConnection } from "./features/provider-updates/provider-connection";
import { createProviderRuntimeStore } from "./features/provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "./features/provider-updates/remote-provider-runtimes";
import { remoteAdminServer, serverSupportsCapability } from "./features/servers/server-capabilities";
import { useServers } from "./features/servers/servers-context";
import { hostProviderKeyApi, providerKeyApi } from "./features/settings/provider-key-api";
import { usePlatform } from "./platform";
import { providersPort } from "./providers-port";
import { createSimpleContext } from "./simple-context";

/**
 * Coding providers (Codex, Claude, Grok) as two paths the renderer reconciles: managed
 * `providerRuntimes` snapshots from main, and the older installed-CLI sign-in state via
 * `AgentStatus`. Consumers pick handlers through `providerRuntimeDownloadsAvailable()`.
 * Nested under `agents` so the edge stays one-way; see docs/architecture/change-rules.md.
 */
const Providers = createSimpleContext({
  name: "Providers",
  init: () => {
    const { agentStatus, setAgentStatus } = useAgents();
    const { activeServer } = useServers();
    const { appInfo } = usePlatform();
    const [refreshingProviders, setRefreshingProviders] = createSignal(false);
    /**
     * A CLI the user installed themselves, and the version it reports. Only the agent status knows
     * this, and the runtime store needs it to offer that install the same update a managed runtime
     * gets. Updates install the managed copy without changing the system installation.
     */
    function systemCliVersion(provider: AgentProviderId): string | null {
      const row = agentStatus().providers?.find((candidate) => candidate.id === provider);
      return row?.cliSource === "system" ? (row.version ?? null) : null;
    }
    /**
     * The joined server whose host this window manages, when the account administers it and the host
     * serves `providers-v1`. A memo, not a value: the host's capabilities arrive after this mounts.
     */
    const providerAdminServerId = createMemo(() => remoteAdminServer(activeServer(), "providers-v1")?.id);
    const providerAdmin = () => providersPort().providerAdmin;
    const runtimes = createProviderRuntimeStore(
      createMemo(() => {
        const serverId = providerAdminServerId();
        return serverId ? remoteProviderRuntimes(providerAdmin, serverId) : providersPort().providerRuntimes;
      }),
      {
        systemCliVersion,
        isLocalServer: () => activeServer()?.kind === "local",
        managesRuntimes: () => activeServer()?.kind === "local" || providerAdminServerId() !== undefined,
      },
    );
    /** The provider keys of the computer the providers run on. */
    const providerKeys = createMemo(() => {
      const serverId = providerAdminServerId();
      return serverId ? hostProviderKeyApi(providerAdmin, serverId) : providerKeyApi;
    });
    /**
     * The host's own endpoints, for Settings. The machine-local list in `CustomProvidersProvider`
     * stays what the model picker reads.
     */
    const hostCustomProviders = createCustomProvidersStore(() => {
      const serverId = providerAdminServerId();
      return serverId ? hostCustomProvidersApi(providerAdmin, serverId) : undefined;
    });
    createEffect(providerAdminServerId, (serverId) => {
      // As for this computer's list: a failure leaves it empty, and nothing retries it from here.
      if (serverId) void hostCustomProviders.refreshCustomProviders().catch(() => undefined);
    });
    /** Connect attempts still waiting for the status that says how they ended. */
    const pendingProviderConnections = new Map<AgentProviderId, ReturnType<typeof desktopAnalytics.scope>>();
    /**
     * The status is the completion signal for every connect started here: main
     * answers `connect()` before the provider has finished coming up, so the
     * outcome arrives later, in a status this or an agent event applies.
     */
    function applyAgentStatus(status: AgentStatus): void {
      for (const provider of status.providers ?? []) {
        const analytics = pendingProviderConnections.get(provider.id);
        if (!analytics) continue;
        if (provider.state === "available") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "succeeded",
          });
        } else if (provider.state === "error") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "failed",
            failure_code: "connect_failed",
          });
        }
      }
      setAgentStatus(status);
    }

    function openProviderInstallGuide(provider: AgentProviderId): Promise<void> {
      const descriptor = agentProviderDescriptor(provider);
      if (descriptor.installGuideLink === null) {
        return Promise.reject(new Error(currentText().t("app.provider.included", { name: descriptor.displayName })));
      }
      return appPort().openExternal(descriptor.installGuideLink);
    }

    /**
     * Signs the user in to one provider, through that provider's own login: Codex opens a browser,
     * Claude and Grok run their CLI's OAuth command, and OpenCode is asked again. Every sign-in
     * entry point calls this - the composer notice, the model picker, onboarding and settings - so
     * none of them leaves the user to read a documentation page and sign in in a terminal.
     */
    async function connectProvider(provider: AgentProviderId): Promise<void> {
      if (refreshingProviders()) return;
      const analytics = beginProviderConnection(provider);
      try {
        const status = await providersPort().connectProvider(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        endFailedProviderConnection(provider, analytics);
        throw error;
      }
    }

    /** Ends a browser sign-in that Connect started. The provider then shows its state from before. */
    async function cancelProviderSignIn(provider: AgentProviderId): Promise<void> {
      const status = await providersPort().cancelProviderSignIn(provider);
      flush(() => applyAgentStatus(status));
    }

    /** Opens a connect attempt: the status that ends it is matched back to this scope by provider. */
    function beginProviderConnection(provider: AgentProviderId) {
      const analytics = desktopAnalytics.scope();
      pendingProviderConnections.set(provider, analytics);
      analytics.track("provider_action", { provider, action: "connect_started", result: "succeeded" });
      return analytics;
    }

    function endFailedProviderConnection(
      provider: AgentProviderId,
      analytics: ReturnType<typeof desktopAnalytics.scope>,
    ): void {
      pendingProviderConnections.delete(provider);
      analytics.track("provider_action", {
        provider,
        action: "connect_completed",
        result: "failed",
        failure_code: "connect_failed",
      });
    }

    async function refreshAgentProviders(): Promise<void> {
      if (refreshingProviders() || agentStatus().phase === "starting" || agentStatus().phase === "restarting") {
        return;
      }
      const analytics = desktopAnalytics.scope();
      setRefreshingProviders(true);
      try {
        const status = await providersPort().refreshAgentProviders();
        flush(() => applyAgentStatus(status));
        analytics.track("provider_action", { action: "refresh", result: "succeeded" });
      } catch (error) {
        analytics.track("provider_action", {
          action: "refresh",
          result: "failed",
          failure_code: "refresh_failed",
        });
        throw error;
      } finally {
        flush(() => setRefreshingProviders(false));
      }
    }

    /**
     * Restarts a provider of this computer after its turns end. A joined host has no such action:
     * its provider API has no restart, so the caller offers none there.
     */
    async function setProviderOn(provider: AgentProviderId, on: boolean): Promise<void> {
      const server = activeServer();
      if (server?.kind !== "local") return;
      const status = await providersPort().setProviderOn({ provider, on });
      if (activeServer()?.id === server.id) flush(() => applyAgentStatus(status));
    }

    async function restartProvider(provider: AgentProviderId): Promise<void> {
      await changeProviderRestart(provider, providersPort().restartProvider);
    }

    async function cancelProviderRestart(provider: AgentProviderId): Promise<void> {
      await changeProviderRestart(provider, providersPort().cancelProviderRestart);
    }

    /** A failed restart is also on the provider's status; this reports a request that main refused. */
    async function changeProviderRestart(
      provider: AgentProviderId,
      request: (provider: AgentProviderId) => Promise<AgentStatus>,
    ): Promise<void> {
      try {
        const status = await request(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        const { t, errorMessage } = currentText();
        const title = t("app.provider.restartFailed", { name: agentProviderDescriptor(provider).displayName });
        toast.error(title, {
          ...{ description: errorMessage(error, title) },
          report: { operation: "provider", source: "system", cause_code: classifyFailure(error) },
        });
      }
    }

    onSettled(() => {
      return () => {
        pendingProviderConnections.clear();
      };
    });

    /**
     * The provider sign-in as the one object its surfaces take. Onboarding, Settings, the composer
     * and the model picker all offer it, so each offers the same ways in.
     */
    const connection = createProviderConnection({
      agentStatus,
      applyStatus: applyAgentStatus,
      target: () => {
        const serverId = providerAdminServerId();
        return serverId
          ? {
              start: (provider) => providerAdmin().startCodeLogin(provider, serverId),
              submit: (provider, code) => providerAdmin().submitCodeLogin({ provider, code }, serverId),
              cancel: (provider) => providerAdmin().cancelCodeLogin(provider, serverId),
              hostSignIn: {
                hostName: activeServer()?.name ?? "",
                runtime: conversationPort().browser,
                clipboard: serverSupportsCapability(activeServer(), "browser-view-clipboard"),
                start: (provider) => providerAdmin().startHostSignIn(provider, serverId),
                status: (provider) => providerAdmin().hostSignInStatus(provider, serverId),
                cancel: (provider) => providerAdmin().cancelHostSignIn(provider, serverId),
              },
              relay: {
                hostName: activeServer()?.name ?? "",
                start: (provider) => providerAdmin().startRelaySignIn(provider, serverId),
                status: (provider) => providerAdmin().relaySignInStatus(provider, serverId),
                open: (provider) => providerAdmin().openRelaySignIn(provider, serverId),
                paste: (provider, address) => providerAdmin().pasteRelaySignIn({ provider, address }, serverId),
                cancel: (provider) => providerAdmin().cancelRelaySignIn(provider, serverId),
              },
            }
          : {
              start: (provider) => providersPort().startProviderCodeLogin(provider),
              submit: (provider, code) => providerAdmin().submitCodeLogin({ provider, code }, LOCAL_SERVER_ID),
              cancel: (provider) => providersPort().cancelProviderCodeLogin(provider),
            };
      },
      // A member of a joined server cannot connect its providers. This computer's own are connected here.
      place: () =>
        providerAdminServerId()
          ? { kind: "app-server", server: activeServer() }
          : activeServer()?.kind === "remote"
            ? null
            : { kind: "computer", platform: appInfo()?.platform },
      connectInBrowser: connectProvider,
      openVerificationUrl: (url) => void appPort().openUrl(url),
      analytics: {
        begin: (provider) => {
          const analytics = beginProviderConnection(provider);
          return () => endFailedProviderConnection(provider, analytics);
        },
        drop: (provider) => pendingProviderConnections.delete(provider),
      },
    });

    return {
      ...runtimes,
      providerAdminServerId,
      providerKeys,
      hostCustomProviders,
      refreshingProviders,
      applyAgentStatus,
      connectProvider,
      cancelProviderSignIn,
      connection,
      openProviderInstallGuide,
      refreshAgentProviders,
      setProviderOn,
      restartProvider,
      cancelProviderRestart,
    };
  },
});

export const ProvidersProvider = Providers.provider;
export const useProviders = Providers.use;

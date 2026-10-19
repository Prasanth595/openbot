import {
  HOST_MEMBER_UPDATE_CAPABILITY,
  memberUpdateRoute,
} from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_CAPABILITY, HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import type { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// The server name, logo, timezone, agent memory limit and app update of one server's host. On a
// joined server the request goes to the host. Identity, timezone, memory limit, settings,
// cancellation, and forced restarts require an owner or admin.
// Ordinary members can check and request an idle update through host-member-update-v1.

import {
  decodeHostAgentMemoryLimit,
  decodeHostTimezoneSettings,
  decodeHostUpdateStatus,
  type HostUpdateSettingsChange,
  type HostUpdateStatus,
  hostAgentMemoryLimit,
  LOCAL_SERVER_ID,
  type ServerSummary,
  UPDATE_RESTART_MODES,
  type UpdateHostIdentityInput,
  type UpdateRestartMode,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import {
  AGENT_MEMORY_LIMIT_CAPABILITY,
  AGENT_MEMORY_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { HOST_ADMIN_CAPABILITY, HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_TIMEZONE_CAPABILITY, HOST_TIMEZONE_ROUTES } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_UPDATE_CAPABILITY, HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentMemoryLimitSetting } from "../agent-memory-limit-preference-store";
import type { HostService } from "../host-service";
import { acceptEmpty, decodeHostReleaseStatusFromHost, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { parseServerTimezone, type ServerTimezonePreferenceStore } from "../server-timezone-preference-store";
import { parseAgentMemoryLimitPreference, parseHostUpdateSettings } from "./app-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { parseHostIdentity } from "./server-inputs";
import { withLocalHostSummary } from "./team-handlers";

interface HostAdminRemoteServers {
  list(): ServerSummary[];
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
  refreshIdentity(serverId: string): Effect.Effect<ServerSummary, RemoteWorkflowError>;
}

interface HostAdminIpcDependencies {
  host: Pick<HostService, "updateIdentity">;
  remoteServers: HostAdminRemoteServers;
  serverTimezone: Pick<ServerTimezonePreferenceStore, "get" | "set">;
  agentMemoryLimit: AgentMemoryLimitSetting;
}

/** The body of a `host-update-v1` route: `start` carries the mode, `settings` the switches. */
type HostUpdateBody = Record<string, never> | { restart: UpdateRestartMode } | HostUpdateSettingsChange;

export function hostAdminIpcHandlers({
  host,
  remoteServers,
  serverTimezone,
  agentMemoryLimit,
}: HostAdminIpcDependencies): Pick<IpcGroupHandlers, "hostAdmin"> {
  function remoteUpdate(serverId: string, route: string, body: HostUpdateBody): Promise<HostUpdateStatus> {
    const role = remoteServers.list().find((server) => server.id === serverId)?.role;
    const memberRoute = role === "member" && memberUpdateRoute(route);
    if (memberRoute && remoteServers.supportsCapability(serverId, HOST_MEMBER_UPDATE_CAPABILITY)) {
      return runCauseEffect(
        remoteServers.request(serverId, memberRoute, decodeHostUpdateStatus, { method: "POST", body: {} }),
      );
    }
    if (!remoteServers.supportsCapability(serverId, HOST_UPDATE_CAPABILITY))
      throw new Error(sourceText("error.team.hostUpdateUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostUpdateStatus, { method: "POST", body }));
  }
  function remoteTimezone(serverId: string, route: string, body: { timezone?: string | null }) {
    if (!remoteServers.supportsCapability(serverId, HOST_TIMEZONE_CAPABILITY))
      throw new Error(sourceText("error.team.hostTimezoneUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostTimezoneSettings, { method: "POST", body }));
  }
  function remoteMemoryLimit(serverId: string, route: string, body: { limit?: number }) {
    if (!remoteServers.supportsCapability(serverId, AGENT_MEMORY_LIMIT_CAPABILITY))
      throw new Error(sourceText("error.team.agentMemoryLimitUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostAgentMemoryLimit, { method: "POST", body }));
  }
  // This computer updates from Settings. The renderer shows the tab for a joined server only.
  const localUpdate = (): never => {
    throw new Error(sourceText("error.team.hostUpdateUnsupported"));
  };
  return {
    hostAdmin: {
      updateIdentity: scopedHandler(parseHostIdentity, {
        local: async (input) => {
          const status = await runCauseEffect(host.updateIdentity(input));
          const summary = withLocalHostSummary(remoteServers.list(), status).find(
            (server) => server.id === LOCAL_SERVER_ID,
          );
          if (!summary) throw new Error(sourceText("error.host.noServer"));
          return summary;
        },
        remote: async (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_ADMIN_CAPABILITY))
            throw new Error(sourceText("error.host.identityLocalOnly"));
          await runCauseEffect(
            remoteServers.request(serverId, HOST_ADMIN_ROUTES.identity, acceptEmpty, {
              method: "POST",
              body: wireIdentity(input),
            }),
          );
          // The host has published the change before it answered, so this reads the new name and logo.
          return runCauseEffect(remoteServers.refreshIdentity(serverId));
        },
      }),
      getReleaseStatus: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) =>
          remoteServers.supportsCapability(serverId, HOST_RELEASE_CAPABILITY)
            ? runCauseEffect(
                remoteServers.request(serverId, HOST_RELEASE_ROUTES.status, decodeHostReleaseStatusFromHost, {
                  method: "POST",
                  body: {},
                }),
              )
            : Promise.resolve(null),
      }),
      checkRelease: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_RELEASE_CAPABILITY)) return localUpdate();
          return runCauseEffect(
            remoteServers.request(serverId, HOST_RELEASE_ROUTES.check, decodeHostReleaseStatusFromHost, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      getUpdateStatus: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.status, {}),
      }),
      checkForUpdate: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.check, {}),
      }),
      startUpdate: scopedHandler(parseRestartMode, {
        local: localUpdate,
        remote: (restart, serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.start, { restart }),
      }),
      cancelUpdate: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.cancel, {}),
      }),
      setUpdateSettings: scopedHandler(parseHostUpdateSettings, {
        local: localUpdate,
        remote: (settings, serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.settings, settings),
      }),
      getTimezone: scopedQueryHandler({
        local: () => serverTimezone.get(),
        remote: (serverId) => remoteTimezone(serverId, HOST_TIMEZONE_ROUTES.settings, {}),
      }),
      setTimezone: scopedHandler(parseServerTimezone, {
        local: (timezone) => runCauseEffect(serverTimezone.set(timezone)),
        remote: (timezone, serverId) => remoteTimezone(serverId, HOST_TIMEZONE_ROUTES.update, { timezone }),
      }),
      getAgentMemoryLimit: scopedQueryHandler({
        local: () => hostAgentMemoryLimit(agentMemoryLimit.get()),
        remote: (serverId) => remoteMemoryLimit(serverId, AGENT_MEMORY_LIMIT_ROUTES.settings, {}),
      }),
      // The host checks the value against its own choices, so a remote limit is any positive count.
      setAgentMemoryLimit: scopedHandler(parseMemoryLimitCount, {
        local: async (limit) =>
          hostAgentMemoryLimit(await runCauseEffect(agentMemoryLimit.set(parseAgentMemoryLimitPreference({ limit })))),
        remote: (limit, serverId) => remoteMemoryLimit(serverId, AGENT_MEMORY_LIMIT_ROUTES.update, { limit }),
      }),
    },
  };
}

function wireIdentity(input: UpdateHostIdentityInput) {
  return {
    ...(input.serverName === undefined ? {} : { serverName: input.serverName }),
    ...(input.logo === undefined
      ? {}
      : {
          logo: input.logo
            ? { mimeType: input.logo.mimeType, data: Buffer.from(input.logo.bytes).toString("base64") }
            : null,
        }),
  };
}

function parseMemoryLimitCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("Agent memory limit is required.");
  return value;
}

function parseRestartMode(value: unknown): UpdateRestartMode {
  if (!isOneOf(UPDATE_RESTART_MODES, value)) throw new Error("A restart mode is required.");
  return value;
}

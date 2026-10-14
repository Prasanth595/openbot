import type { MessagingDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { MessagingApi } from "./messaging-connector";

/** The `connectors-v1` messaging requests to a joined server: main's, or the browser client's. */
export type HostMessagingApi = Pick<
  MessagingDesktopApi,
  "hostOverview" | "hostConnect" | "hostDisconnect" | "hostReconnect" | "hostSetEnabled" | "hostAddOrchestrator"
>;

/**
 * The connections of the joined server that `serverId` names (`connectors-v1`), through main or the
 * browser client's `host`. Each opens the connect page in this computer's browser. The orchestrator
 * starts on the host's default provider and model, so a choice is not sent.
 */
export function hostMessagingApi(
  serverId: () => string | undefined,
  host: () => HostMessagingApi = () => window.openbot.messaging,
): MessagingApi {
  const call = <T>(method: (api: HostMessagingApi, serverId: string) => Promise<T>) => {
    const id = serverId();
    if (!id) return Promise.reject(new Error(sourceText("error.team.connectorsUnsupported")));
    return method(host(), id);
  };
  return {
    overview: (platform) => call((api, id) => api.hostOverview({ platform }, id)),
    connect: (target) =>
      call((api, id) =>
        api.hostConnect({ platform: target.platform, place: target.platform === "telegram" ? target.place : null }, id),
      ),
    disconnect: (platform, workspaceId) => call((api, id) => api.hostDisconnect({ platform, workspaceId }, id)),
    reconnect: (platform, workspaceId) => call((api, id) => api.hostReconnect({ platform, workspaceId }, id)),
    setEnabled: (platform, workspaceId, enabled) =>
      call((api, id) => api.hostSetEnabled({ platform, workspaceId, enabled }, id)),
    addOrchestrator: (target) =>
      call((api, id) =>
        api.hostAddOrchestrator(
          { platform: target.platform, workspaceId: target.platform === "telegram" ? null : target.workspaceId },
          id,
        ),
      ),
  };
}

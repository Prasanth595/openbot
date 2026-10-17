import { useCallback, useMemo, useRef, useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  decodeDefaultServer,
  decodeServerOrder,
  defaultServerKey,
  serverOrderKey,
  sortServers,
} from "@/features/workspace/model/server-order";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { currentText } from "@/shared/lib/text";

function showOrderFailure(error: unknown): void {
  showFailureAlert(
    error,
    "settings",
    currentText().t("mobile.workspace.alert.serverOrderTitle"),
    currentText().t("mobile.workspace.alert.serverOrderBody"),
  );
}

/** The default server and the order of the other servers, saved on this device for the account. */
export function useServerOrder(
  apiUrl: string,
  userId: string,
  pairedHostId: string | undefined,
  servers: readonly MobileServer[],
) {
  const orderKey = serverOrderKey(apiUrl, userId);
  const storedServerOrder = useMemo(() => {
    try {
      return decodeServerOrder(LockedKeychain.getItem(orderKey));
    } catch {
      return [];
    }
  }, [orderKey]);
  const [savedServerOrder, setSavedServerOrder] = useState<{ key: string; ids: string[] } | null>(null);
  const serverOrder = savedServerOrder?.key === orderKey ? savedServerOrder.ids : storedServerOrder;
  const defaultKey = defaultServerKey(apiUrl, userId);
  const storedDefaultServer = useMemo(() => {
    try {
      return decodeDefaultServer(LockedKeychain.getItem(defaultKey), pairedHostId);
    } catch {
      return pairedHostId ?? null;
    }
  }, [defaultKey, pairedHostId]);
  const [savedDefaultServer, setSavedDefaultServer] = useState<{ key: string; id: string | null } | null>(null);
  const defaultServerId = savedDefaultServer?.key === defaultKey ? savedDefaultServer.id : storedDefaultServer;
  const orderedServers = useMemo(
    () => sortServers(servers, serverOrder, defaultServerId),
    [servers, serverOrder, defaultServerId],
  );
  const latest = useRef({ servers, serverOrder, defaultServerId, orderedServers });
  latest.current = { servers, serverOrder, defaultServerId, orderedServers };

  /** Sorts servers as the list shows them: the default server first, then the saved order. */
  const sortByPreference = useCallback(
    <T extends { id: string }>(list: readonly T[]) =>
      sortServers(list, latest.current.serverOrder, latest.current.defaultServerId),
    [],
  );

  /** Saves the order of the other servers. Returns false and keeps the old order on failure. */
  const reorderServers = useCallback(
    (serverIds: string[]) => {
      try {
        LockedKeychain.setItem(orderKey, JSON.stringify(serverIds));
        setSavedServerOrder({ key: orderKey, ids: serverIds });
        return true;
      } catch (error) {
        showOrderFailure(error);
        return false;
      }
    },
    [orderKey],
  );

  /** Makes a server the default in place of the current one, or removes it with `null`. */
  const setDefaultServer = useCallback(
    (serverId: string | null) => {
      const { servers: current, defaultServerId: currentDefault, orderedServers: ordered } = latest.current;
      const previous = current.some((server) => server.id === currentDefault) ? currentDefault : null;
      const listed = ordered
        .filter((server) => server.id !== currentDefault && server.id !== serverId)
        .map((server) => server.id);
      // The server that is no longer the default goes to the top of the list.
      const order = previous && previous !== serverId ? [previous, ...listed] : listed;
      try {
        LockedKeychain.setItem(orderKey, JSON.stringify(order));
        LockedKeychain.setItem(defaultKey, JSON.stringify(serverId));
        setSavedServerOrder({ key: orderKey, ids: order });
        setSavedDefaultServer({ key: defaultKey, id: serverId });
        return true;
      } catch (error) {
        showOrderFailure(error);
        return false;
      }
    },
    [orderKey, defaultKey],
  );

  return { serverOrder, defaultServerId, orderedServers, sortByPreference, reorderServers, setDefaultServer };
}

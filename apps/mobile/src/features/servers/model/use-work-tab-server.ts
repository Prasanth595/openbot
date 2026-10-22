import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

/** Consume a host link once; later tab visits follow the selected workspace. */
export function useWorkTabServer() {
  const { serverId: requestedServerId } = useLocalSearchParams<{ serverId?: string }>();
  const { activeServer, selectServer, servers } = useMobileWorkspace();
  useFocusEffect(
    useCallback(() => {
      if (!requestedServerId || !servers.some((server) => server.id === requestedServerId)) return;
      if (requestedServerId !== activeServer.id) selectServer(requestedServerId);
      router.setParams({ serverId: undefined });
    }, [activeServer.id, requestedServerId, selectServer, servers]),
  );
  return requestedServerId ?? activeServer.id;
}

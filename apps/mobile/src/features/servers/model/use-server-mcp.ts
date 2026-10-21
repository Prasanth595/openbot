import type { McpServerConfig, McpSignInState } from "@openbot/contracts/ipc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

/**
 * The MCP servers of one host, as the MCP and MCP server pages of the server sheet show them. The
 * pages use the same queries, so a change on one page shows on the other.
 */
export function useServerMcp(serverId: string) {
  const { servers, canManageMcpServers } = useMobileWorkspace();
  const { listMcpServers, listMcpSignIns } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canManage = canManageMcpServers(serverId);
  const locked = useRef(false);
  const listKey = queryKeys.mcpServers(queryScope, serverId);
  const signInsKey = queryKeys.mcpSignIns(queryScope, serverId);
  const list = useQuery({
    queryKey: listKey,
    enabled: canManage,
    retry: false,
    queryFn: () => listMcpServers(serverId),
  });
  // A badge only: a failed read shows no badge.
  const signIns = useQuery({
    queryKey: signInsKey,
    enabled: canManage,
    retry: false,
    queryFn: () => listMcpSignIns(serverId).catch((): McpSignInState[] => []),
  });
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSuccess: () => {
      void haptics.notification("success");
    },
    onError: () => {
      void haptics.notification("error");
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  return {
    server,
    canManage,
    list,
    signIns,
    action,
    /** The host answers each change with the whole list. A read still in flight has the old list. */
    async setList(configs: McpServerConfig[]): Promise<void> {
      await queryClient.cancelQueries({ queryKey: listKey, exact: true });
      queryClient.setQueryData(listKey, configs);
    },
    setSignIns(states: McpSignInState[]): void {
      queryClient.setQueryData(signInsKey, states);
    },
    /** Runs one change at a time. Resolves true when it succeeds. */
    perform(operation: () => Promise<void>): Promise<boolean> {
      if (locked.current) return Promise.resolve(false);
      locked.current = true;
      return action.mutateAsync(operation).then(
        () => true,
        () => false,
      );
    },
  };
}

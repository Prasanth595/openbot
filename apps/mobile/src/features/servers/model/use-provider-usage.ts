import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

/** Match desktop's five-minute quota refresh; host events update the cache between reads. */
const USAGE_REFRESH_MS = 5 * 60_000;

/** Read plan allowances only while provider settings are visible, with one shared host/account cache. */
export function useProviderUsage(serverId: string, admin: ProviderAdmin, visible = true) {
  const scope = useQueryScope();
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const enabled = visible && focused && foreground;
  const accountsSupported = admin.capabilities.includes(PROVIDER_ACCOUNTS_CAPABILITY);
  const usage = useQuery({
    queryKey: queryKeys.providerUsage(scope, serverId),
    queryFn: () => admin.readUsage(),
    enabled,
    retry: false,
    staleTime: USAGE_REFRESH_MS,
    refetchInterval: enabled ? USAGE_REFRESH_MS : false,
  });
  const accounts = useQuery({
    queryKey: queryKeys.providerAccountUsage(scope, serverId),
    queryFn: accountsSupported
      ? async () => {
          const [host, usage] = await Promise.all([admin.readAccounts(), admin.readAccountUsage()]);
          return { host, usage };
        }
      : skipToken,
    enabled: enabled && accountsSupported,
    retry: false,
    staleTime: USAGE_REFRESH_MS,
    refetchInterval: enabled && accountsSupported ? USAGE_REFRESH_MS : false,
  });
  return {
    usage,
    accounts,
    refreshing: usage.isFetching || accounts.isFetching,
    failed: usage.isError || (accountsSupported && accounts.isError),
    refresh: () => {
      void usage.refetch();
      if (accountsSupported) void accounts.refetch();
    },
  };
}

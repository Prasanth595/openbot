import {
  type AccountUsage,
  type AccountUsageWindow,
  type AgentProviderId,
  type AgentProviderStatus,
  agentProviderName,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type HostProviderAccounts,
  isAgentProvider,
} from "@openbot/contracts/ipc";

export interface ProviderAllowance {
  provider: AgentProviderId;
  accountId: string;
  name: string;
  account: string | null;
  accountNumber: number | null;
  windows: ProviderAllowanceWindow[];
}

interface ProviderAllowanceWindow extends AccountUsageWindow {
  id: "primary" | "secondary";
}

/** The same remaining amount as desktop; a missing reading is never a zero allowance. */
export function remainingUsage(window: AccountUsageWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
}

export function providerAllowances(
  providers: readonly AgentProviderStatus[],
  usage: AccountUsage | undefined,
  accounts: { host: HostProviderAccounts; usage: AccountUsage } | undefined,
): ProviderAllowance[] {
  const limits = [...(usage?.limits ?? []), ...(accounts?.usage.limits ?? [])];
  return providers.flatMap((provider) => {
    if (!isAgentProvider(provider.id) || provider.state !== "available") return [];
    const hostAccounts = accounts?.host.providers.find((item) => item.provider === provider.id)?.accounts ?? [];
    const connected = hostAccounts.filter(
      (account) => account.id === DEFAULT_PROVIDER_ACCOUNT_ID || account.state === "connected",
    );
    const rows = connected.length > 0 ? connected : [{ id: DEFAULT_PROVIDER_ACCOUNT_ID, label: null, email: null }];
    return rows.map((account, index): ProviderAllowance => {
      const limit = limits.find(
        (item) => item.id === provider.id && (item.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === account.id,
      );
      const windows: ProviderAllowanceWindow[] = [];
      if (limit?.primary) windows.push({ ...limit.primary, id: "primary" });
      if (limit?.secondary) windows.push({ ...limit.secondary, id: "secondary" });
      return {
        provider: provider.id,
        accountId: account.id,
        name: agentProviderName(provider.id),
        account: hostAccounts.length > 1 ? (account.label ?? account.email) : null,
        accountNumber: hostAccounts.length > 1 ? index + 1 : null,
        windows: windows.sort(
          (left, right) => (left.windowDurationMins ?? Infinity) - (right.windowDurationMins ?? Infinity),
        ),
      };
    });
  });
}

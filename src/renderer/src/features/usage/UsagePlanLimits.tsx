import { AccountUsageDetails } from "@openbot/ui/features/account/AccountUsageDetails";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { withHostAccountUsage } from "../agents/host-provider-accounts";

/** The plan limits of each provider, first on the usage page. The page header refreshes them. */
export function UsagePlanLimits() {
  const text = useText();
  const { t } = text;
  const auth = useAuth();
  const { agentStatus, hostAccountLimits } = useAgents();
  const rows = createMemo(() =>
    accountUsageProviderRows(
      withHostAccountUsage(auth.accountUsage(), hostAccountLimits()),
      agentStatus().providers,
      text,
    ),
  );
  return (
    <section class="usage-plan-limits" aria-label={t("usage.panel.planLimits")}>
      <AccountUsageDetails
        rows={rows()}
        loading={false}
        error={null}
        refreshActive={false}
        refreshDisabled={false}
        onRefresh={() => undefined}
        title={<h3>{t("usage.panel.planLimits")}</h3>}
      />
    </section>
  );
}

/** Refreshes the plan limits of the active server, as the account box does. */
export function useRefreshPlanLimits() {
  const auth = useAuth();
  const { refreshHostAccountUsage } = useAgents();
  return () => {
    void refreshHostAccountUsage().catch(() => undefined);
    const targetKey = auth.accountUsageTargetKey();
    if (targetKey) void auth.refreshAccountUsage(targetKey).catch(() => undefined);
  };
}

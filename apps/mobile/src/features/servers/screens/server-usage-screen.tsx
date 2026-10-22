import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { UsageFilterMenu } from "@/features/agents/components/usage-filter-menu";
import { UsageLoading } from "@/features/agents/components/usage-motion";
import { lastUsageDays, UsageRangePicker } from "@/features/agents/components/usage-range-picker";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ProviderUsageSection } from "@/features/servers/components/provider-usage-section";
import { ServerUsageReport, type UsageMetric } from "@/features/servers/components/server-usage-report";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { ScrollTouchArea } from "@/shared/components/scroll-touch-area";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** Host analytics retain their native filters, real cost estimates, and agent scope. */
export function ServerUsageScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { servers, agents, loadHostAnalytics } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const providers = useServerProviders(serverId, { runtimes: false });
  const online = server?.state === "online";
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const [range, setRange] = useState(() => lastUsageDays());
  const [agentId, setAgentId] = useState<string>();
  const [metric, setMetric] = useState<UsageMetric>("estimatedCostUsd");
  useEffect(() => {
    mobileAnalytics.track("usage_viewed", { scope: "server" });
  }, []);
  const usage = useQuery({
    queryKey: queryKeys.serverUsage(queryScope, serverId, range, agentId),
    queryFn: () => loadHostAnalytics({ ...range, ...(agentId ? { agentId } : {}) }, serverId),
    enabled: online,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const agentName = (id: string) => serverAgents.find((agent) => agent.id === id)?.name ?? id;
  function selectAgent(id: string | undefined) {
    void haptics.selection();
    setAgentId(id);
  }
  const refresh = () => {
    void haptics.impact("soft");
    void usage.refetch();
    void queryClient.invalidateQueries({ queryKey: queryKeys.providerUsage(queryScope, serverId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.providerAccountUsage(queryScope, serverId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.providerStatus(queryScope, serverId) });
  };
  return (
    <>
      {isAndroid ? (
        <AndroidHeaderButton
          placement="right"
          icon={RefreshCw}
          accessibilityLabel={t("mobile.server.usage.refresh")}
          disabled={!online || usage.isFetching}
          onPress={refresh}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="arrow.clockwise"
            accessibilityLabel={t("mobile.server.usage.refresh")}
            disabled={!online || usage.isFetching}
            onPress={refresh}
          >
            {t("mobile.server.usage.refresh")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <ScrollTouchArea>
        <ScrollView
          className="flex-1 bg-team-canvas"
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 20 }}
        >
          {!server ? (
            <Typography.Paragraph>{t("mobile.server.unavailable")}</Typography.Paragraph>
          ) : (
            <>
              {providers.admin ? (
                <ProviderUsageSection
                  serverId={serverId}
                  admin={providers.admin}
                  providers={providers.status.data?.providers ?? []}
                />
              ) : null}
              <View className="flex-row flex-wrap items-center gap-2">
                <UsageFilterMenu
                  value={agentId ?? ""}
                  options={[
                    { value: "", label: t("mobile.server.usage.allAgents") },
                    ...(agentId && !serverAgents.some((agent) => agent.id === agentId)
                      ? [{ value: agentId, label: agentId }]
                      : []),
                    ...serverAgents.map((agent) => ({ value: agent.id, label: agent.name })),
                  ]}
                  label={t("mobile.server.usage.agent")}
                  onChange={(value) => setAgentId(value || undefined)}
                />
                <UsageFilterMenu<UsageMetric>
                  value={metric}
                  options={[
                    { value: "estimatedCostUsd", label: t("mobile.agent.usage.cost") },
                    { value: "processedTokens", label: t("mobile.agent.usage.tokens") },
                  ]}
                  label={t("mobile.agent.usage.daily")}
                  onChange={(value) => setMetric(value)}
                />
                <UsageRangePicker range={range} onChange={setRange} appearance="menu" />
              </View>
              {!online ? (
                <Typography.Paragraph>{t("mobile.agent.info.usage.reconnect")}</Typography.Paragraph>
              ) : usage.isPending ? (
                <Typography.Paragraph>{t("mobile.agent.info.usage.loading")}</Typography.Paragraph>
              ) : usage.isError ? (
                <View className="gap-2">
                  <Typography.Paragraph accessibilityRole="alert">
                    {t("mobile.agent.info.usage.failed")}
                  </Typography.Paragraph>
                  <Button variant="ghost" onPress={() => void usage.refetch()}>
                    <Button.Label>{t("mobile.agent.info.usage.retry")}</Button.Label>
                  </Button>
                </View>
              ) : usage.data ? (
                <UsageLoading loading={usage.isPlaceholderData}>
                  <ServerUsageReport
                    result={usage.data}
                    metric={metric}
                    agentName={agentName}
                    onSelectAgent={selectAgent}
                  />
                </UsageLoading>
              ) : (
                <Typography.Paragraph>{t("mobile.server.usage.unsupported")}</Typography.Paragraph>
              )}
            </>
          )}
        </ScrollView>
      </ScrollTouchArea>
    </>
  );
}

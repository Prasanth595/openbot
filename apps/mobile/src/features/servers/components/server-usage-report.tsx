import { agentProviderCliName, type HostAnalytics, isAgentProvider } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { usageSeries } from "@openbot/team-client/usage-series";
import { Button, ListGroup, Typography } from "heroui-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useUsageSeriesColor } from "@/features/agents/components/usage-chart";
import { UsageBar, UsageValue } from "@/features/agents/components/usage-motion";
import { UsageDailyBars } from "@/features/servers/components/usage-daily-bars";
import { useText } from "@/shared/lib/text";

export type UsageMetric = "processedTokens" | "estimatedCostUsd";
const providerName = (value: string) => (isAgentProvider(value) ? agentProviderCliName(value) : value);

/** The host's report, restyled without changing the values or the scope the host supplied. */
export function ServerUsageReport({
  result,
  metric,
  agentName,
  onSelectAgent,
}: {
  result: HostAnalytics;
  metric: UsageMetric;
  agentName: (id: string) => string;
  onSelectAgent: (id: string) => void;
}) {
  const { t, format } = useText();
  const seriesColor = useUsageSeriesColor();
  const [breakdown, setBreakdown] = useState<"model" | "agent" | "day">("agent");
  const [dailyExpanded, setDailyExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedIndex = result.daily.findIndex((day) => day.date === selectedDate);
  const selected = result.daily[selectedIndex];
  const date = (day: string, year = false) =>
    format.date(new Date(`${day}T12:00:00Z`), {
      day: "numeric",
      month: "short",
      year: year ? "numeric" : undefined,
      timeZone: "UTC",
    });
  const number = (value: number | null) =>
    value === null ? t("mobile.agent.runtime.unavailable") : format.number(value);
  const compact = (value: number | null) =>
    value === null ? t("mobile.agent.runtime.unavailable") : format.compact(value);
  const money = (value: number | null) =>
    value === null
      ? t("mobile.agent.runtime.unavailable")
      : format.currencyUsd(value, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const amount = (value: { processedTokens: number; estimatedCostUsd: number | null }) =>
    metric === "estimatedCostUsd" ? money(value.estimatedCostUsd) : compact(value.processedTokens);
  const totalAmount = amount(result.totals);
  const share = (value: number | null) => {
    const total = result.totals[metric];
    return value === null || total === null ? null : total > 0 ? value / total : 0;
  };
  const percent = (value: number | null) =>
    value === null
      ? t("mobile.agent.runtime.unavailable")
      : format.percent(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const chart = usageSeries(result.providerDaily, result.daily, metric === "estimatedCostUsd" ? "cost" : "tokens");
  const dates = result.daily.map((day) => day.date);
  const chartSeries = chart.series.map((key) => ({
    key,
    color: seriesColor(key),
    values: chart.rows.map((row) => {
      const value = row[key];
      return typeof value === "number" ? value : null;
    }),
  }));
  const providers = new Map<string, { provider: string; processedTokens: number; estimatedCostUsd: number | null }>();
  for (const model of result.models) {
    const current = providers.get(model.provider);
    providers.set(model.provider, {
      provider: model.provider,
      processedTokens: (current?.processedTokens ?? 0) + model.processedTokens,
      estimatedCostUsd:
        model.estimatedCostUsd === null
          ? (current?.estimatedCostUsd ?? null)
          : (current?.estimatedCostUsd ?? 0) + model.estimatedCostUsd,
    });
  }
  const effectiveBreakdown = breakdown === "agent" && result.agentId ? "model" : breakdown;
  const breakdownOptions = [
    { value: "model", label: t("mobile.agent.runtime.model") },
    ...(!result.agentId ? [{ value: "agent", label: t("mobile.server.usage.agent") }] : []),
    { value: "day", label: t("mobile.agent.record.day") },
  ];
  const totals = result.totals;
  const stats = [
    { key: "mobile.agent.usage.tokens", value: totals.processedTokens },
    { key: "mobile.agent.usage.cachedInput", value: totals.cachedInput },
    { key: "mobile.agent.usage.uncachedInput", value: totals.uncachedInput },
    { key: "mobile.agent.usage.cacheCreation", value: totals.cacheCreation },
    { key: "mobile.agent.usage.output", value: totals.output },
    { key: "mobile.agent.usage.userMessages", value: totals.userMessages },
    { key: "mobile.agent.usage.assistantMessages", value: totals.assistantMessages },
  ] as const satisfies readonly { key: MobileTextKey; value: number | null }[];
  const statRows = [stats.slice(0, 2), stats.slice(2, 4), stats.slice(4, 6), stats.slice(6, 8)];
  const renderDayRows = () =>
    result.daily.map((day) => (
      <UsageBreakdownRow
        key={day.date}
        title={date(day.date)}
        value={amount(day)}
        subtitle={t("mobile.agent.usage.selectedDay", {
          date: date(day.date),
          tokens: number(day.processedTokens),
          cost: money(day.estimatedCostUsd),
          sessions: format.number(day.sessions),
        })}
        share={share(day[metric])}
        onPress={() => setSelectedDate(day.date)}
      />
    ));
  return (
    <View className="gap-5">
      <View style={{ gap: 6 }}>
        <UsageValue value={totalAmount}>
          <Typography.Heading
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ fontFamily: "Inter", fontSize: 56, lineHeight: 62, letterSpacing: -3, fontWeight: "500" }}
          >
            {totalAmount}
          </Typography.Heading>
        </UsageValue>
        <Typography.Paragraph
          className="text-grouped-secondary"
          style={{
            fontFamily: "Inter",
            fontSize: 12,
            lineHeight: 16,
            letterSpacing: 0.72,
            fontWeight: "600",
            textTransform: "uppercase",
          }}
        >
          {t(metric === "estimatedCostUsd" ? "mobile.server.usage.totalMeta" : "mobile.server.usage.tokensMeta", {
            sessions: format.number(totals.sessions),
          })}
        </Typography.Paragraph>
      </View>
      {[...providers.values()].map((provider) => (
        <View
          key={provider.provider}
          className="flex-row items-center gap-3 border border-grouped-border bg-grouped"
          style={{ borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 }}
        >
          <View className="size-2 rounded-full" style={{ backgroundColor: seriesColor(provider.provider) }} />
          <View className="min-w-0 flex-1" style={{ gap: 3 }}>
            <Typography.Paragraph weight="semibold" style={{ fontFamily: "Inter", fontSize: 15, lineHeight: 20 }}>
              {providerName(provider.provider)}
            </Typography.Paragraph>
            <Typography.Paragraph
              className="text-grouped-secondary"
              style={{ fontFamily: "Inter", fontSize: 13, lineHeight: 18 }}
            >
              {t(
                metric === "estimatedCostUsd"
                  ? "mobile.server.usage.providerCostLine"
                  : "mobile.server.usage.providerTokensLine",
                {
                  percent: percent(share(provider[metric])),
                  tokens: compact(provider.processedTokens),
                  cost: money(provider.estimatedCostUsd),
                },
              )}
            </Typography.Paragraph>
          </View>
          <Typography.Paragraph weight="semibold" style={{ fontFamily: "Inter", fontSize: 15, lineHeight: 20 }}>
            {amount(provider)}
          </Typography.Paragraph>
        </View>
      ))}
      <View className="gap-2.5 border border-grouped-border bg-grouped p-4" style={{ borderRadius: 24 }}>
        <View className="flex-row items-center justify-between gap-2">
          <Typography.Paragraph weight="semibold" style={{ fontFamily: "Inter", fontSize: 15, lineHeight: 20 }}>
            {t(metric === "estimatedCostUsd" ? "mobile.server.usage.dailyCost" : "mobile.agent.usage.chartTokens")}
          </Typography.Paragraph>
          <Button
            variant="ghost"
            className="min-h-11 shrink px-0"
            accessibilityState={{ expanded: dailyExpanded }}
            onPress={() => setDailyExpanded((current) => !current)}
          >
            <Button.Label
              className="text-accent-text"
              style={{ fontFamily: "Inter", fontSize: 13, lineHeight: 18, fontWeight: "500" }}
            >
              {t("mobile.server.usage.viewDailyData")}
            </Button.Label>
          </Button>
        </View>
        <UsageDailyBars
          dates={dates}
          totals={result.daily.map((day) => day[metric])}
          series={chartSeries}
          selected={selectedIndex < 0 ? null : selectedIndex}
          onSelect={(index) => setSelectedDate(index === null ? null : (dates[index] ?? null))}
          formatDate={(day) => date(day)}
          label={t(metric === "estimatedCostUsd" ? "mobile.agent.usage.chartCost" : "mobile.agent.usage.chartTokens")}
          value={selected ? `${date(selected.date)}: ${amount(selected)}` : t("mobile.agent.usage.selectDay")}
        />
        {selected ? (
          <Typography.Paragraph
            className="text-grouped-secondary"
            style={{ fontFamily: "Inter", fontSize: 12, lineHeight: 17 }}
          >
            {t("mobile.agent.usage.selectedDay", {
              date: date(selected.date),
              tokens: number(selected.processedTokens),
              cost: money(selected.estimatedCostUsd),
              sessions: format.number(selected.sessions),
            })}
          </Typography.Paragraph>
        ) : null}
        {result.daily.every((day) => day[metric] == null) ? (
          <Typography.Paragraph
            className="text-grouped-secondary"
            style={{ fontFamily: "Inter", fontSize: 12, lineHeight: 17 }}
          >
            {t(metric === "estimatedCostUsd" ? "mobile.agent.usage.noDailyCost" : "mobile.agent.usage.noDailyTokens")}
          </Typography.Paragraph>
        ) : null}
        {dailyExpanded ? (
          <View className="overflow-hidden rounded-grouped border border-grouped-border">{renderDayRows()}</View>
        ) : null}
      </View>
      <View style={{ gap: 10 }}>
        <Typography.Paragraph
          className="px-1 text-grouped-secondary"
          style={{
            fontFamily: "Inter",
            fontSize: 12,
            lineHeight: 16,
            fontWeight: "600",
            letterSpacing: 0.72,
            textTransform: "uppercase",
          }}
        >
          {t("mobile.server.usage.totals")}
        </Typography.Paragraph>
        {statRows.map((row) => (
          <View key={row[0]?.key} className="flex-row gap-2">
            {row.map((stat) => (
              <View key={stat.key} className="min-w-0 flex-1 gap-1 bg-grouped p-3" style={{ borderRadius: 14 }}>
                <Typography.Paragraph
                  className="text-grouped-secondary"
                  style={{ fontFamily: "Inter", fontSize: 12, lineHeight: 16 }}
                >
                  {t(stat.key)}
                </Typography.Paragraph>
                <UsageValue value={compact(stat.value)}>
                  <Typography.Paragraph
                    accessibilityLabel={`${t(stat.key)}: ${number(stat.value)}`}
                    weight="semibold"
                    style={{ fontFamily: "Inter", fontSize: 18, lineHeight: 23, letterSpacing: -0.4 }}
                  >
                    {compact(stat.value)}
                  </Typography.Paragraph>
                </UsageValue>
              </View>
            ))}
            {row.length === 1 ? <View className="flex-1" /> : null}
          </View>
        ))}
      </View>
      <View style={{ gap: 10 }}>
        <Typography.Heading
          style={{ fontFamily: "Inter", fontSize: 20, lineHeight: 25, fontWeight: "600", letterSpacing: -0.6 }}
        >
          {t("mobile.server.usage.breakdown")}
        </Typography.Heading>
        <View className="h-10 flex-row gap-1 rounded-full border border-grouped-border bg-grouped p-1">
          {breakdownOptions.map((option) => (
            <Button
              key={option.value}
              variant="ghost"
              className={`h-full min-h-0 flex-1 rounded-full px-1 py-0 ${effectiveBreakdown === option.value ? "bg-action" : ""}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: effectiveBreakdown === option.value }}
              onPress={() => {
                if (option.value === "agent" || option.value === "model" || option.value === "day")
                  setBreakdown(option.value);
              }}
            >
              <Button.Label
                className={effectiveBreakdown === option.value ? "text-action-foreground" : "text-grouped-secondary"}
                style={{ fontFamily: "Inter", fontSize: 14, lineHeight: 20, fontWeight: "600" }}
              >
                {option.label}
              </Button.Label>
            </Button>
          ))}
        </View>
        <View className="overflow-hidden border border-grouped-border bg-grouped" style={{ borderRadius: 14 }}>
          {effectiveBreakdown === "agent" ? (
            result.agents.length ? (
              result.agents.map((agent) => (
                <UsageBreakdownRow
                  key={agent.agentId}
                  title={agentName(agent.agentId)}
                  value={amount(agent)}
                  share={share(agent[metric])}
                  subtitle={`${percent(share(agent[metric]))} · ${compact(agent.processedTokens)}`}
                  onPress={() => onSelectAgent(agent.agentId)}
                />
              ))
            ) : (
              <ReportNote>{t("mobile.server.usage.noAgents")}</ReportNote>
            )
          ) : effectiveBreakdown === "model" ? (
            result.models.length ? (
              result.models.map((model) => (
                <UsageBreakdownRow
                  key={`${model.provider}:${model.model}`}
                  title={model.model || t("mobile.agent.usage.unknownModel")}
                  value={amount(model)}
                  share={share(model[metric])}
                  subtitle={`${providerName(model.provider)} · ${percent(share(model[metric]))} · ${compact(model.processedTokens)}`}
                />
              ))
            ) : (
              <ReportNote>{t("mobile.agent.usage.noModels")}</ReportNote>
            )
          ) : (
            renderDayRows()
          )}
        </View>
      </View>
      <View className="gap-2 px-1">
        <ReportNote>
          {date(result.startDate, true)} – {date(result.endDate, true)} · {result.timeZone}
        </ReportNote>
        {totals.missingUsageTurns || totals.incompleteRecords || totals.unpricedRecords ? (
          <ReportNote>
            {t("mobile.agent.usage.partial", {
              missingUsage: totals.missingUsageTurns,
              incomplete: totals.incompleteRecords,
              unpriced: totals.unpricedRecords,
            })}
          </ReportNote>
        ) : null}
        <ReportNote>{t("mobile.agent.usage.costNote")}</ReportNote>
        <ReportNote>
          {t("mobile.agent.usage.collection", {
            started: format.date(new Date(result.collectionStartedAt)),
            updated: result.updatedAt
              ? format.date(new Date(result.updatedAt), {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                  second: "numeric",
                })
              : t("mobile.agent.usage.never"),
          })}
        </ReportNote>
      </View>
    </View>
  );
}

function ReportNote({ children }: { children: ReactNode }) {
  return (
    <Typography.Paragraph
      className="text-grouped-secondary"
      style={{ fontFamily: "Inter", fontSize: 12, lineHeight: 17 }}
    >
      {children}
    </Typography.Paragraph>
  );
}

function UsageBreakdownRow({
  title,
  value,
  subtitle,
  share,
  onPress,
}: {
  title: string;
  value: string;
  subtitle: string;
  share: number | null;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View className="flex-row items-center gap-2">
        <Typography.Paragraph
          weight="medium"
          className="min-w-0 flex-1"
          style={{ fontFamily: "Inter", fontSize: 15, lineHeight: 20 }}
        >
          {title}
        </Typography.Paragraph>
        <Typography.Paragraph weight="semibold" style={{ fontFamily: "Inter", fontSize: 15, lineHeight: 20 }}>
          {value}
        </Typography.Paragraph>
      </View>
      <View className="flex-row items-center gap-2.5">
        <View className="h-1 flex-1 overflow-hidden rounded-full bg-grouped-border">
          {share === null ? null : (
            <UsageBar className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} />
          )}
        </View>
        <Typography.Paragraph
          className="max-w-3/4 text-grouped-secondary"
          style={{ fontFamily: "Inter", fontSize: 10, lineHeight: 14, fontWeight: "600", letterSpacing: 0.3 }}
        >
          {subtitle}
        </Typography.Paragraph>
      </View>
    </>
  );
  const className = "gap-2 border-grouped-border border-b bg-grouped px-3.5 py-3";
  return onPress ? (
    <ListGroup.Item
      className={className}
      style={{ flexDirection: "column", alignItems: "stretch" }}
      accessibilityRole="button"
      onPress={onPress}
    >
      {content}
    </ListGroup.Item>
  ) : (
    <View className={className}>{content}</View>
  );
}

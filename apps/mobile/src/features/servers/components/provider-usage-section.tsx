import { CLAUDE_PATH, CODEX_PATH, CURSOR_PATH } from "@openbot/brand/provider-logo-shape";
import { type AccountUsageWindow, type AgentProviderStatus, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import SquareTerminal from "lucide-react-native/icons/square-terminal";
import { View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { type ProviderAllowance, providerAllowances, remainingUsage } from "@/features/servers/model/provider-usage";
import { useProviderUsage } from "@/features/servers/model/use-provider-usage";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileText, useText } from "@/shared/lib/text";

/** Plan allowances, separate from the token/cost report of completed turns. */
export function ProviderUsageSection({
  serverId,
  admin,
  providers,
  visible = true,
}: {
  serverId: string;
  admin: ProviderAdmin;
  providers: readonly AgentProviderStatus[];
  visible?: boolean;
}) {
  const text = useText();
  const { t } = text;
  const reading = useProviderUsage(serverId, admin, visible);
  const rows = providerAllowances(providers, reading.usage.data, reading.accounts.data);
  if (rows.length === 0) return null;
  return (
    <SettingsSection
      title={t("mobile.server.providers.usage.title")}
      footer={reading.failed ? t("mobile.server.providers.usage.failed") : undefined}
    >
      {rows.map((row) => (
        <View key={`${row.provider}:${row.accountId}`} className="gap-3 px-4 py-4">
          <View className="flex-row items-center gap-3">
            <AllowanceRings row={row} />
            <View className="min-w-0 flex-1 gap-1">
              <Typography.Paragraph>{row.name}</Typography.Paragraph>
              {row.accountNumber !== null ? (
                <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                  {row.account ?? t("mobile.server.providers.usage.accountNumber", { number: row.accountNumber })}
                </Typography.Paragraph>
              ) : null}
            </View>
            {row.windows.length > 0 ? (
              <Typography.Paragraph className={quotaTextClass(Math.min(...row.windows.map(remainingUsage)))}>
                {t("mobile.server.providers.usage.remaining", {
                  percent: text.format.percent(Math.min(...row.windows.map(remainingUsage)) / 100),
                })}
              </Typography.Paragraph>
            ) : null}
          </View>
          {row.windows.length ? (
            row.windows.map((window) => (
              <View key={window.id} className="gap-1">
                <View className="flex-row items-start justify-between gap-3">
                  <Typography.Paragraph type="body-sm" className="min-w-0 flex-1 text-grouped-secondary">
                    {usageWindowLabel(window, text)}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-sm" className={quotaTextClass(remainingUsage(window))}>
                    {t("mobile.server.providers.usage.remaining", {
                      percent: text.format.percent(remainingUsage(window) / 100),
                    })}
                  </Typography.Paragraph>
                </View>
                {window.resetsAt !== null && Number.isFinite(new Date(window.resetsAt * 1000).getTime()) ? (
                  <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
                    {t("mobile.server.providers.usage.resets", {
                      time: text.format.date(new Date(window.resetsAt * 1000), {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }),
                    })}
                  </Typography.Paragraph>
                ) : null}
              </View>
            ))
          ) : (
            <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
              {t(
                !agentProviderDescriptor(row.provider).reportsUsage
                  ? "mobile.server.providers.usage.notReported"
                  : reading.usage.isPending || reading.refreshing
                    ? "mobile.server.providers.usage.loading"
                    : "mobile.server.providers.usage.unavailable",
              )}
            </Typography.Paragraph>
          )}
        </View>
      ))}
      <SettingsRow disabled={reading.refreshing} disclosure={false} onPress={reading.refresh}>
        <Typography.Paragraph className="text-accent">
          {t(reading.refreshing ? "mobile.server.providers.usage.refreshing" : "mobile.server.providers.usage.refresh")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

export function quotaTextClass(percent: number) {
  return percent < 10 ? "text-danger-text" : percent < 30 ? "text-warning-text" : "text-success-text";
}

/** Desktop brand paths and remaining-quota rings rendered with the installed native SVG library. */
export function AllowanceRings({
  row,
  size = 48,
  tile = false,
}: {
  row: ProviderAllowance;
  size?: 32 | 44 | 48;
  tile?: boolean;
}) {
  const ink = String(useCSSVariable("--openbot-text-primary"));
  const track = String(useCSSVariable("--openbot-bg-control-active"));
  const success = String(useCSSVariable("--success"));
  const warning = String(useCSSVariable("--warning"));
  const danger = String(useCSSVariable("--danger"));
  const path =
    row.provider === "codex"
      ? CODEX_PATH
      : row.provider === "claude"
        ? CLAUDE_PATH
        : row.provider === "cursor"
          ? CURSOR_PATH
          : null;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: tile ? 8 : 0,
        backgroundColor: tile ? track : undefined,
      }}
    >
      {!tile ? (
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          {(size === 32 ? [row.windows[0] ?? null] : row.windows.length ? row.windows : [null]).map((window, index) => {
            const radius = size / 2 - 1.5 - index * 6;
            const perimeter = 2 * Math.PI * radius;
            const remaining = window ? remainingUsage(window) : null;
            return (
              <G key={window?.id ?? "unavailable"}>
                <Circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={2.5} />
                {remaining !== null && remaining > 0 ? (
                  <Circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={remaining < 10 ? danger : remaining < 30 ? warning : success}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray={`${(perimeter * remaining) / 100} ${perimeter}`}
                    rotation={-90}
                    origin={`${size / 2},${size / 2}`}
                  />
                ) : null}
              </G>
            );
          })}
        </Svg>
      ) : null}
      {path ? (
        <Svg
          width={size === 32 ? 14 : 16}
          height={size === 32 ? 14 : 16}
          viewBox={row.provider === "claude" ? "0 0 248 248" : row.provider === "cursor" ? "0 0 24 24" : "0 0 256 260"}
        >
          <Path d={path} fill={row.provider === "claude" ? "#D97757" : ink} />
        </Svg>
      ) : (
        <SquareTerminal size={size === 32 ? 14 : 18} color={ink} />
      )}
    </View>
  );
}

export function usageWindowLabel(window: AccountUsageWindow, { t }: MobileText) {
  const minutes = window.windowDurationMins;
  if (minutes === null) return t("mobile.server.providers.usage.limit");
  if (Math.abs(minutes - 10_080) <= 504) return t("mobile.server.providers.usage.weekly");
  if (Math.abs(minutes - 43_200) <= 2160 || Math.abs(minutes - 40_320) <= 2016)
    return t("mobile.server.providers.usage.monthly");
  if (Math.abs(minutes - 1440) <= 72) return t("mobile.server.providers.usage.daily");
  if (minutes >= 60 && minutes % 60 === 0) return t("mobile.server.providers.usage.hours", { count: minutes / 60 });
  return t("mobile.server.providers.usage.minutes", { minutes });
}

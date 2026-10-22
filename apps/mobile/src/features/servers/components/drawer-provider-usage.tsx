import { agentProviderDescriptor } from "@openbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { type ProviderAllowance, providerAllowances, remainingUsage } from "@/features/servers/model/provider-usage";
import { useProviderUsage } from "@/features/servers/model/use-provider-usage";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { AllowanceRings, quotaTextClass, usageWindowLabel } from "./provider-usage-section";

/** The drawer stays mounted while closed. Only its visible summary may read quotas. */
export function DrawerProviderUsage({
  serverId,
  open,
  onPress,
}: {
  serverId: string;
  open: boolean;
  onPress: () => void;
}) {
  const foreground = useAppForeground();
  const visible = open && foreground;
  const providers = useServerProviders(serverId, { runtimes: false, enabled: visible });
  return providers.admin ? (
    <PlanLimits
      key={serverId}
      serverId={serverId}
      open={open}
      visible={visible}
      admin={providers.admin}
      providers={providers.status.data?.providers ?? []}
      loading={providers.status.isPending}
      failed={providers.status.isError}
      onPress={onPress}
    />
  ) : null;
}

function PlanLimits({
  serverId,
  open,
  visible,
  admin,
  providers,
  loading,
  failed,
  onPress,
}: {
  serverId: string;
  open: boolean;
  visible: boolean;
  admin: ProviderAdmin;
  providers: Parameters<typeof providerAllowances>[0];
  loading: boolean;
  failed: boolean;
  onPress: () => void;
}) {
  const text = useText();
  const { t, format } = text;
  const muted = String(useCSSVariable("--openbot-text-secondary"));
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [visible]);
  const reading = useProviderUsage(serverId, admin, visible);
  const rows = providerAllowances(providers, reading.usage.data, reading.accounts.data);
  const first = rows.find((row) => row.windows.length === 2);
  const commonWindows =
    first &&
    rows
      .filter((row) => row.windows.length)
      .every(
        (row) =>
          row.windows.length === 2 &&
          row.windows.every((window, index) => window.windowDurationMins === first.windows[index]?.windowDurationMins),
      );
  const updated = reading.usage.dataUpdatedAt;
  return (
    <View
      className={`mx-2 overflow-hidden rounded-[14px] border border-grouped-border bg-grouped ${expanded ? "gap-0.5 p-1" : "gap-1.5 px-3 pt-1 pb-3"}`}
    >
      <Button
        variant="ghost"
        className={`h-auto flex-row justify-start gap-2 rounded-none py-0 ${expanded ? "min-h-11 px-2" : "min-h-9 px-0"}`}
        hitSlop={4}
        accessibilityState={{ expanded }}
        accessibilityLabel={t("mobile.server.providers.usage.title")}
        onPress={() => {
          void haptics.selection();
          setExpanded((value) => !value);
        }}
      >
        <Typography.Paragraph
          className="min-w-0 flex-1 text-text-secondary"
          style={{ fontSize: 13, lineHeight: 18 }}
          weight="medium"
        >
          {t("mobile.server.providers.usage.title")}
        </Typography.Paragraph>
        {expanded && commonWindows && first ? (
          <View className="shrink flex-row flex-wrap justify-end gap-x-2">
            {first.windows.map((window, index) => (
              <Typography.Paragraph
                key={window.id}
                className="text-text-secondary"
                style={{ fontSize: 12, lineHeight: 16 }}
              >
                {t(index === 0 ? "mobile.server.providers.usage.outer" : "mobile.server.providers.usage.inner", {
                  window: shortWindow(window.windowDurationMins, text),
                })}
              </Typography.Paragraph>
            ))}
          </View>
        ) : null}
        <ChevronDown size={16} color={muted} style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }} />
      </Button>
      {rows.length === 0 ? (
        <Typography.Paragraph className="px-2 text-text-secondary" style={{ fontSize: 13, lineHeight: 18 }}>
          {t(
            loading
              ? "mobile.server.providers.loading"
              : failed
                ? "mobile.server.providers.loadFailed"
                : "mobile.server.providers.usage.unavailable",
          )}
        </Typography.Paragraph>
      ) : expanded ? (
        rows.map((row) => (
          <ExpandedLimit
            key={`${row.provider}:${row.accountId}`}
            row={row}
            now={now}
            reading={reading}
            onPress={onPress}
          />
        ))
      ) : (
        <View className="flex-row flex-wrap justify-between gap-y-3">
          {rows.map((row) => {
            const window = row.windows[0] ?? null;
            const percent = window ? remainingUsage(window) : null;
            const reset = window ? resetIn(window.resetsAt, now, text) : null;
            return (
              <Button
                key={`${row.provider}:${row.accountId}`}
                variant="ghost"
                className="h-auto min-h-11 min-w-0 flex-row justify-start gap-2 rounded-lg p-0"
                style={{ flexBasis: rows.length < 3 ? `${100 / rows.length}%` : "33.333%" }}
                accessibilityLabel={rowLabel(row, text, window)}
                onPress={onPress}
              >
                <AllowanceRings row={row} size={32} />
                <View className="min-w-0 shrink gap-px">
                  <Typography.Paragraph
                    weight="semibold"
                    className={percent === null ? "text-text-secondary" : quotaTextClass(percent)}
                    style={{ fontSize: 14, lineHeight: 18 }}
                  >
                    {percent === null ? t("mobile.server.providers.usage.unknown") : format.percent(percent / 100)}
                  </Typography.Paragraph>
                  <Typography.Paragraph className="text-text-secondary" style={{ fontSize: 12, lineHeight: 16 }}>
                    {reset ??
                      t(
                        percent === null
                          ? "mobile.server.providers.usage.noData"
                          : "mobile.server.providers.usage.unknown",
                      )}
                  </Typography.Paragraph>
                </View>
              </Button>
            );
          })}
        </View>
      )}
      {expanded ? (
        <View className="min-h-11 flex-row flex-wrap items-center justify-between gap-x-2 px-2">
          <Typography.Paragraph className="shrink text-text-secondary" style={{ fontSize: 13, lineHeight: 18 }}>
            {t(
              reading.refreshing
                ? "mobile.server.providers.usage.refreshing"
                : reading.failed
                  ? "mobile.server.providers.usage.unavailable"
                  : "mobile.server.providers.usage.updated",
              {
                time: updated
                  ? shortWindow(Math.max(0, Math.floor((now - updated) / 60_000)), text)
                  : t("mobile.server.providers.usage.unknown"),
              },
            )}
          </Typography.Paragraph>
          <Button variant="ghost" className="h-auto min-h-11 flex-row gap-1 rounded-lg px-0 py-0" onPress={onPress}>
            <Typography.Paragraph className="text-accent-text" weight="medium" style={{ fontSize: 14, lineHeight: 18 }}>
              {t("mobile.server.providers.usage.costs")}
            </Typography.Paragraph>
            <ArrowUpRight size={14} color={accent} />
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function ExpandedLimit({
  row,
  now,
  reading,
  onPress,
}: {
  row: ProviderAllowance;
  now: number;
  reading: ReturnType<typeof useProviderUsage>;
  onPress: () => void;
}) {
  const text = useText();
  const { t, format } = text;
  const muted = String(useCSSVariable("--openbot-text-dim"));
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const lowest = lowestWindow(row);
  const percent = lowest ? remainingUsage(lowest) : null;
  const reset = lowest ? resetIn(lowest.resetsAt, now, text) : null;
  const account =
    row.accountNumber !== null
      ? (row.account ?? t("mobile.server.providers.usage.accountNumber", { number: row.accountNumber }))
      : null;
  const unavailable = !agentProviderDescriptor(row.provider).reportsUsage
    ? t("mobile.server.providers.usage.notReported")
    : t(reading.refreshing ? "mobile.server.providers.usage.loading" : "mobile.server.providers.usage.unavailable");
  return (
    <View
      className={`flex-row items-center gap-3 rounded-xl px-2 py-2.5 ${percent !== null && percent < 30 ? "bg-warning/8" : ""}`}
    >
      <Button
        variant="ghost"
        className="h-auto min-h-11 min-w-0 flex-1 flex-row justify-start gap-3 rounded-none p-0"
        accessibilityLabel={rowLabel(row, text)}
        onPress={onPress}
      >
        <AllowanceRings row={row} size={percent === null ? 32 : 44} tile={percent === null} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row flex-wrap items-center justify-between gap-x-1">
            <Typography.Paragraph weight="medium" className="shrink" style={{ fontSize: 15, lineHeight: 20 }}>
              {row.name}
            </Typography.Paragraph>
            {percent !== null ? (
              <Typography.Paragraph
                weight="semibold"
                className={quotaTextClass(percent)}
                style={{ fontSize: 14, lineHeight: 18 }}
              >
                {t("mobile.server.providers.usage.remaining", { percent: format.percent(percent / 100) })}
              </Typography.Paragraph>
            ) : null}
          </View>
          {account ? (
            <Typography.Paragraph className="text-text-secondary" style={{ fontSize: 12, lineHeight: 16 }}>
              {account}
            </Typography.Paragraph>
          ) : null}
          <Typography.Paragraph className="text-text-secondary" style={{ fontSize: 13, lineHeight: 18 }}>
            {row.windows.length
              ? row.windows
                  .map((window) => `${usageWindowLabel(window, text)} ${format.percent(remainingUsage(window) / 100)}`)
                  .join(" · ")
              : unavailable}
          </Typography.Paragraph>
          {reset ? (
            <Typography.Paragraph className="text-text-secondary" style={{ fontSize: 13, lineHeight: 18 }}>
              {t("mobile.server.providers.usage.resetsIn", { time: reset })}
            </Typography.Paragraph>
          ) : null}
        </View>
      </Button>
      {percent === null && agentProviderDescriptor(row.provider).reportsUsage ? (
        <Button
          variant="secondary"
          className="h-auto min-h-11 flex-row gap-1.5 rounded-full border border-grouped-border px-3.5 py-0"
          isDisabled={reading.refreshing}
          onPress={reading.refresh}
          accessibilityLabel={`${row.name}, ${t("common.retry")}`}
        >
          <RotateCw size={14} color={accent} />
          <Typography.Paragraph className="text-accent-text" weight="medium" style={{ fontSize: 14, lineHeight: 18 }}>
            {t("common.retry")}
          </Typography.Paragraph>
        </Button>
      ) : (
        <ChevronRight size={16} color={muted} />
      )}
    </View>
  );
}

function lowestWindow(row: ProviderAllowance) {
  return row.windows.reduce<ProviderAllowance["windows"][number] | null>(
    (lowest, window) => (!lowest || remainingUsage(window) < remainingUsage(lowest) ? window : lowest),
    null,
  );
}

function rowLabel(row: ProviderAllowance, text: MobileText, window = lowestWindow(row)) {
  return [
    row.name,
    row.account,
    window
      ? text.t("mobile.server.providers.usage.remaining", {
          percent: text.format.percent(remainingUsage(window) / 100),
        })
      : text.t("mobile.server.providers.usage.noData"),
  ]
    .filter(Boolean)
    .join(", ");
}

function shortWindow(minutes: number | null, text: MobileText) {
  if (minutes === null) return text.t("mobile.server.providers.usage.limit");
  if (minutes >= 1440) return shortUnit(Math.round(minutes / 1440), "day", text);
  return shortUnit(Math.round(minutes >= 60 ? minutes / 60 : minutes), minutes >= 60 ? "hour" : "minute", text);
}

/** Native unit formatting can convert hours/minutes to seconds. Keep the reported unit explicit. */
function shortUnit(value: number, unit: "day" | "hour" | "minute", text: MobileText) {
  return text.t(
    unit === "day"
      ? "mobile.server.providers.usage.shortDays"
      : unit === "hour"
        ? "mobile.server.providers.usage.shortHours"
        : "mobile.server.providers.usage.shortMinutes",
    { value: text.format.number(value) },
  );
}

/** A past reset is stale data, not a new full allowance. */
function resetIn(resetsAt: number | null, now: number, text: MobileText) {
  if (resetsAt === null || !Number.isFinite(resetsAt) || resetsAt * 1000 <= now) return null;
  const minutes = Math.ceil((resetsAt * 1000 - now) / 60_000);
  const parts =
    minutes >= 1440
      ? ([
          [Math.floor(minutes / 1440), "day"],
          [Math.floor((minutes % 1440) / 60), "hour"],
        ] as const)
      : minutes >= 60
        ? ([
            [Math.floor(minutes / 60), "hour"],
            [minutes % 60, "minute"],
          ] as const)
        : ([[minutes, "minute"]] as const);
  return parts.map(([value, unit]) => shortUnit(value, unit, text)).join(" ");
}

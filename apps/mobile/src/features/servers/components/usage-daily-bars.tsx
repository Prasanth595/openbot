import { Typography } from "heroui-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import type { UsageChartSeries } from "@/features/agents/components/usage-chart";
import { haptics } from "@/shared/lib/haptics";

const HEIGHT = 120;

/** Daily values remain real values: an unknown total draws a gap, and zero draws only the baseline. */
export function UsageDailyBars({
  dates,
  totals,
  series,
  selected,
  onSelect,
  formatDate,
  label,
  value,
}: {
  dates: readonly string[];
  totals: readonly (number | null)[];
  series: readonly UsageChartSeries[];
  selected: number | null;
  onSelect: (day: number | null) => void;
  formatDate: (date: string) => string;
  label: string;
  value: string;
}) {
  const [width, setWidth] = useState(0);
  const border = String(useCSSVariable("--openbot-border-grouped"));
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const max = Math.max(0, ...totals.map((amount) => amount ?? 0));
  const column = width / Math.max(1, dates.length);
  const gap = Math.min(3, column / 4);
  const ticks = [
    ...new Set([0, Math.floor((dates.length - 1) / 3), Math.floor((2 * (dates.length - 1)) / 3), dates.length - 1]),
  ].filter((index) => index >= 0 && index < dates.length);
  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (!dates.length) return;
          const increment = event.nativeEvent.actionName === "increment";
          const current = selected ?? (increment ? -1 : dates.length);
          const next = Math.min(dates.length - 1, Math.max(0, current + (increment ? 1 : -1)));
          void haptics.selection();
          onSelect(next);
        }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (!column || !dates.length) return;
          const next = Math.min(dates.length - 1, Math.max(0, Math.floor(event.nativeEvent.locationX / column)));
          void haptics.selection();
          onSelect(selected === next ? null : next);
        }}
      >
        <Svg width="100%" height={HEIGHT}>
          <Line x1={0} y1={HEIGHT - 0.5} x2={width} y2={HEIGHT - 0.5} stroke={border} />
          {width > 0
            ? dates.map((date, index) => {
                const total = totals[index];
                if (total == null) return null;
                let y = HEIGHT;
                return (
                  <ViewBars
                    key={date}
                    x={index * column}
                    width={Math.max(0, column - gap)}
                    selected={selected === index}
                    accent={accent}
                    border={border}
                    total={total}
                    segments={series.map((item) => {
                      const amount = item.values[index];
                      const height = amount == null || max === 0 ? 0 : (Math.max(0, amount) / max) * (HEIGHT - 10);
                      y -= height;
                      return { key: item.key, color: item.color, y, height };
                    })}
                  />
                );
              })
            : null}
        </Svg>
      </Pressable>
      <View className="flex-row justify-between">
        {ticks.map((index) => (
          <Typography.Paragraph
            key={dates[index]}
            className="text-grouped-secondary"
            style={{ fontFamily: "Inter", fontSize: 10, lineHeight: 13, fontWeight: "600", letterSpacing: 0.3 }}
          >
            {formatDate(dates[index] ?? "")}
          </Typography.Paragraph>
        ))}
      </View>
    </View>
  );
}

function ViewBars({
  x,
  width,
  total,
  segments,
  selected,
  accent,
  border,
}: {
  x: number;
  width: number;
  total: number;
  segments: readonly { key: string; color: string; y: number; height: number }[];
  selected: boolean;
  accent: string;
  border: string;
}) {
  return (
    <>
      {total === 0 ? (
        <Rect x={x} y={HEIGHT - 2} width={width} height={2} rx={Math.min(3, width / 2)} fill={border} />
      ) : (
        segments
          .filter((item) => item.height > 0)
          .map((item) => (
            <Rect
              key={item.key}
              x={x}
              y={item.y}
              width={width}
              height={item.height}
              rx={Math.min(3, width / 2)}
              fill={item.color}
            />
          ))
      )}
      {selected ? <Rect x={x} y={0} width={width} height={HEIGHT} fill={accent} opacity={0.12} /> : null}
    </>
  );
}

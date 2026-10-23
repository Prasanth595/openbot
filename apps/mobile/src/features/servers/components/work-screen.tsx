import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import type { ReactElement, ReactNode } from "react";
import { type RefreshControlProps, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { ScrollTouchArea } from "@/shared/components/scroll-touch-area";
import { typeScale } from "@/shared/lib/type-scale";

/** Native navigation owns the title and safe areas; the content keeps the shared gutters. */
export function WorkScreen({
  title,
  subtitle,
  children,
  refreshControl,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  return (
    <View collapsable={false} className="flex-1 bg-team-canvas">
      <Stack.Title large={false}>{title}</Stack.Title>
      <ScrollTouchArea>
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          refreshControl={refreshControl}
          mode="insets"
          bottomOffset={20}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: 8,
            paddingBottom: 24,
            paddingHorizontal: 20,
            gap: 20,
          }}
        >
          {subtitle ? (
            <Typography.Paragraph className="text-muted" style={typeScale.teamMeta}>
              {subtitle}
            </Typography.Paragraph>
          ) : null}
          {children}
        </KeyboardAwareScrollView>
      </ScrollTouchArea>
    </View>
  );
}

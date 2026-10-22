import { Typography } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollTouchArea } from "@/shared/components/scroll-touch-area";
import { isAndroid } from "@/shared/lib/platform";
import { typeScale } from "@/shared/lib/type-scale";

/** Native tabs own the safe area; work content keeps the Pencil gutters. */
export function WorkScreen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-team-canvas">
      <ScrollTouchArea>
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          mode="insets"
          bottomOffset={20}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: (isAndroid ? insets.top : 0) + 8,
            paddingBottom: 24,
            paddingHorizontal: 20,
            gap: 20,
          }}
        >
          <View style={{ gap: 8 }}>
            <Typography.Heading style={typeScale.teamDisplay}>{title}</Typography.Heading>
            {subtitle ? (
              <Typography.Paragraph className="text-muted" style={typeScale.teamMeta}>
                {subtitle.toUpperCase()}
              </Typography.Paragraph>
            ) : null}
          </View>
          {children}
        </KeyboardAwareScrollView>
      </ScrollTouchArea>
    </View>
  );
}

import { Button } from "heroui-native";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

import { MorphLabel } from "@/features/auth/components/morph-label";
import type { ScanQrButtonProps } from "@/features/auth/components/scan-qr-button.types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function ScanQrButton({ onPress, width }: ScanQrButtonProps) {
  const { t } = useText();
  const brandColor = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");
  const labelColor = String(useCSSVariable("--openbot-logo-eye") ?? "#040007");

  const cornerRadius = Number.parseFloat(String(useCSSVariable("--openbot-radius-lg") ?? "12"));

  return (
    <Button
      size="lg"
      variant="primary"
      feedbackVariant="scale"
      className="min-h-13 w-full"
      accessibilityLabel={t("mobile.auth.scanQrCode")}
      style={{ width, backgroundColor: brandColor, borderRadius: cornerRadius }}
      onPress={() => {
        void haptics.impact("light");
        onPress();
      }}
    >
      {/* The same label as the sign-in button that the scanner opens from, letter for letter, so
          the copy does not move the text. */}
      <View className="flex-row items-center gap-2">
        <MorphLabel text={t("mobile.auth.scanQrCode")} morphKey="scan" color={labelColor} reduced />
      </View>
    </Button>
  );
}

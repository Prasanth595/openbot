import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import { View } from "react-native";

import { useText } from "@/shared/lib/text";

/**
 * The detail pane with no chat in it. It is the anchor of the stack on a tablet, so the pane always
 * has a screen, and the chat the user picks in the list opens over it.
 */
export function DetailPanePlaceholder() {
  const { t } = useText();
  const muted = useThemeColor("muted");

  return (
    <View className="flex-1 items-center justify-center gap-5 bg-background px-12">
      <View className="size-16 items-center justify-center rounded-3xl bg-control">
        <MessagesSquare color={String(muted)} size={28} strokeWidth={1.6} />
      </View>
      <View className="items-center gap-1.5">
        <Typography.Heading type="h4">{t("mobile.agent.home.detailEmpty")}</Typography.Heading>
        <Typography.Paragraph align="center" className="text-text-secondary">
          {t("mobile.agent.home.detailEmptyBody")}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

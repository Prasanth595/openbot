import { router, Stack, useNavigation } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import { ServerMcpServerScreen } from "@/features/servers/screens/server-mcp-server-screen";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export default function ServerMcpServerPage() {
  const { t } = useText();
  const navigation = useNavigation();
  const directEntry = navigation.getState()?.routes[0]?.name === "mcp-server";
  const back = () => {
    void haptics.impact("soft");
    router.back();
  };
  return (
    <>
      {directEntry ? (
        isAndroid ? (
          <AndroidHeaderButton
            placement="left"
            icon={ChevronLeft}
            accessibilityLabel={t("common.back")}
            onPress={back}
          />
        ) : (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel={t("common.back")} onPress={back} />
          </Stack.Toolbar>
        )
      ) : null}
      <ServerMcpServerScreen />
    </>
  );
}

import { router, Stack } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import { ServerSettingsScreen } from "@/features/servers/screens/server-settings-screen";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export default function ServerSettingsPage() {
  const { t } = useText();
  const back = () => {
    void haptics.impact("soft");
    router.back();
  };
  return (
    <>
      {isAndroid ? (
        <AndroidHeaderButton
          placement="left"
          icon={ChevronLeft}
          glass
          accessibilityLabel={t("common.back")}
          onPress={() => router.back()}
        />
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel={t("common.back")} onPress={back} />
        </Stack.Toolbar>
      )}
      <ServerSettingsScreen />
    </>
  );
}

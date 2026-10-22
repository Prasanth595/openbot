import { router, Stack } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import { EditAgentScreen } from "@/features/agents/screens/edit-agent-screen";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export default function AgentPage() {
  const { t } = useText();
  const back = () => {
    void haptics.impact("soft");
    if (router.canGoBack()) router.back();
    else router.replace("/connected");
  };
  return (
    <>
      {/* This first nested page has no local predecessor. Own one back action to the parent. */}
      <Stack.Screen.BackButton hidden />
      {isAndroid ? (
        <AndroidHeaderButton placement="left" icon={ChevronLeft} accessibilityLabel={t("common.back")} onPress={back} />
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel={t("common.back")} onPress={back} />
        </Stack.Toolbar>
      )}
      <EditAgentScreen page="info" />
    </>
  );
}

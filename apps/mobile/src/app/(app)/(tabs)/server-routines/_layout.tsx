import { Stack } from "expo-router";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function RoutinesStack() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-canvas"));
  return (
    <Stack
      screenOptions={{
        headerTransparent: isIOS,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="agent-routine" options={{ title: t("mobile.app.route.routine") }} />
      <Stack.Screen name="channel-routine" options={{ title: t("mobile.app.route.routine") }} />
      <Stack.Screen name="edit-routine" options={{ title: t("mobile.app.route.routine") }} />
    </Stack>
  );
}

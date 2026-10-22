import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function AgentInfoLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  const canvas = String(useCSSVariable("--openbot-bg-canvas"));
  return (
    <Stack
      screenListeners={sheetBackHaptics}
      screenOptions={(props) => ({
        ...androidBackOptions(props),
        presentation: "card",
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      })}
    >
      <Stack.Screen
        name="index"
        options={{
          title: t("mobile.agent.profile.heading"),
          headerTitleStyle: { fontFamily: "Inter", fontSize: 12, fontWeight: "600" },
          headerTitleAlign: "center",
          headerTransparent: false,
          headerStyle: { backgroundColor: canvas },
          contentStyle: { backgroundColor: canvas },
        }}
      />
      <Stack.Screen name="appearance" options={{ title: t("mobile.agent.route.appearance") }} />
      <Stack.Screen name="usage" options={{ title: t("mobile.agent.info.usage.title") }} />
      <Stack.Screen name="memories" options={{ title: t("mobile.agent.info.memories.title") }} />
      <Stack.Screen name="skills" options={{ title: t("mobile.agent.info.skills.title") }} />
      <Stack.Screen name="files" options={{ title: t("mobile.agent.info.files.title") }} />
      <Stack.Screen name="routines" options={{ title: t("mobile.agent.info.routines.title") }} />
      <Stack.Screen name="tables" options={{ title: t("mobile.agent.tables.title") }} />
      <Stack.Screen name="publish" options={{ title: t("mobile.agent.publish.title") }} />
      <Stack.Screen name="memory" options={{ title: t("mobile.agent.record.memory") }} />
      <Stack.Screen name="routine" options={{ title: t("mobile.agent.record.routine") }} />
      <Stack.Screen name="runtime" options={{ headerShown: false }} />
      <Stack.Screen name="permissions" options={{ title: t("mobile.agent.permissions.title") }} />
      <Stack.Screen name="advanced" options={{ title: t("mobile.agent.advanced.title") }} />
      <Stack.Screen name="crop-photo" options={{ title: t("mobile.agent.route.cropPhoto") }} />
    </Stack>
  );
}

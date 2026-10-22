import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function ServerSettingsLayout() {
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
          title: t("mobile.server.settings.overviewTitle").toUpperCase(),
          headerTitleStyle: { fontFamily: "Inter", fontSize: 12, fontWeight: "600" },
          headerTitleAlign: "center",
          headerTransparent: false,
          headerStyle: { backgroundColor: canvas },
          contentStyle: { backgroundColor: canvas },
        }}
      />
      <Stack.Screen
        name="general"
        options={{
          title: t("mobile.server.settings.general").toUpperCase(),
          headerTitleStyle: { fontFamily: "Inter", fontSize: 12, fontWeight: "600" },
          headerTitleAlign: "center",
          headerTransparent: false,
          headerStyle: { backgroundColor: canvas },
          contentStyle: { backgroundColor: canvas },
        }}
      />
      <Stack.Screen name="members" options={{ title: t("mobile.app.route.members") }} />
      <Stack.Screen name="invite" options={{ title: t("mobile.server.route.invite") }} />
      <Stack.Screen name="member" options={{ title: t("mobile.server.route.member") }} />
      <Stack.Screen name="member-roles" options={{ title: t("mobile.server.route.roles") }} />
      <Stack.Screen name="roles" options={{ title: t("mobile.server.route.roles") }} />
      {/* The page names its role in the name field. */}
      <Stack.Screen name="role" options={{ title: t("mobile.server.route.role") }} />
      <Stack.Screen name="timezone" options={{ title: t("mobile.server.route.timezone") }} />
      <Stack.Screen name="connectors" options={{ title: t("mobile.server.route.connectors") }} />
      {/* The page names its connector. */}
      <Stack.Screen name="connector" options={{ title: t("mobile.server.route.connectors") }} />
      <Stack.Screen
        name="github-repositories"
        options={{ title: t("mobile.server.connectors.github.repositoriesTitle") }}
      />
      <Stack.Screen name="updates" options={{ title: t("mobile.server.route.updates") }} />
      <Stack.Screen name="storage" options={{ title: t("mobile.server.route.storage") }} />
      <Stack.Screen name="storage-files" options={{ title: t("mobile.server.route.storageFiles") }} />
      <Stack.Screen name="sites" options={{ title: t("mobile.server.route.sites") }} />
      <Stack.Screen name="providers" options={{ title: t("mobile.server.route.providers") }} />
      <Stack.Screen name="provider" options={{ title: t("mobile.server.route.provider") }} />
      <Stack.Screen name="mcp" options={{ title: t("mobile.server.route.mcp") }} />
      <Stack.Screen name="mcp-server" options={{ title: t("mobile.server.route.mcpServer") }} />
      <Stack.Screen name="crop-logo" options={{ title: t("mobile.server.route.cropLogo") }} />
    </Stack>
  );
}

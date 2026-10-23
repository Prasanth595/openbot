import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function SettingsLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  const canvas = String(useCSSVariable("--openbot-bg-canvas"));
  return (
    <Stack
      screenOptions={{
        presentation: "card",
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        scrollEdgeEffects: { top: "soft", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: isIOS ? "transparent" : canvas },
          contentStyle: { backgroundColor: canvas },
        }}
      >
        <Stack.Title>{t("mobile.app.route.settings")}</Stack.Title>
      </Stack.Screen>
      <Stack.Screen name="profile" options={{ title: t("mobile.app.route.profile") }} />
      <Stack.Screen name="appearance" options={{ title: t("mobile.settings.appearance.title") }} />
      <Stack.Screen name="animations" options={{ title: t("mobile.settings.animations.title") }} />
      <Stack.Screen name="language" options={{ title: t("mobile.settings.language.title") }} />
      <Stack.Screen name="haptics" options={{ title: t("mobile.settings.feedback.haptics") }} />
      <Stack.Screen name="notifications" options={{ title: t("mobile.settings.notifications.title") }} />
      <Stack.Screen name="privacy" options={{ title: t("mobile.settings.privacy.title") }} />
      <Stack.Screen name="app-lock" options={{ title: t("mobile.appLock.title") }} />
      <Stack.Screen name="app-lock-pin" options={{ title: t("mobile.appLock.pinSetup.title") }} />
      <Stack.Screen name="sessions" options={{ title: t("mobile.app.route.accountSessions") }} />
      <Stack.Screen name="about" options={{ title: t("mobile.app.route.about") }} />
      <Stack.Screen name="support" options={{ title: t("mobile.app.route.support") }} />
      <Stack.Screen name="hidden-chats" options={{ title: t("mobile.app.route.hiddenChats") }} />
      <Stack.Screen name="crop-photo" options={{ title: t("mobile.app.route.cropPhoto") }} />
    </Stack>
  );
}
